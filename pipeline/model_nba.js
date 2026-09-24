const fs = require('fs');
const riskConfig = require('./risk_config');

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

function calcKelly(p, odd) {
  const b = odd - 1;
  const q = 1 - p;
  const kelly = (p * b - q) / b;
  return Math.max(0, parseFloat((kelly * KELLY_FRACTION * 100).toFixed(2)));
}

if (!odds.length) {
  console.log('nba_odds.json vazio — sem partidas disponíveis no momento.');
  process.exit(0);
}

const NOW = Date.now();
const MIN_15 = 15 * 60 * 1000;

let descartados = 0;
let descartadosJogoBloqueado = 0;

const results = odds.filter(m => {
  const commence = new Date(m.commence_time).getTime();
  if (commence - NOW < MIN_15) { descartadosJogoBloqueado++; return false; }
  return true;
}).map(m => {
  const r1data = rating[m.team1];
  const r2data = rating[m.team2];

  if (!r1data || !r2data) { descartados++; return null; }

  // team1 = visitante (away), team2 = mandante (home)
  const r1 = typeof r1data === 'object' ? r1data.away : r1data;
  const r2 = typeof r2data === 'object' ? r2data.home : r2data;

  if (r1 === undefined || r2 === undefined) { descartados++; return null; }

  const modelProb1 = calcProb(r1, r2);
  const modelProb2 = 1 - modelProb1;

  const probOdds1 = 1 / m.odds1;
  const probOdds2 = 1 / m.odds2;

  const edge1 = modelProb1 - probOdds1;
  const edge2 = modelProb2 - probOdds2;

  const bestProb = edge1 >= edge2 ? modelProb1 : modelProb2;
  const bestOdds = edge1 >= edge2 ? m.odds1 : m.odds2;

  return {
    match: `${m.team1} x ${m.team2}`,
    commence_time: m.commence_time,
    modelProb1: parseFloat((modelProb1 * 100).toFixed(1)),
    modelProb2: parseFloat((modelProb2 * 100).toFixed(1)),
    impliedProb1: parseFloat((probOdds1 * 100).toFixed(1)),
    impliedProb2: parseFloat((probOdds2 * 100).toFixed(1)),
    edge1: parseFloat((edge1 * 100).toFixed(2)),
    edge2: parseFloat((edge2 * 100).toFixed(2)),
    kelly: calcKelly(bestProb, bestOdds),
  };
}).filter(Boolean);

console.log(`Partidas processadas: ${results.length} | Descartadas (sem rating): ${descartados} | Jogo bloqueado: ${descartadosJogoBloqueado}`);

if (results.length) {
  results
    .sort((a, b) => Math.max(b.edge1, b.edge2) - Math.max(a.edge1, a.edge2))
    .slice(0, 10)
    .forEach((m, i) => {
      const edge = m.edge1 >= m.edge2
        ? `${m.match.split(' x ')[0]} EDGE: ${m.edge1}% | Kelly: ${m.kelly}%`
        : `${m.match.split(' x ')[1]} EDGE: ${m.edge2}% | Kelly: ${m.kelly}%`;
      console.log(`[${i + 1}] ${m.match} | ${edge}`);
    });
}

fs.writeFileSync('nba_results.json', JSON.stringify(results, null, 2));
console.log('nba_results.json salvo.');
