const fs = require('fs');
const ledger = require('./model_ledger');
const calibration = require('./calibration');
const riskGuards = require('./risk_guards');
const riskConfig = require('./risk_config');

const ESPORTE = 'basketball/nba';
const RUN_ID = new Date().toISOString();
const MARKET = 'h2h';
const LINE = 0;
const SIDE = 'Win';

if (!fs.existsSync('nba_rating.json')) { console.log('nba_rating.json não encontrado — pulando modelo NBA H2H.'); process.exit(0); }
if (!fs.existsSync('nba_odds.json')) { console.log('nba_odds.json não encontrado — pulando modelo NBA H2H.'); process.exit(0); }

function readJsonSafe(file, fallback) {
  if (!fs.existsSync(file)) return fallback;

  const raw = fs.readFileSync(file, 'utf-8').trim();
  if (!raw) return fallback;

  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

const rating = readJsonSafe('nba_rating.json', {});
const odds = readJsonSafe('nba_odds.json', []);

const KELLY_FRACTION = riskConfig.KELLY_FRACTION;

// Sigma calibrado via backtesting walk-forward (1105 jogos, temporada 2025-26)
// Sigma 12 apresentou menor desvio médio absoluto de calibração (3.99%)
// vs sigma 10 (4.55%), 14 (5.13%) e 16 (4.92%)
const SIGMA = 12;

function calcProb(r1, r2) {
  return 1 / (1 + Math.exp(-(r1 - r2) / SIGMA));
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
  console.log('nba_odds.json vazio — sem partidas disponíveis no momento.');
  process.exit(0);
}

const NOW = Date.now();
const MIN_15 = 15 * 60 * 1000;

let descartados = 0;
let descartadosJogoBloqueado = 0;
const byGame = new Map();
const candidates = [];

for (const m of odds) {
  const commence = new Date(m.commence_time).getTime();
  if (commence - NOW < MIN_15) { descartadosJogoBloqueado++; continue; }

  const r1data = rating[m.team1];
  const r2data = rating[m.team2];
  if (!r1data || !r2data) { descartados++; continue; }

  // team1 = visitante (away), team2 = mandante (home)
  const r1 = typeof r1data === 'object' ? r1data.away : r1data;
  const r2 = typeof r2data === 'object' ? r2data.home : r2data;
  if (r1 === undefined || r2 === undefined) { descartados++; continue; }

  const rawProb1 = calcProb(r1, r2);
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

console.log(`Partidas processadas: ${byGame.size} | Publicadas: ${results.length} | Descartadas (sem rating): ${descartados} | Jogo bloqueado: ${descartadosJogoBloqueado}`);

const ledgerSummary = ledger.flush();
console.log(`Histórico de indicações (NBA H2H): ${ledgerSummary.partitionsSaved} partição(ões) atualizada(s), ${ledgerSummary.duplicatesInRun} indicação(ões) duplicada(s) na mesma execução.`);

if (results.length) {
  results
    .sort((a, b) => b.edge - a.edge)
    .slice(0, 10)
    .forEach((m, i) => {
      console.log(`[${i + 1}] ${m.match} | ${m.player} EDGE: ${m.edge}% | Kelly: ${m.kelly}%`);
    });
}

fs.writeFileSync('nba_results.json', JSON.stringify(results, null, 2));
console.log('nba_results.json salvo.');
