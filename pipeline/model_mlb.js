const fs = require('fs');
const ledger = require('./model_ledger');
const calibration = require('./calibration');
const riskGuards = require('./risk_guards');
const riskConfig = require('./risk_config');

const ESPORTE = 'baseball/mlb';
const RUN_ID = new Date().toISOString();
const MARKET = 'h2h';
const LINE = 0;
const SIDE = 'Win';

function readJsonSafe(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  const raw = fs.readFileSync(file, 'utf-8').trim();
  if (!raw) return fallback;
  try { return JSON.parse(raw); } catch { return fallback; }
}

const teamRating = readJsonSafe('mlb_team_rating.json', null);
const odds = readJsonSafe('mlb_odds.json', null);

if (!teamRating) {
  console.log('mlb_team_rating.json não encontrado ou vazio — pulando modelo MLB H2H.');
  process.exit(0);
}
if (!odds) {
  console.log('mlb_odds.json não encontrado ou vazio — pulando modelo MLB H2H.');
  process.exit(0);
}

const SEASON_WEIGHT = { 2023: 1, 2024: 2, 2025: 3, 2026: 4 };
const CURRENT_SEASON = 2026;
const KELLY_FRACTION = riskConfig.KELLY_FRACTION;

function calcProb(r1, r2) {
  return 1 / (1 + Math.exp(-(r1 - r2) / 0.5));
}

function calcKelly(p, odd, stakeFraction = 1) {
  const b = odd - 1;
  const q = 1 - p;
  const kelly = (p * b - q) / b;
  return Math.max(0, parseFloat((kelly * KELLY_FRACTION * stakeFraction * 100).toFixed(2)));
}

function pct(value, digits = 1) {
  return parseFloat((value * 100).toFixed(digits));
}

function getWeightedRating(teamName, location) {
  const data = teamRating[teamName];
  if (!data) return null;
  let weightedSum = 0;
  let totalWeight = 0;
  let hasCurrentSeason = false;
  for (const [seasonStr, seasonData] of Object.entries(data)) {
    const season = parseInt(seasonStr);
    const w = SEASON_WEIGHT[season] || 1;
    const r = seasonData?.regular?.[location];
    if (r === undefined) continue;
    weightedSum += r * w;
    totalWeight += w;
    if (season === CURRENT_SEASON) hasCurrentSeason = true;
  }
  if (totalWeight === 0) return null;
  return { rating: weightedSum / totalWeight, hasCurrentSeason };
}

function findTeam(name) {
  if (teamRating[name]) return name;
  const lower = name.toLowerCase();
  for (const key of Object.keys(teamRating)) {
    if (key.toLowerCase().includes(lower) || lower.includes(key.toLowerCase())) return key;
  }
  return null;
}

function eventIdFor(match) {
  return match.event_id ?? match.eventId ?? `${match.team1} x ${match.team2}|${match.commence_time}`;
}

function makeCandidate(match, team, rawProb, impliedProb, oddsPrice) {
  const calib = calibration.calibrate({ esporte: ESPORTE, market: MARKET, rawProb, impliedProb });
  const edge = calib.calibratedProb - impliedProb;
  const edgePct = pct(edge, 2);
  const segmentDisabled = riskConfig.isSegmentDisabled(ESPORTE, MARKET);
  const passedMinEdge = edgePct >= riskConfig.MIN_EDGE_PCT;
  const edgeTooHigh = edgePct > riskConfig.EDGE_CAP_PCT;

  let published = passedMinEdge && !segmentDisabled && !edgeTooHigh;
  let rejectionReason = null;
  if (segmentDisabled) rejectionReason = ledger.REJECTION_REASONS.SEGMENTO_DESABILITADO;
  else if (!passedMinEdge) rejectionReason = ledger.REJECTION_REASONS.EDGE_ABAIXO_LIMIAR;
  else if (edgeTooHigh) rejectionReason = ledger.REJECTION_REASONS.GUARDA_EDGE_MAXIMO;

  return {
    match,
    game: `${match.team1} x ${match.team2}`,
    player: team,
    market: MARKET,
    line: LINE,
    side: SIDE,
    odds: oddsPrice,
    rawProb,
    impliedProb,
    calib,
    edgePct,
    kelly: calcKelly(calib.calibratedProb, oddsPrice, calib.stakeFraction),
    published,
    rejectionReason,
  };
}

