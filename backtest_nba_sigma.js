const axios = require('axios');
const fs = require('fs');

const MONTHS = [
  { start: '20251001', end: '20251031', weight: 2 },
  { start: '20251101', end: '20251130', weight: 2 },
  { start: '20251201', end: '20251231', weight: 2 },
  { start: '20260101', end: '20260131', weight: 3 },
  { start: '20260201', end: '20260228', weight: 3 },
  { start: '20260301', end: '20260331', weight: 3 },
];

const BASE_MONTHS = [
  { start: '20241001', end: '20241031', weight: 1 },
  { start: '20241101', end: '20241130', weight: 1 },
  { start: '20241201', end: '20241231', weight: 1 },
  { start: '20250101', end: '20250131', weight: 1 },
  { start: '20250201', end: '20250228', weight: 1 },
  { start: '20250301', end: '20250331', weight: 1 },
  { start: '20250401', end: '20250430', weight: 1 },
];

const KELLY_FRACTION = 0.25;
const MIN_GAMES_PER_CONTEXT = 5;

// Sigmas a testar
const SIGMAS = [10, 12, 14, 16];

async function fetchMonth(start, end) {
  const url = `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?limit=200&dates=${start}-${end}`;
  const res = await axios.get(url);
  return res.data.events || [];
}

function parseGames(events) {
  const games = [];
  for (const e of events) {
    const comp = e.competitions[0];
    if (!comp.status.type.completed) continue;
    const home = comp.competitors.find(c => c.homeAway === 'home');
    const away = comp.competitors.find(c => c.homeAway === 'away');
    if (!home || !away) continue;
    const homeScore = parseInt(home.score);
    const awayScore = parseInt(away.score);
    if (!homeScore && !awayScore) continue;
    games.push({
      date: e.date,
      homeTeam: home.team.displayName,
      awayTeam: away.team.displayName,
      homeScore,
      awayScore,
      homeWon: homeScore > awayScore,
    });
  }
  return games;
}

function buildRating(games) {
  const stats = {};
  for (const g of games) {
    if (!stats[g.homeTeam]) stats[g.homeTeam] = {};
    if (!stats[g.awayTeam]) stats[g.awayTeam] = {};
    if (!stats[g.homeTeam].home) stats[g.homeTeam].home = { weightedSum: 0, weightedCount: 0 };
    if (!stats[g.awayTeam].away) stats[g.awayTeam].away = { weightedSum: 0, weightedCount: 0 };

    const w = g.weight || 1;
    stats[g.homeTeam].home.weightedSum += (g.homeScore - g.awayScore) * w;
    stats[g.homeTeam].home.weightedCount += w;
    stats[g.awayTeam].away.weightedSum += (g.awayScore - g.homeScore) * w;
    stats[g.awayTeam].away.weightedCount += w;
  }

  const rating = {};
  for (const [team, locs] of Object.entries(stats)) {
    const h = locs.home;
    const a = locs.away;
    if (!h || !a || h.weightedCount < MIN_GAMES_PER_CONTEXT || a.weightedCount < MIN_GAMES_PER_CONTEXT) continue;
    rating[team] = {
      home: h.weightedSum / h.weightedCount,
      away: a.weightedSum / a.weightedCount,
    };
  }
  return rating;
}

function calcProb(r1away, r2home, sigma) {
  return 1 / (1 + Math.exp(-(r1away - r2home) / sigma));
}

function runMetrics(predictions) {
  let correct = 0;
  let brierSum = 0;

  const buckets = {};
  for (let i = 0; i <= 9; i++) {
    const low = (0.5 + i * 0.05).toFixed(2);
    buckets[low] = { predicted: 0, actual: 0, n: 0 };
  }

  for (const p of predictions) {
    if (p.predictedWinner === p.actualWinner) correct++;

    const predProb = p.modelProbHome >= 0.5 ? p.modelProbHome : p.modelProbAway;
    const outcome = p.predictedWinner === p.actualWinner ? 1 : 0;
    brierSum += Math.pow(predProb - outcome, 2);

    const bucketKey = (Math.floor(predProb / 0.05) * 0.05).toFixed(2);
    if (buckets[bucketKey]) {
      buckets[bucketKey].predicted += predProb;
      buckets[bucketKey].actual += outcome;
      buckets[bucketKey].n++;
    }
  }

  return {
    accuracy: correct / predictions.length,
    brierScore: brierSum / predictions.length,
    buckets,
  };
}

