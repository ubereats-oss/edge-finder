const fs = require('fs');
const ledger = require('./model_ledger');
const calibration = require('./calibration');
const riskGuards = require('./risk_guards');
const riskConfig = require('./risk_config');

const ESPORTE = 'basketball/nba';
const RUN_ID = new Date().toISOString();

const playerStats = JSON.parse(fs.readFileSync('nba_player_stats.json'));
const props = JSON.parse(fs.readFileSync('nba_props.json'));

const SEASON_WEIGHT = { 2024: 1, 2025: 2, 2026: 3 };
const MIN_GAMES_CONTEXT = 10;
const INEFFICIENT_MARKET_EDGE = 20;
const KELLY_FRACTION = riskConfig.KELLY_FRACTION;

// ── Distribuição normal ────────────────────────────────────────────────────────

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

// ── Stats ──────────────────────────────────────────────────────────────────────

function combineContexts(playerData, statKey, locations, gameTypes) {
  let weightedSum = 0;
  let weightedSumSq = 0;
  let totalWeight = 0;
  let totalGames = 0;
  let contextGames = 0;

  for (const [seasonStr, seasonData] of Object.entries(playerData)) {
    const season = parseInt(seasonStr);
    const w = SEASON_WEIGHT[season] || 1;

    for (const gameType of gameTypes) {
      for (const location of locations) {
        const ctx = seasonData?.[gameType]?.[location];
        if (!ctx || !ctx[statKey] || !Array.isArray(ctx[statKey])) continue;

        for (const v of ctx[statKey]) {
          weightedSum += v * w;
          weightedSumSq += v * v * w;
          totalWeight += w;
          totalGames++;
          if (season === 2026) contextGames++;
        }
      }
    }
  }

  if (totalWeight === 0) return null;

  const avg = weightedSum / totalWeight;
  const variance = Math.max(0, weightedSumSq / totalWeight - avg * avg);

  return {
    avg: parseFloat(avg.toFixed(2)),
    std: parseFloat(Math.sqrt(variance).toFixed(2)),
    totalGames,
    contextGames,
    lowSample: contextGames < MIN_GAMES_CONTEXT,
  };
}

function findPlayer(name) {
  if (playerStats[name]) return playerStats[name];
  const lower = name.toLowerCase();
  for (const key of Object.keys(playerStats)) {
    if (key.toLowerCase().includes(lower) || lower.includes(key.toLowerCase())) {
      return playerStats[key];
    }
  }
  return null;
}

const PROP_MAP = {
  points: 'points',
  rebounds: 'rebounds',
  assists: 'assists',
  steals: 'steals',
  threes: 'threes',
  fouls: 'fouls',
};

// ── Main ───────────────────────────────────────────────────────────────────────

if (!props.length) {
  console.log('nba_props.json vazio — sem props disponíveis.');
  process.exit(0);
}

const NOW = Date.now();
const MIN_15 = 15 * 60 * 1000;

let descartadosSemStats = 0;
let descartadosSigmaBaixa = 0;
let descartadosJogoBloqueado = 0;
const candidates = [];

