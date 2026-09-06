const fs = require('fs');
const path = require('path');
const ledger = require('./model_ledger');
const calibration = require('./calibration');
const riskGuards = require('./risk_guards');
const riskConfig = require('./risk_config');

const ESPORTE = 'hockey/nhl';
const RUN_ID = new Date().toISOString();
const MIN_EDGE_PCT = 15;

function readJsonSafe(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  const raw = fs.readFileSync(file, 'utf-8').trim();
  if (!raw) return fallback;
  try { return JSON.parse(raw); } catch (e) {
    console.warn(`Aviso: ${file} inválido. ${e.message}`);
    return fallback;
  }
}

const playerStats  = readJsonSafe('nhl_player_stats.json', {});
const props        = readJsonSafe('nhl_props.json', []);
const playerTeamMap = readJsonSafe('nhl_player_team.json', {});

const SEASON_WEIGHT = { 2024: 1, 2025: 2, 2026: 3 };
const MIN_GAMES_CONTEXT = 8;
const INEFFICIENT_MARKET_EDGE = 20;
const KELLY_FRACTION = 0.25;

function erf(x) {
  const sign = x >= 0 ? 1 : -1;
  x = Math.abs(x);
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741;
  const a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const t = 1 / (1 + p * x);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return sign * y;
}

function normalCDF(x, mu, sigma) {
  if (sigma <= 0) return x >= mu ? 1 : 0;
  return 0.5 * (1 + erf((x - mu) / (sigma * Math.sqrt(2))));
}

function probOverRaw(mu, sigma, line) { return 1 - normalCDF(line, mu, sigma); }
function probUnderRaw(mu, sigma, line) { return normalCDF(line, mu, sigma); }

function calcKelly(p, odd, stakeFraction = 1) {
  const b = odd - 1;
  const q = 1 - p;
  const kelly = (p * b - q) / b;
  return Math.max(0, parseFloat((kelly * KELLY_FRACTION * stakeFraction * 100).toFixed(2)));
}

function findPlayer(name) {
  if (playerStats[name]) return playerStats[name];
  const lower = name.toLowerCase();
  for (const key of Object.keys(playerStats)) {
    if (key.toLowerCase().includes(lower) || lower.includes(key.toLowerCase())) return playerStats[key];
  }
  return null;
}

function calcRecentAvg(playerData, statKey, n) {
  const entries = [];
  for (const seasonData of Object.values(playerData)) {
    for (const gameTypeData of Object.values(seasonData)) {
      for (const loc of ['home', 'away']) {
        const ctx = gameTypeData[loc];
        if (!ctx || !ctx[statKey] || !Array.isArray(ctx[statKey])) continue;
        for (const entry of ctx[statKey]) {
          if (entry.blowout) continue;
          const val = typeof entry === 'object' ? entry.value : entry;
          const date = entry.date || '';
          entries.push({ val, date });
        }
      }
    }
  }
  entries.sort((a, b) => b.date.localeCompare(a.date));
  const slice = entries.slice(0, n);
  if (!slice.length) return null;
  return parseFloat((slice.reduce((s, e) => s + e.val, 0) / slice.length).toFixed(2));
}

function combineContexts(playerData, statKey, locations) {
  let weightedSum = 0, weightedSumSq = 0, totalWeight = 0, totalGames = 0, contextGames = 0;

  for (const [seasonStr, seasonData] of Object.entries(playerData)) {
    const season = parseInt(seasonStr);
    const w = SEASON_WEIGHT[season] || 1;
    for (const loc of locations) {
      const ctx = seasonData?.regular?.[loc];
      if (!ctx || !ctx[statKey] || !Array.isArray(ctx[statKey])) continue;
      for (const entry of ctx[statKey]) {
        if (entry.blowout) continue;
        const value = typeof entry === 'object' ? entry.value : entry;
        weightedSum += value * w;
        weightedSumSq += value * value * w;
        totalWeight += w;
        totalGames++;
        if (season === 2026) contextGames++;
      }
    }
  }

  if (totalWeight === 0) return null;
  const avg = weightedSum / totalWeight;
  const variance = Math.max(0, weightedSumSq / totalWeight - avg * avg);
  return {
    avg: parseFloat(avg.toFixed(2)),
    std: parseFloat(Math.sqrt(variance).toFixed(2)),
    totalGames, contextGames,
    lowSample: contextGames < MIN_GAMES_CONTEXT,
  };
}