async function main() {
  console.log('Carregando base histórica (temporada 2024-25)...');
  const baseGames = [];
  for (const { start, end, weight } of BASE_MONTHS) {
    const events = await fetchMonth(start, end);
    const parsed = parseGames(events);
    for (const g of parsed) baseGames.push({ ...g, weight });
    console.log(`  Base ${start}: ${parsed.length} jogos`);
  }

  console.log('\nCarregando temporada 2025-26 para walk-forward...');
  const currentSeasonGames = [];
  for (const { start, end, weight } of MONTHS) {
    const events = await fetchMonth(start, end);
    const parsed = parseGames(events);
    for (const g of parsed) currentSeasonGames.push({ ...g, weight });
    console.log(`  Walk-forward ${start}: ${parsed.length} jogos`);
  }

  currentSeasonGames.sort((a, b) => new Date(a.date) - new Date(b.date));
  console.log(`\nTotal walk-forward: ${currentSeasonGames.length} jogos`);

  // Gera predições walk-forward (independente do sigma — só a prob muda)
  console.log('\nGerando predições walk-forward...');
  const rawPredictions = [];
  const seenGames = [];

  for (const game of currentSeasonGames) {
    const trainingGames = [...baseGames, ...seenGames];
    const rating = buildRating(trainingGames);

    const r1data = rating[game.awayTeam];
    const r2data = rating[game.homeTeam];

    if (r1data && r2data) {
      rawPredictions.push({
        date: game.date,
        homeTeam: game.homeTeam,
        awayTeam: game.awayTeam,
        r1away: r1data.away,
        r2home: r2data.home,
        homeWon: game.homeWon,
      });
    }

    seenGames.push({ ...game, weight: game.weight });
  }

  console.log(`Predições geradas: ${rawPredictions.length}\n`);

  // Testa cada sigma
  console.log('══════════════════════════════════════════════════════════');
  console.log('COMPARATIVO DE SIGMA — BACKTESTING NBA H2H');
  console.log('══════════════════════════════════════════════════════════');
  console.log(`${'Sigma'.padEnd(8)} | ${'Acurácia'.padEnd(10)} | ${'Brier Score'.padEnd(12)} | Calibração (desvio médio abs nas faixas)`);
  console.log(`${'-'.repeat(8)}-|-${'-'.repeat(10)}-|-${'-'.repeat(12)}-|------------------------------------------`);

  const allResults = {};

  for (const sigma of SIGMAS) {
    const predictions = rawPredictions.map(p => {
      const modelProbAway = calcProb(p.r1away, p.r2home, sigma);
      const modelProbHome = 1 - modelProbAway;
      return {
        ...p,
        modelProbHome,
        modelProbAway,
        predictedWinner: modelProbHome >= 0.5 ? 'home' : 'away',
        actualWinner: p.homeWon ? 'home' : 'away',
      };
    });

    const { accuracy, brierScore, buckets } = runMetrics(predictions);

    // Desvio médio absoluto entre Pred% e Real% nas faixas com n >= 10
    const deviations = Object.values(buckets)
      .filter(b => b.n >= 10)
      .map(b => Math.abs(b.predicted / b.n - b.actual / b.n));
    const meanDeviation = deviations.length
      ? deviations.reduce((s, v) => s + v, 0) / deviations.length
      : null;

    console.log(
      `${String(sigma).padEnd(8)} | ${(accuracy * 100).toFixed(1).padStart(7)}%   | ${brierScore.toFixed(4).padStart(11)}  | ${meanDeviation !== null ? (meanDeviation * 100).toFixed(2) + '%' : 'n/a'}`
    );

    allResults[sigma] = { accuracy, brierScore, meanDeviation, buckets };
  }

  // Tabela de calibração detalhada por sigma
  console.log('\n══════════════════════════════════════════════════════════');
  console.log('CALIBRAÇÃO DETALHADA POR SIGMA');
  console.log('══════════════════════════════════════════════════════════');

  for (const sigma of SIGMAS) {
    const { buckets } = allResults[sigma];
    console.log(`\nSigma = ${sigma}`);
    console.log('  Faixa      | N    | Pred%  | Real%  | Desvio');
    console.log('  -----------|------|--------|--------|--------');
    for (const [key, b] of Object.entries(buckets)) {
      if (b.n < 5) continue;
      const predPct = (b.predicted / b.n * 100).toFixed(1);
      const realPct = (b.actual / b.n * 100).toFixed(1);
      const desvio = ((b.predicted / b.n - b.actual / b.n) * 100).toFixed(1);
      const sinal = parseFloat(desvio) > 0 ? '+' : '';
      console.log(
        `  ${key}-${(parseFloat(key) + 0.05).toFixed(2)} | ${String(b.n).padStart(4)} | ${predPct.padStart(5)}% | ${realPct.padStart(5)}% | ${sinal}${desvio}%`
      );
    }
  }

  fs.writeFileSync(
    'nba_backtest_sigma.json',
    JSON.stringify({ sigmas: SIGMAS, results: allResults }, null, 2)
  );
  console.log('\nnba_backtest_sigma.json salvo.');
}

main().catch(console.error);
