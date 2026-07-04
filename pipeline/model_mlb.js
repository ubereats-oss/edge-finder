const fs = require('fs');

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
const KELLY_FRACTION = 0.25;

function calcProb(r1, r2) {
  return 1 / (1 + Math.exp(-(r1 - r2) / 0.5));
}

function calcKelly(p, odd) {
  const b = odd - 1;
  const q = 1 - p;
  const kelly = (p * b - q) / b;
  return Math.max(0, parseFloat((kelly * KELLY_FRACTION * 100).toFixed(2)));
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

if (!odds.length) {
  console.log('mlb_odds.json vazio — sem partidas disponíveis.');
  process.exit(0);
}

let descartados = 0;
const results = [];

for (const m of odds) {
  const t1Key = findTeam(m.team1);
  const t2Key = findTeam(m.team2);
  if (!t1Key || !t2Key) { descartados++; continue; }
  const r1 = getWeightedRating(t1Key, 'away');
  const r2 = getWeightedRating(t2Key, 'home');
  if (!r1 || !r2) { descartados++; continue; }
  const modelProb1 = calcProb(r1.rating, r2.rating);
  const modelProb2 = 1 - modelProb1;
  const impliedProb1 = 1 / m.odds1;
  const impliedProb2 = 1 / m.odds2;
  const edge1 = modelProb1 - impliedProb1;
  const edge2 = modelProb2 - impliedProb2;
  const bestEdge = edge1 >= edge2 ? edge1 : edge2;
  const bestProb = edge1 >= edge2 ? modelProb1 : modelProb2;
  const bestOdds = edge1 >= edge2 ? m.odds1 : m.odds2;
  results.push({
    match: `${m.team1} x ${m.team2}`,
    commence_time: m.commence_time,
    modelProb1: parseFloat((modelProb1 * 100).toFixed(1)),
    modelProb2: parseFloat((modelProb2 * 100).toFixed(1)),
    impliedProb1: parseFloat((impliedProb1 * 100).toFixed(1)),
    impliedProb2: parseFloat((impliedProb2 * 100).toFixed(1)),
    edge1: parseFloat((edge1 * 100).toFixed(2)),
    edge2: parseFloat((edge2 * 100).toFixed(2)),
    kelly: calcKelly(bestProb, bestOdds),
  });
}

console.log(`Partidas processadas: ${results.length} | Descartadas: ${descartados}`);
results.sort((a, b) => Math.max(b.edge1, b.edge2) - Math.max(a.edge1, a.edge2));
results.slice(0, 10).forEach((m, i) => {
  const edge = m.edge1 >= m.edge2
    ? `${m.match.split(' x ')[0]} EDGE: ${m.edge1}% | Kelly: ${m.kelly}%`
    : `${m.match.split(' x ')[1]} EDGE: ${m.edge2}% | Kelly: ${m.kelly}%`;
  console.log(`[${i + 1}] ${m.match} | ${edge}`);
});

fs.writeFileSync('mlb_results.json', JSON.stringify(results, null, 2));
console.log('mlb_results.json salvo.');