const PROP_MAP = {
  goals:   'goals',
  assists:  'assists',
  points:   'points',
  // shots desativado — ROI de -4.76% no backtest (viés de mercado eficiente)
  blocked: 'blocked',
};

if (!props.length) { console.log('nhl_props.json vazio.'); process.exit(0); }
if (Object.keys(playerStats).length === 0) {
  console.error('nhl_player_stats.json ausente.');
  process.exit(1);
}

const NOW = Date.now();
let descartadosSemStats = 0, descartadosSigmaBaixa = 0, descartadosJogoBloqueado = 0;
const candidates = [];

for (const prop of props) {
  const commence = new Date(prop.commence_time).getTime();
  if (commence - NOW < 0) { descartadosJogoBloqueado++; continue; }

  const statKey = PROP_MAP[prop.prop];
  if (!statKey) continue;

  const playerData = findPlayer(prop.player);
  if (!playerData) { descartadosSemStats++; continue; }

  const locations = prop.location === 'home' || prop.location === 'away'
    ? [prop.location] : ['home', 'away'];

  const stats = combineContexts(playerData, statKey, locations);
  if (!stats) { descartadosSemStats++; continue; }
  if (stats.std < 0.2) { descartadosSigmaBaixa++; continue; }

  const marginRatio = Math.abs(prop.line - stats.avg) / stats.std;
  if (marginRatio < 0.4) continue;

  const avg5  = calcRecentAvg(playerData, statKey, 5);
  const avg10 = calcRecentAvg(playerData, statKey, 10);

  const rawOver  = probOverRaw(stats.avg, stats.std, prop.line);
  const rawUnder = probUnderRaw(stats.avg, stats.std, prop.line);

  const impliedOver  = 1 / prop.oddsOver;
  const impliedUnder = 1 / prop.oddsUnder;

  const calibOver  = calibration.calibrate({ esporte: ESPORTE, market: prop.prop, rawProb: rawOver,  impliedProb: impliedOver });
  const calibUnder = calibration.calibrate({ esporte: ESPORTE, market: prop.prop, rawProb: rawUnder, impliedProb: impliedUnder });

  const edgeOver  = calibOver.calibratedProb  - impliedOver;
  const edgeUnder = calibUnder.calibratedProb - impliedUnder;

  const overIsBest = edgeOver >= edgeUnder;
  const bestSide   = overIsBest ? 'Over' : 'Under';
  const bestCalib  = overIsBest ? calibOver : calibUnder;
  const bestRawProb = overIsBest ? rawOver : rawUnder;
  const bestOdds   = overIsBest ? prop.oddsOver : prop.oddsUnder;
  const bestEdge   = overIsBest ? edgeOver : edgeUnder;

  const edgePct           = parseFloat((bestEdge * 100).toFixed(2));
  const kellyCrit         = calcKelly(bestCalib.calibratedProb, bestOdds, bestCalib.stakeFraction);
  const inefficientMarket = !stats.lowSample && edgePct >= INEFFICIENT_MARKET_EDGE;

  const segmentDisabled = riskConfig.isSegmentDisabled(ESPORTE, prop.prop);
  const passedMinEdge   = edgePct >= MIN_EDGE_PCT;
  const edgeTooHigh     = edgePct > riskConfig.EDGE_CAP_PCT;

  let published = passedMinEdge && !segmentDisabled && !edgeTooHigh;
  let rejectionReason = null;
  if (!passedMinEdge) rejectionReason = ledger.REJECTION_REASONS.EDGE_ABAIXO_LIMIAR;
  else if (segmentDisabled) rejectionReason = ledger.REJECTION_REASONS.SEGMENTO_DESABILITADO;
  else if (edgeTooHigh) rejectionReason = ledger.REJECTION_REASONS.GUARDA_EDGE_MAXIMO;

  candidates.push({
    prop, stats, avg5, avg10, bestSide, bestOdds, bestEdge, edgePct, kellyCrit,
    bestRawProb, bestCalib, inefficientMarket, published, rejectionReason,
    game: prop.game, player: prop.player,
  });
}

riskGuards.applyGameGuards(candidates);

