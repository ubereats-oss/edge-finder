const fs = require('fs');

const playerStats = JSON.parse(fs.readFileSync('nba_player_stats.json'));
const props = JSON.parse(fs.readFileSync('nba_props_pinnacle.json'));

const SEASON_WEIGHT = { 2024: 1, 2025: 2, 2026: 3 };
const MIN_GAMES_CONTEXT = 10;
const INEFFICIENT_MARKET_EDGE = 20;
const KELLY_FRACTION = 0.25;

// ── Calibração isotônica ───────────────────────────────────────────────────────
const CALIB_TABLE = [
  { raw: 0.525, cal: 0.500 },
  { raw: 0.575, cal: 0.534 },
  { raw: 0.625, cal: 0.577 },
  { raw: 0.675, cal: 0.618 },
  { raw: 0.725, cal: 0.655 },
  { raw: 0.775, cal: 0.687 },
  { raw: 0.825, cal: 0.721 },
  { raw: 0.875, cal: 0.760 },
  { raw: 0.925, cal: 0.813 },
  { raw: 0.975, cal: 0.818 },
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

if (!props.length) {
  console.log('nba_props_pinnacle.json vazio — rode get_nba_props_br.js primeiro.');
  process.exit(0);
}

const NOW = Date.now();
const MIN_15 = 15 * 60 * 1000;

let descartadosSemStats = 0;
let descartadosSigmaBaixa = 0;
let descartadosJogoBloqueado = 0;
const results = [];

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

  const pOverRaw  = probOverRaw(stats.avg, stats.std, prop.line);
  const pUnderRaw = probUnderRaw(stats.avg, stats.std, prop.line);

  const pOver  = calibrate(pOverRaw);
  const pUnder = calibrate(pUnderRaw);

  const impliedOver  = 1 / prop.oddsOver;
  const impliedUnder = 1 / prop.oddsUnder;

  const edgeOver  = pOver  - impliedOver;
  const edgeUnder = pUnder - impliedUnder;

  const bestSide  = edgeOver >= edgeUnder ? 'Over' : 'Under';
  const bestEdge  = edgeOver >= edgeUnder ? edgeOver : edgeUnder;
  const bestProb  = edgeOver >= edgeUnder ? pOver : pUnder;
  const bestOdds  = edgeOver >= edgeUnder ? prop.oddsOver : prop.oddsUnder;

  const edgePct           = parseFloat((bestEdge * 100).toFixed(2));
  const kellyCrit         = calcKelly(bestProb, bestOdds);
  const inefficientMarket = !stats.lowSample && edgePct >= INEFFICIENT_MARKET_EDGE;

  results.push({
    game: prop.game,
    commence_time: prop.commence_time,
    player: prop.player,
    prop: prop.prop,
    location: prop.location,
    line: prop.line,
    playerAvg: stats.avg,
    playerStd: stats.std,
    side: bestSide,
    modelProb: parseFloat((bestProb * 100).toFixed(1)),
    impliedProb: parseFloat(((1 / bestOdds) * 100).toFixed(1)),
    edge: edgePct,
    odds: bestOdds,
    kelly: kellyCrit,
    totalGames: stats.totalGames,
    contextGames: stats.contextGames,
    lowSample: stats.lowSample,
    inefficientMarket,
  });
}

console.log(`Props processadas: ${results.length} | Sem stats: ${descartadosSemStats} | Sigma baixo: ${descartadosSigmaBaixa} | Jogo bloqueado: ${descartadosJogoBloqueado}`);

results.sort((a, b) => b.edge - a.edge);

results.slice(0, 15).forEach((r, i) => {
  const warn   = r.lowSample         ? ' ⚠️' : '';
  const target = r.inefficientMarket ? ' 🎯' : '';
  const loc    = r.location !== 'unknown' ? ` [${r.location}]` : '';
  console.log(
    `[${i + 1}] ${r.player}${warn}${target}${loc} | ${r.prop} ${r.side} ${r.line} | Edge: ${r.edge}% | Kelly: ${r.kelly}%`
  );
});

fs.writeFileSync('nba_props_br_results.json', JSON.stringify(results, null, 2));
console.log('nba_props_br_results.json salvo.');
