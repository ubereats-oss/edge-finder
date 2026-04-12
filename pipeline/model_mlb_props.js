const fs = require('fs');
const path = require('path');

function readJsonSafe(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  const raw = fs.readFileSync(file, 'utf-8').trim();
  if (!raw) return fallback;
  try { return JSON.parse(raw); } catch (e) {
    console.warn(`Aviso: ${file} inválido — usando fallback. ${e.message}`);
    return fallback;
  }
}

const mlbStats   = readJsonSafe('mlb_player_stats.json', {});
const props      = readJsonSafe('mlb_props.json', []);
const playerTeamMap = readJsonSafe('mlb_player_team.json', {});

const SEASON_WEIGHT = { 2023: 1, 2024: 2, 2025: 3, 2026: 4 };
const MIN_GAMES_CONTEXT = 15;
const KELLY_FRACTION = 0.25;
const INEFFICIENT_MARKET_EDGE = 20;

// ── Calibração isotônica (MLB — usar mesma tabela NBA até backtest MLB)
const CALIB_TABLE = [
  { raw: 0.519, cal: 0.504 },
  { raw: 0.576, cal: 0.572 },
  { raw: 0.625, cal: 0.608 },
  { raw: 0.674, cal: 0.671 },
  { raw: 0.723, cal: 0.720 },
  { raw: 0.771, cal: 0.764 },
  { raw: 0.816, cal: 0.811 },
];

function calibrate(p) {
  if (p < 0.5) return 1 - calibrate(1 - p);
  const n = CALIB_TABLE.length;
  if (p <= CALIB_TABLE[0].raw) {
    const slope = (CALIB_TABLE[1].cal - CALIB_TABLE[0].cal) /
                  (CALIB_TABLE[1].raw - CALIB_TABLE[0].raw);
    return Math.min(1, Math.max(0, CALIB_TABLE[0].cal + slope * (p - CALIB_TABLE[0].raw)));
  }
  if (p >= CALIB_TABLE[n - 1].raw) {
    const slope = (CALIB_TABLE[n - 1].cal - CALIB_TABLE[n - 2].cal) /
                  (CALIB_TABLE[n - 1].raw - CALIB_TABLE[n - 2].raw);
    return Math.min(1, Math.max(0, CALIB_TABLE[n - 1].cal + slope * (p - CALIB_TABLE[n - 1].raw)));
  }
  for (let i = 0; i < n - 1; i++) {
    if (p >= CALIB_TABLE[i].raw && p <= CALIB_TABLE[i + 1].raw) {
      const t = (p - CALIB_TABLE[i].raw) / (CALIB_TABLE[i + 1].raw - CALIB_TABLE[i].raw);
      return CALIB_TABLE[i].cal + t * (CALIB_TABLE[i + 1].cal - CALIB_TABLE[i].cal);
    }
  }
  return p;
}

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

function calcKelly(p, odd) {
  const b = odd - 1;
  const q = 1 - p;
  const kelly = (p * b - q) / b;
  return Math.max(0, parseFloat((kelly * KELLY_FRACTION * 100).toFixed(2)));
}

function findPlayer(name) {
  if (mlbStats[name]) return mlbStats[name];
  const lower = name.toLowerCase();
  for (const key of Object.keys(mlbStats)) {
    if (key.toLowerCase().includes(lower) || lower.includes(key.toLowerCase())) {
      return mlbStats[key];
    }
  }
  return null;
}

function combineContexts(playerData, statKey) {
  let weightedSum = 0;
  let weightedSumSq = 0;
  let totalWeight = 0;
  let totalGames = 0;
  let currentSeasonGames = 0;
  const entries = [];

  for (const [seasonStr, seasonData] of Object.entries(playerData)) {
    const season = parseInt(seasonStr);
    const w = SEASON_WEIGHT[season] || 1;

    for (const gameType of ['regular']) {
      for (const location of ['home', 'away']) {
        const ctx = seasonData?.[gameType]?.[location];
        if (!ctx) continue;
        const values = ctx[statKey];
        if (!Array.isArray(values)) continue;
        for (const v of values) {
          const val = typeof v === 'object' ? v.value : v;
          const date = typeof v === 'object' ? (v.date || '') : '';
          weightedSum += val * w;
          weightedSumSq += val * val * w;
          totalWeight += w;
          totalGames++;
          if (season === 2026) currentSeasonGames++;
          entries.push({ val, date });
        }
      }
    }
  }

  if (totalWeight === 0) return null;

  const avg = weightedSum / totalWeight;
  const variance = Math.max(0, weightedSumSq / totalWeight - avg * avg);

  entries.sort((a, b) => b.date.localeCompare(a.date));
  const avg5  = entries.length >= 1 ? parseFloat((entries.slice(0, 5).reduce((s, e) => s + e.val, 0) / Math.min(5, entries.length)).toFixed(2)) : null;
  const avg10 = entries.length >= 1 ? parseFloat((entries.slice(0, 10).reduce((s, e) => s + e.val, 0) / Math.min(10, entries.length)).toFixed(2)) : null;

  return {
    avg: parseFloat(avg.toFixed(3)),
    std: parseFloat(Math.sqrt(variance).toFixed(3)),
    totalGames,
    currentSeasonGames,
    lowSample: currentSeasonGames < MIN_GAMES_CONTEXT,
    avg5,
    avg10,
  };
}