for (const prop of props) {
  const commence = new Date(prop.commence_time).getTime();
  if (commence - NOW < MIN_15) { descartadosJogoBloqueado++; continue; }

  const playerData = findPlayer(prop.player);
  if (!playerData) { descartadosSemStats++; continue; }

  const statKey = PROP_MAP[prop.prop];
  if (!statKey) continue;

  const locations = prop.location === 'home' || prop.location === 'away'
    ? [prop.location]
    : ['home', 'away'];

  const stats = combineContexts(playerData, statKey, locations, ['regular']);
  if (!stats) { descartadosSemStats++; continue; }
  if (stats.std < 0.3) { descartadosSigmaBaixa++; continue; }

  // Probabilidades brutas da distribuição normal
  const rawOver  = probOverRaw(stats.avg, stats.std, prop.line);
  const rawUnder = probUnderRaw(stats.avg, stats.std, prop.line);

  const impliedOver  = 1 / prop.oddsOver;
  const impliedUnder = 1 / prop.oddsUnder;

  const calibOver  = calibration.calibrate({ esporte: ESPORTE, market: prop.prop, rawProb: rawOver,  impliedProb: impliedOver });
  const calibUnder = calibration.calibrate({ esporte: ESPORTE, market: prop.prop, rawProb: rawUnder, impliedProb: impliedUnder });

  const edgeOver  = calibOver.calibratedProb  - impliedOver;
  const edgeUnder = calibUnder.calibratedProb - impliedUnder;

  const overIsBest  = edgeOver >= edgeUnder;
  const bestSide    = overIsBest ? 'Over' : 'Under';
  const bestCalib   = overIsBest ? calibOver : calibUnder;
  const bestRawProb = overIsBest ? rawOver : rawUnder;
  const bestOdds    = overIsBest ? prop.oddsOver : prop.oddsUnder;
  const bestEdge    = overIsBest ? edgeOver : edgeUnder;

  const edgePct        = parseFloat((bestEdge * 100).toFixed(2));
  const kellyCrit      = calcKelly(bestCalib.calibratedProb, bestOdds, bestCalib.stakeFraction);
  const inefficientMarket = !stats.lowSample && edgePct >= INEFFICIENT_MARKET_EDGE;

  const segmentDisabled = riskConfig.isSegmentDisabled(ESPORTE, prop.prop);
  const passedMinEdge   = edgePct >= riskConfig.MIN_EDGE_PCT;
  const edgeTooHigh     = edgePct > riskConfig.EDGE_CAP_PCT;

  let published = passedMinEdge && !segmentDisabled && !edgeTooHigh;
  let rejectionReason = null;
  if (segmentDisabled) rejectionReason = ledger.REJECTION_REASONS.SEGMENTO_DESABILITADO;
  else if (!passedMinEdge) rejectionReason = ledger.REJECTION_REASONS.EDGE_ABAIXO_LIMIAR;
  else if (edgeTooHigh) rejectionReason = ledger.REJECTION_REASONS.GUARDA_EDGE_MAXIMO;

  candidates.push({
    prop, stats, bestSide, bestOdds, bestEdge, edgePct, kellyCrit,
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
    bookmaker: c.prop.bookmaker ?? null,
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
    side: c.bestSide,
    modelProb: parseFloat((c.bestCalib.calibratedProb * 100).toFixed(1)),
    rawProb: parseFloat((c.bestRawProb * 100).toFixed(1)),
    impliedProb: parseFloat(((1 / c.bestOdds) * 100).toFixed(1)),
    edge: c.edgePct,
    odds: c.bestOdds,
    kelly: c.kellyCrit,
    totalGames: c.stats.totalGames,
    contextGames: c.stats.contextGames,
    lowSample: c.stats.lowSample,
    inefficientMarket: c.inefficientMarket,
    segmentState: c.bestCalib.segmentState,
    sampleSize: c.bestCalib.sampleSize,
  });
}

const descartadosGuardas = candidates.filter(c => !c.published && c.rejectionReason).length;
console.log(`Props processadas: ${results.length} | Sem stats: ${descartadosSemStats} | Sigma baixo: ${descartadosSigmaBaixa} | Jogo bloqueado: ${descartadosJogoBloqueado} | Rejeitadas por guarda/segmento: ${descartadosGuardas}`);

const ledgerSummary = ledger.flush();
console.log(`Histórico de indicações (NBA): ${ledgerSummary.partitionsSaved} partição(ões) atualizada(s), ${ledgerSummary.duplicatesInRun} indicação(ões) duplicada(s) na mesma execução.`);

results.sort((a, b) => b.edge - a.edge);

results.slice(0, 15).forEach((r, i) => {
  const warn   = r.lowSample        ? ' ⚠️' : '';
  const target = r.inefficientMarket ? ' 🎯' : '';
  const loc    = r.location !== 'unknown' ? ` [${r.location}]` : '';
  console.log(
    `[${i + 1}] ${r.player}${warn}${target}${loc} | ${r.prop} ${r.side} ${r.line} | Edge: ${r.edge}% | Kelly: ${r.kelly}%`
  );
});

fs.writeFileSync('nba_props_results.json', JSON.stringify(results, null, 2));
console.log('nba_props_results.json salvo.');
