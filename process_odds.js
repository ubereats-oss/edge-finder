const fs = require('fs');

const data = JSON.parse(fs.readFileSync('atp_matches_2026-04-02.json'));

function calcProb(odd) {
  return 1 / odd;
}

const processed = data.map(m => {
  const p1 = calcProb(m.odds1);
  const p2 = calcProb(m.odds2);

  const total = p1 + p2;

  return {
    ...m,
    prob1: (p1 / total),
    prob2: (p2 / total)
  };
});

processed.slice(0, 10).forEach((m, i) => {
  console.log(
    `[${i + 1}] ${m.player1} x ${m.player2} | Prob: ${(m.prob1 * 100).toFixed(1)}% / ${(m.prob2 * 100).toFixed(1)}%`
  );
});

fs.writeFileSync('processed.json', JSON.stringify(processed, null, 2));

console.log('OK');
