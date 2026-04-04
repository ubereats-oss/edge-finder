const fs = require('fs');

const batterStats = JSON.parse(fs.readFileSync('mlb_batter_stats.json'));
const pitcherStats = JSON.parse(fs.readFileSync('mlb_pitcher_stats.json'));
const props = JSON.parse(fs.readFileSync('mlb_props.json'));

const SEASON_WEIGHT = { 2023: 1, 2024: 2, 2025: 3, 2026: 4 };
const MIN_GAMES_CONTEXT = 15;
const KELLY_FRACTION = 0.25;
const INEFFICIENT_MARKET_EDGE = 20;

// Distribuição normal
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

function probOver(mu, sigma, line) { return 1 - normalCDF(line, mu, sigma); }
function probUnder(mu, sigma, line) { return normalCDF(line, mu, sigma); }
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
  let currentSeasonGames = 0;

  for (const [seasonStr, seasonData] of Object.entries(playerData)) {
    const season = parseInt(seasonStr);
    const w = SEASON_WEIGHT[season] || 1;

    for (const gameType of gameTypes) {
      for (const location of locations) {
        const ctx = seasonData?.[gameType]?.[location];
        if (!ctx) continue;

        for (const key of Object.keys(ctx)) {
          if (key !== statKey) continue;
          const values = ctx[key];
          if (!Array.isArray(values)) continue;
          for (const v of values) {
            weightedSum += v * w;
            weightedSumSq += v * v * w;
            totalWeight += w;
            totalGames++;
            if (season === 2026) currentSeasonGames++;
          }
        }
      }
    }
  }

  if (totalWeight === 0) return null;

  const avg = weightedSum / totalWeight;
  const variance = Math.max(0, weightedSumSq / totalWeight - avg * avg);

  return {
    avg: parseFloat(avg.toFixed(3)),
    std: parseFloat(Math.sqrt(variance).toFixed(3)),
    totalGames,
    currentSeasonGames,
    lowSample: currentSeasonGames < MIN_GAMES_CONTEXT,
  };
}

function findPlayer(name, db) {
  if (db[name]) return db[name];
  const lower = name.toLowerCase();
  for (const key of Object.keys(db)) {
    if (key.toLowerCase().includes(lower) || lower.includes(key.toLowerCase())) {
      return db[key];
    }
  }
  return null;
}

const PROP_CONFIG = {
  hits: { db: 'batter', key: 'hits' },
  homeRuns: { db: 'batter', key: 'homeRuns' },
  strikeouts: { db: 'pitcher', key: 'strikeouts' },
  hitsAllowed: { db: 'pitcher', key: 'hitsAllowed' },
};

if (!props.length) {
  console.log('mlb_props.json vazio — sem props disponíveis.');
  process.exit(0);
}

let descartadosSemStats = 0;
let descartadosSigmaBaixa = 0;
const results = [];

for (const prop of props) {
  const config = PROP_CONFIG[prop.prop];
  if (!config) continue;

  const db = config.db === 'batter' ? batterStats : pitcherStats;
  const playerData = findPlayer(prop.player, db);

  if (!playerData) {
    descartadosSemStats++;
    continue;
  }

  const stats = combineContexts(playerData, config.key, ['home', 'away'], ['regular']);

  if (!stats) {
    descartadosSemStats++;
    continue;
  }

  if (stats.std < 0.3) {
    descartadosSigmaBaixa++;
    continue;
  }

  const pOver = probOver(stats.avg, stats.std, prop.line);
  const pUnder = probUnder(stats.avg, stats.std, prop.line);

  const impliedOver = 1 / prop.oddsOver;
  const impliedUnder = 1 / prop.oddsUnder;

  const edgeOver = pOver - impliedOver;
  const edgeUnder = pUnder - impliedUnder;

  const bestSide = edgeOver >= edgeUnder ? 'Over' : 'Under';
  const bestEdge = edgeOver >= edgeUnder ? edgeOver : edgeUnder;
  const bestProb = edgeOver >= edgeUnder ? pOver : pUnder;
  const bestOdds = edgeOver >= edgeUnder ? prop.oddsOver : prop.oddsUnder;

  results.push({
    game: prop.game,
    commence_time: prop.commence_time,
    player: prop.player,
    prop: prop.prop,
    isPitcher: prop.isPitcher,
    line: prop.line,
    playerAvg: stats.avg,
    playerStd: stats.std,
    side: bestSide,
    modelProb: parseFloat((bestProb * 100).toFixed(1)),
    impliedProb: parseFloat(((1 / bestOdds) * 100).toFixed(1)),
    edge: parseFloat((bestEdge * 100).toFixed(2)),
    odds: bestOdds,
    totalGames: stats.totalGames,
    currentSeasonGames: stats.currentSeasonGames,
    lowSample: stats.lowSample,
    kelly: calcKelly(bestProb, bestOdds),
    inefficientMarket: !stats.lowSample && parseFloat((bestEdge * 100).toFixed(2)) >= INEFFICIENT_MARKET_EDGE,
  });
}

console.log(`Props processadas: ${results.length} | Sem stats: ${descartadosSemStats} | Sigma baixo: ${descartadosSigmaBaixa}`);

results.sort((a, b) => b.edge - a.edge);

results.slice(0, 15).forEach((r, i) => {
  const warn = r.lowSample ? ' ⚠️' : '';
  console.log(
    `[${i + 1}] ${r.player}${warn} | ${r.prop} ${r.side} ${r.line} | Edge: ${r.edge}% | Kelly: ${r.kelly}%`
  );
});

fs.writeFileSync('mlb_props_results.json', JSON.stringify(results, null, 2));
console.log('mlb_props_results.json salvo.');