const PROP_CONFIG = {
  hits:        { key: 'hits' },
  homeRuns:    { key: 'homeRuns' },
  strikeouts:  { key: 'strikeouts' },
  hitsAllowed: { key: 'hitsAllowed' },
};

if (!props.length) {
  console.log('mlb_props.json vazio — sem props disponíveis.');
  process.exit(0);
}

if (Object.keys(mlbStats).length === 0) {
  console.error('mlb_player_stats.json vazio ou ausente — rode get_mlb_player_stats.js primeiro.');
  process.exit(1);
}

const NOW = Date.now();
let descartadosSemStats = 0;
let descartadosSigmaBaixa = 0;
let descartadosJogoBloqueado = 0;
const results = [];

for (const prop of props) {
  const commence = new Date(prop.commence_time).getTime();
  if (commence - NOW < 0) { descartadosJogoBloqueado++; continue; }

  const config = PROP_CONFIG[prop.prop];
  if (!config) continue;

  const playerData = findPlayer(prop.player);
  if (!playerData) { descartadosSemStats++; continue; }

  const stats = combineContexts(playerData, config.key);
  if (!stats) { descartadosSemStats++; continue; }
  if (stats.std < 0.1) { descartadosSigmaBaixa++; continue; }

  const marginRatio = Math.abs(prop.line - stats.avg) / stats.std;
  if (marginRatio < 0.75) continue;

  const pOverRaw  = probOverRaw(stats.avg, stats.std, prop.line);
  const pUnderRaw = probUnderRaw(stats.avg, stats.std, prop.line);

  const pOver  = calibrate(pOverRaw);
  const pUnder = calibrate(pUnderRaw);

  const impliedOver  = 1 / prop.oddsOver;
  const impliedUnder = 1 / prop.oddsUnder;

  const edgeOver  = pOver  - impliedOver;
  const edgeUnder = pUnder - impliedUnder;

  const bestSide  = edgeOver >= edgeUnder ? 'Over' : 'Under';
  const bestProb  = edgeOver >= edgeUnder ? pOver : pUnder;
  const bestOdds  = edgeOver >= edgeUnder ? prop.oddsOver : prop.oddsUnder;
  const bestEdge  = edgeOver >= edgeUnder ? edgeOver : edgeUnder;

  const edgePct           = parseFloat((bestEdge * 100).toFixed(2));
  const kellyCrit         = calcKelly(bestProb, bestOdds);
  const inefficientMarket = !stats.lowSample && edgePct >= INEFFICIENT_MARKET_EDGE;

  results.push({
    game: prop.game,
    commence_time: prop.commence_time,
    player: prop.player,
    prop: prop.prop,
    isPitcher: prop.isPitcher,
    line: prop.line,
    playerAvg: stats.avg,
    playerStd: stats.std,
    playerAvg5: stats.avg5,
    playerAvg10: stats.avg10,
    playerTeam: playerTeamMap[prop.player] ?? null,
    side: bestSide,
    modelProb: parseFloat((bestProb * 100).toFixed(1)),
    impliedProb: parseFloat(((1 / bestOdds) * 100).toFixed(1)),
    edge: edgePct,
    odds: bestOdds,
    oddsOver: prop.oddsOver,
    oddsUnder: prop.oddsUnder,
    kelly: kellyCrit,
    totalGames: stats.totalGames,
    currentSeasonGames: stats.currentSeasonGames,
    lowSample: stats.lowSample,
    inefficientMarket,
  });
}

console.log(`Props processadas: ${results.length} | Sem stats: ${descartadosSemStats} | Sigma baixo: ${descartadosSigmaBaixa} | Jogo bloqueado: ${descartadosJogoBloqueado}`);

results.sort((a, b) => b.edge - a.edge);

results.slice(0, 15).forEach((r, i) => {
  const warn = r.lowSample ? ' ⚠️' : '';
  const target = r.inefficientMarket ? ' 🎯' : '';
  console.log(`[${i + 1}] ${r.player}${warn}${target} | ${r.prop} ${r.side} ${r.line} | Edge: ${r.edge}% | Kelly: ${r.kelly}%`);
});

fs.writeFileSync('mlb_props_results.json', JSON.stringify(results, null, 2));
console.log('mlb_props_results.json salvo.');

const HISTORY_DIR = path.join(__dirname, '..', 'odds_history');
if (!fs.existsSync(HISTORY_DIR)) fs.mkdirSync(HISTORY_DIR, { recursive: true });
const today = new Date().toISOString().slice(0, 10);
const month = new Date().toISOString().slice(0, 7);
const modelHistFile = path.join(HISTORY_DIR, `baseball_mlb_model_${month}.json`);
const modelHist = readJsonSafe(modelHistFile, []);
const existing = new Set(modelHist.map(e => e._key));
let added = 0;
for (const r of results) {
  const key = `${r.game}|${r.player}|${r.prop}|${r.side}|${today}`;
  if (existing.has(key)) continue;
  modelHist.push({ _key: key, savedDate: today, savedAt: new Date().toISOString(), ...r });
  existing.add(key);
  added++;
}
fs.writeFileSync(modelHistFile, JSON.stringify(modelHist, null, 2));
console.log(`Histórico do modelo salvo: +${added} entradas.`);
