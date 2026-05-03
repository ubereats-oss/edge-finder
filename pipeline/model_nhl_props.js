const fs = require('fs');
const path = require('path');

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

const CALIB_TABLE = [
  { raw: 0.521, cal: 0.435 },
  { raw: 0.578, cal: 0.476 },
  { raw: 0.623, cal: 0.525 },
  { raw: 0.676, cal: 0.572 },
  { raw: 0.724, cal: 0.608 },
  { raw: 0.773, cal: 0.675 },
  { raw: 0.824, cal: 0.709 },
  { raw: 0.874, cal: 0.750 },
  { raw: 0.924, cal: 0.803 },
  { raw: 0.974, cal: 0.833 },
];

function calibrate(p) {
  if (p < 0.5) return 1 - calibrate(1 - p);
  const n = CALIB_TABLE.length;
  if (p <= CALIB_TABLE[0].raw) {
    const slope = (CALIB_TABLE[1].cal - CALIB_TABLE[0].cal) / (CALIB_TABLE[1].raw - CALIB_TABLE[0].raw);
    return Math.min(1, Math.max(0, CALIB_TABLE[0].cal + slope * (p - CALIB_TABLE[0].raw)));
  }
  if (p >= CALIB_TABLE[n - 1].raw) {
    const slope = (CALIB_TABLE[n - 1].cal - CALIB_TABLE[n - 2].cal) / (CALIB_TABLE[n - 1].raw - CALIB_TABLE[n - 2].raw);
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
const results = [];

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

  const pOver  = calibrate(probOverRaw(stats.avg, stats.std, prop.line));
  const pUnder = calibrate(probUnderRaw(stats.avg, stats.std, prop.line));

  const impliedOver  = 1 / prop.oddsOver;
  const impliedUnder = 1 / prop.oddsUnder;
  const edgeOver  = pOver  - impliedOver;
  const edgeUnder = pUnder - impliedUnder;

  const bestSide = edgeOver >= edgeUnder ? 'Over' : 'Under';
  const bestProb = edgeOver >= edgeUnder ? pOver : pUnder;
  const bestOdds = edgeOver >= edgeUnder ? prop.oddsOver : prop.oddsUnder;
  const bestEdge = edgeOver >= edgeUnder ? edgeOver : edgeUnder;

  const edgePct           = parseFloat((bestEdge * 100).toFixed(2));
  const kellyCrit         = calcKelly(bestProb, bestOdds);
  const inefficientMarket = !stats.lowSample && edgePct >= INEFFICIENT_MARKET_EDGE;

  if (edgePct < 15) { continue; }
  results.push({
    game: prop.game,
    commence_time: prop.commence_time,
    player: prop.player,
    prop: prop.prop,
    location: prop.location,
    line: prop.line,
    playerAvg: stats.avg,
    playerStd: stats.std,
    playerAvg5: avg5,
    playerAvg10: avg10,
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
    contextGames: stats.contextGames,
    lowSample: stats.lowSample,
    inefficientMarket,
  });
}

console.log(`Props NHL: ${results.length} | Sem stats: ${descartadosSemStats} | Sigma baixo: ${descartadosSigmaBaixa} | Bloqueado: ${descartadosJogoBloqueado}`);
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
