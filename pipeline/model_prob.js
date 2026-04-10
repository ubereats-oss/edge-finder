const fs = require('fs');

const ranking = JSON.parse(fs.readFileSync('ranking.json'));
const odds = JSON.parse(fs.readFileSync('odds.json'));

function rankToRating(rank) {
  return 2000 - (rank * 5);
}

function calcProb(r1, r2) {
  return 1 / (1 + Math.pow(10, -(r1 - r2) / 400));
}

function findRank(apiName) {
  if (ranking[apiName]) return ranking[apiName];

  const parts = apiName.trim().split(' ');
  for (let i = 1; i < parts.length; i++) {
    const candidate = parts.slice(i).join(' ') + ' ' + parts.slice(0, i).join(' ');
    if (ranking[candidate]) return ranking[candidate];
  }

  return null;
}

if (!odds.length) {
  console.log('odds.json vazio — sem partidas disponíveis no momento.');
  process.exit(0);
}

let descartados = 0;

const results = odds.map(m => {
  const r1 = findRank(m.player1);
  const r2 = findRank(m.player2);

  if (!r1 || !r2) {
    descartados++;
    return null;
  }

  const rating1 = rankToRating(r1);
  const rating2 = rankToRating(r2);

  const modelProb1 = calcProb(rating1, rating2);
  const modelProb2 = 1 - modelProb1;

  const probOdds1 = 1 / m.odds1;
  const probOdds2 = 1 / m.odds2;

  const edge1 = modelProb1 - probOdds1;
  const edge2 = modelProb2 - probOdds2;

  return {
    match: `${m.player1} x ${m.player2}`,
    modelProb1: parseFloat((modelProb1 * 100).toFixed(1)),
    modelProb2: parseFloat((modelProb2 * 100).toFixed(1)),
    impliedProb1: parseFloat((probOdds1 * 100).toFixed(1)),
    impliedProb2: parseFloat((probOdds2 * 100).toFixed(1)),
    edge1: parseFloat((edge1 * 100).toFixed(2)),
    edge2: parseFloat((edge2 * 100).toFixed(2))
  };
}).filter(Boolean);

console.log(`Partidas processadas: ${results.length} | Descartadas (sem ranking): ${descartados}`);

if (results.length) {
  results
    .sort((a, b) => Math.max(b.edge1, b.edge2) - Math.max(a.edge1, a.edge2))
    .slice(0, 10)
    .forEach((m, i) => {
      const edge = m.edge1 >= m.edge2
        ? `${m.match.split(' x ')[0]} EDGE: ${m.edge1}%`
        : `${m.match.split(' x ')[1]} EDGE: ${m.edge2}%`;
      console.log(`[${i + 1}] ${m.match} | ${edge}`);
    });
}

fs.writeFileSync('model_results.json', JSON.stringify(results, null, 2));
console.log('model_results.json salvo.');