if (!odds.length) {
  console.log('mlb_odds.json vazio — sem partidas disponíveis.');
  process.exit(0);
}

let descartados = 0;
const byGame = new Map();
const candidates = [];

for (const m of odds) {
  const t1Key = findTeam(m.team1);
  const t2Key = findTeam(m.team2);
  if (!t1Key || !t2Key) { descartados++; continue; }
  const r1 = getWeightedRating(t1Key, 'away');
  const r2 = getWeightedRating(t2Key, 'home');
  if (!r1 || !r2) { descartados++; continue; }

  const rawProb1 = calcProb(r1.rating, r2.rating);
  const rawProb2 = 1 - rawProb1;
  const impliedProb1 = 1 / m.odds1;
  const impliedProb2 = 1 / m.odds2;
  const c1 = makeCandidate(m, m.team1, rawProb1, impliedProb1, m.odds1);
  const c2 = makeCandidate(m, m.team2, rawProb2, impliedProb2, m.odds2);
  candidates.push(c1, c2);
  byGame.set(c1.game, { match: m, candidates: [c1, c2] });
}

riskGuards.applyGameGuards(candidates);

const results = [];
for (const c of candidates) {
  ledger.recordEvaluation({
    esporte: ESPORTE,
    eventId: eventIdFor(c.match),
    game: c.game,
    commenceTime: c.match.commence_time,
    player: c.player,
    market: MARKET,
    line: LINE,
    side: SIDE,
    modelProb: pct(c.calib.calibratedProb),
    rawProb: pct(c.rawProb),
    odds: c.odds,
    bookmaker: c.match.bookmaker ?? null,
    edge: c.edgePct,
    kelly: c.kelly,
    published: c.published,
    rejectionReason: c.rejectionReason,
    segmentState: c.calib.segmentState,
    sampleSize: c.calib.sampleSize,
    runId: RUN_ID,
  });
}

for (const { match, candidates: sides } of byGame.values()) {
  const publishedSides = sides.filter(c => c.published);
  if (!publishedSides.length) continue;
  const best = publishedSides.sort((a, b) => b.edgePct - a.edgePct)[0];
  const c1 = sides.find(c => c.player === match.team1);
  const c2 = sides.find(c => c.player === match.team2);
  results.push({
    match: `${match.team1} x ${match.team2}`,
    commence_time: match.commence_time,
    eventId: eventIdFor(match),
    player: best.player,
    market: MARKET,
    line: LINE,
    side: SIDE,
    odds: best.odds,
    bookmaker: match.bookmaker ?? null,
    modelProb: pct(best.calib.calibratedProb),
    rawProb: pct(best.rawProb),
    impliedProb: pct(best.impliedProb),
    edge: best.edgePct,
    kelly: best.kelly,
    segmentState: best.calib.segmentState,
    sampleSize: best.calib.sampleSize,
    modelProb1: pct(c1.calib.calibratedProb),
    modelProb2: pct(c2.calib.calibratedProb),
    rawProb1: pct(c1.rawProb),
    rawProb2: pct(c2.rawProb),
    impliedProb1: pct(c1.impliedProb),
    impliedProb2: pct(c2.impliedProb),
    edge1: c1.edgePct,
    edge2: c2.edgePct,
  });
}

console.log(`Partidas processadas: ${byGame.size} | Publicadas: ${results.length} | Descartadas: ${descartados}`);
const ledgerSummary = ledger.flush();
console.log(`Histórico de indicações (MLB H2H): ${ledgerSummary.partitionsSaved} partição(ões) atualizada(s), ${ledgerSummary.duplicatesInRun} indicação(ões) duplicada(s) na mesma execução.`);

results.sort((a, b) => b.edge - a.edge);
results.slice(0, 10).forEach((m, i) => {
  console.log(`[${i + 1}] ${m.match} | ${m.player} EDGE: ${m.edge}% | Kelly: ${m.kelly}%`);
});

fs.writeFileSync('mlb_results.json', JSON.stringify(results, null, 2));
console.log('mlb_results.json salvo.');