const results = [];
for (const c of candidates) {
  ledger.recordEvaluation({
    esporte: ESPORTE,
    eventId: c.prop.eventId ?? `${c.prop.game}|${c.prop.commence_time}`,
    game: c.prop.game,
    commenceTime: c.prop.commence_time,
    player: c.prop.player,
    market: c.prop.prop,
    line: c.prop.line,
    side: c.bestSide,
    modelProb: parseFloat((c.bestCalib.calibratedProb * 100).toFixed(1)),
    rawProb: parseFloat((c.bestRawProb * 100).toFixed(1)),
    odds: c.bestOdds,
    bookmaker: c.bestSide === 'Over' ? (c.prop.bookmakerOver ?? null) : (c.prop.bookmakerUnder ?? null),
    edge: c.edgePct,
    kelly: c.kellyCrit,
    published: c.published,
    rejectionReason: c.rejectionReason,
    segmentState: c.bestCalib.segmentState,
    sampleSize: c.bestCalib.sampleSize,
    runId: RUN_ID,
  });

  if (!c.published) continue;
  results.push({
    game: c.prop.game,
    commence_time: c.prop.commence_time,
    player: c.prop.player,
    prop: c.prop.prop,
    location: c.prop.location,
    line: c.prop.line,
    playerAvg: c.stats.avg,
    playerStd: c.stats.std,
    playerAvg5: c.avg5,
    playerAvg10: c.avg10,
    playerTeam: playerTeamMap[c.prop.player] ?? null,
    side: c.bestSide,
    modelProb: parseFloat((c.bestCalib.calibratedProb * 100).toFixed(1)),
    rawProb: parseFloat((c.bestRawProb * 100).toFixed(1)),
    impliedProb: parseFloat(((1 / c.bestOdds) * 100).toFixed(1)),
    edge: c.edgePct,
    odds: c.bestOdds,
    oddsOver: c.prop.oddsOver,
    oddsUnder: c.prop.oddsUnder,
    kelly: c.kellyCrit,
    totalGames: c.stats.totalGames,
    contextGames: c.stats.contextGames,
    lowSample: c.stats.lowSample,
    inefficientMarket: c.inefficientMarket,
    segmentState: c.bestCalib.segmentState,
    sampleSize: c.bestCalib.sampleSize,
    pinnacleId: c.prop.pinnacleId ?? null,
    pinnacleSlug: c.prop.pinnacleSlug ?? null,
  });
}

const descartadosGuardas = candidates.filter(c => !c.published && c.rejectionReason && c.rejectionReason !== ledger.REJECTION_REASONS.EDGE_ABAIXO_LIMIAR).length;
console.log(`Props NHL: ${results.length} | Sem stats: ${descartadosSemStats} | Sigma baixo: ${descartadosSigmaBaixa} | Bloqueado: ${descartadosJogoBloqueado} | Rejeitadas por guarda/segmento: ${descartadosGuardas}`);

const ledgerSummary = ledger.flush();
console.log(`Histórico de indicações (NHL): ${ledgerSummary.partitionsSaved} partição(ões) atualizada(s), ${ledgerSummary.duplicatesInRun} indicação(ões) duplicada(s) na mesma execução.`);

results.sort((a, b) => b.edge - a.edge);

results.slice(0, 10).forEach((r, i) => {
  const warn = r.lowSample ? ' ⚠️' : '';
  const target = r.inefficientMarket ? ' 🎯' : '';
  console.log(`[${i + 1}] ${r.player}${warn}${target} | ${r.prop} ${r.side} ${r.line} | Edge: ${r.edge}% | Kelly: ${r.kelly}%`);
});

fs.writeFileSync('nhl_props_results.json', JSON.stringify(results, null, 2));
console.log('nhl_props_results.json salvo.');

const HISTORY_DIR = path.join(__dirname, '..', 'odds_history');
if (!fs.existsSync(HISTORY_DIR)) fs.mkdirSync(HISTORY_DIR, { recursive: true });
const today = new Date().toISOString().slice(0, 10);
const month = new Date().toISOString().slice(0, 7);
const histFile = path.join(HISTORY_DIR, `hockey_nhl_model_${month}.json`);
const hist = readJsonSafe(histFile, []);
const existingKeys = new Set(hist.map(e => e._key));
let added = 0;
for (const r of results) {
  const key = `${r.game}|${r.player}|${r.prop}|${r.side}|${today}`;
  if (existingKeys.has(key)) continue;
  hist.push({ _key: key, savedDate: today, savedAt: new Date().toISOString(), ...r });
  existingKeys.add(key);
  added++;
}
fs.writeFileSync(histFile, JSON.stringify(hist, null, 2));
console.log(`Histórico NHL: +${added} entradas.`);
