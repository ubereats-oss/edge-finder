const fs = require('fs');

// Lê do cache local gerado por fetch_nba_games.js
// Se o cache não existir, instrui o usuário a rodá-lo primeiro.
const CACHE_FILE = 'nba_games_cache.json';

const SIGMA = 12;
const KELLY_FRACTION = 0.15;
// Mínimo de jogos por contexto para usar o rating — valor baixo porque no início
// do walk-forward cada time tem poucos jogos na temporada atual.
// A base histórica (2024-25) já cobre a maioria dos times; esse filtro afeta
// apenas times sem histórico algum (expansão, etc.).
const MIN_GAMES_RATING = 3;
const HOUSE_MARGIN = 0.05;
const MIN_EDGE = 0.02;

function loadCache() {
  if (!fs.existsSync(CACHE_FILE)) {
    console.error(`ERRO: ${CACHE_FILE} não encontrado.`);
    console.error('Rode primeiro: node fetch_nba_games.js');
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(CACHE_FILE));
}

// Rating do MODELO: diferencial de pontos ponderado (logístico).
// Constrói home/away separados. Usa o contexto disponível mesmo que o time
// não tenha jogos suficientes nos dois contextos — cada contexto é avaliado
// individualmente. Retorna null para o contexto faltante (tratado no caller).
function buildRating(games) {
  const stats = {};
  for (const g of games) {
    const w = g.weight || 1;
    if (!stats[g.homeTeam]) stats[g.homeTeam] = { home: { sum: 0, count: 0 }, away: { sum: 0, count: 0 } };
    if (!stats[g.awayTeam]) stats[g.awayTeam] = { home: { sum: 0, count: 0 }, away: { sum: 0, count: 0 } };
    stats[g.homeTeam].home.sum += (g.homeScore - g.awayScore) * w;
    stats[g.homeTeam].home.count += w;
    stats[g.awayTeam].away.sum += (g.awayScore - g.homeScore) * w;
    stats[g.awayTeam].away.count += w;
  }

  const rating = {};
  for (const [team, locs] of Object.entries(stats)) {
    const homeOk = locs.home.count >= MIN_GAMES_RATING;
    const awayOk = locs.away.count >= MIN_GAMES_RATING;
    if (!homeOk && !awayOk) continue;
    rating[team] = {
      home: homeOk ? locs.home.sum / locs.home.count : null,
      away: awayOk ? locs.away.sum / locs.away.count : null,
    };
  }
  return rating;
}

// Win rate histórico simples para simular o mercado.
// Cada contexto (home/away) é avaliado individualmente — um time pode ter
// win rate home válido sem ter win rate away suficiente no início do walk-forward.
function buildWinRates(games) {
  const stats = {};
  for (const g of games) {
    if (!stats[g.homeTeam]) stats[g.homeTeam] = { homeWins: 0, homeGames: 0, awayWins: 0, awayGames: 0 };
    if (!stats[g.awayTeam]) stats[g.awayTeam] = { homeWins: 0, homeGames: 0, awayWins: 0, awayGames: 0 };
    stats[g.homeTeam].homeWins += g.homeWon ? 1 : 0;
    stats[g.homeTeam].homeGames++;
    stats[g.awayTeam].awayWins += g.homeWon ? 0 : 1;
    stats[g.awayTeam].awayGames++;
  }

  const rates = {};
  for (const [team, s] of Object.entries(stats)) {
    const homeRate = s.homeGames >= MIN_GAMES_RATING ? s.homeWins / s.homeGames : null;
    const awayRate = s.awayGames >= MIN_GAMES_RATING ? s.awayWins / s.awayGames : null;
    if (homeRate === null && awayRate === null) continue;
    rates[team] = { homeWinRate: homeRate, awayWinRate: awayRate };
  }
  return rates;
}

// Probabilidade de mercado para um confronto.
// Usa win rate home do mandante e win rate away do visitante.
// Se um dos contextos não tiver dados suficientes, usa 0.55 (vantagem de casa padrão NBA)
// para o mandante e 0.45 para o visitante como fallback.
function marketProb(wr2, wr1) {
  const h = wr2.homeWinRate !== null ? wr2.homeWinRate : 0.55;
  const a = wr1.awayWinRate !== null ? 1 - wr1.awayWinRate : 0.55;
  const raw = (h + a) / 2;
  return Math.min(Math.max(raw, 0.05), 0.95);
}

// Odd com vig simulada
function marketOdd(p) {
  return 1 / (p * (1 + HOUSE_MARGIN));
}

function calcProb(r1away, r2home) {
  return 1 / (1 + Math.exp(-(r1away - r2home) / SIGMA));
}

// Fallback de rating: usa a média dos dois contextos como estimativa
// quando apenas um está disponível.
function resolveRating(rdata, context) {
  if (!rdata) return null;
  if (rdata[context] !== null) return rdata[context];
  const other = context === 'home' ? 'away' : 'home';
  if (rdata[other] !== null) return rdata[other];
  return null;
}

function calcKelly(p, odd) {
  const b = odd - 1;
  const q = 1 - p;
  const k = (p * b - q) / b;
  return Math.max(0, k * KELLY_FRACTION);
}

function main() {
  const allGames = loadCache();

  console.log('Carregando base histórica (temporada 2024-25)...');
  const baseGames = [];
  const byMonth = {};
  for (const g of allGames) {
    if (g.season !== 'base') continue;
    baseGames.push(g);
    const monthKey = g.date.slice(0, 7).replace('-', '');
    byMonth[monthKey] = (byMonth[monthKey] || 0) + 1;
  }
  for (const [m, n] of Object.entries(byMonth)) console.log(`  Base ${m}: ${n} jogos`);

  console.log('\nCarregando temporada 2025-26 para walk-forward...');
  const currentSeasonGames = allGames
    .filter(g => g.season === 'walk')
    .sort((a, b) => new Date(a.date) - new Date(b.date));

  const byMonthWalk = {};
  for (const g of currentSeasonGames) {
    const monthKey = g.date.slice(0, 7).replace('-', '');
    byMonthWalk[monthKey] = (byMonthWalk[monthKey] || 0) + 1;
  }
  for (const [m, n] of Object.entries(byMonthWalk)) console.log(`  Walk-forward ${m}: ${n} jogos`);

  console.log(`\nTotal walk-forward: ${currentSeasonGames.length} jogos`);

  console.log('\nGerando predições walk-forward...');
  const predictions = [];
  const seenGames = [];
  let skipped = 0;

  for (const game of currentSeasonGames) {
    const trainingGames = [...baseGames, ...seenGames];
    const ratingMap = buildRating(trainingGames);
    const winRates = buildWinRates(trainingGames);

    const r1data = ratingMap[game.awayTeam];
    const r2data = ratingMap[game.homeTeam];
    const wr1 = winRates[game.awayTeam];
    const wr2 = winRates[game.homeTeam];

    // Resolve rating com fallback entre contextos
    const r1away = resolveRating(r1data, 'away');
    const r2home = resolveRating(r2data, 'home');

    if (r1away === null || r2home === null || !wr1 || !wr2) {
      skipped++;
      seenGames.push({ ...game, weight: game.weight });
      continue;
    }

    // Prob do MODELO (diferencial de pontos logístico)
    const modelProbAway = calcProb(r1away, r2home);
    const modelProbHome = 1 - modelProbAway;

    // Prob do MERCADO (win rate histórico simples + vig)
    const mktProbHome = marketProb(wr2, wr1);
    const mktProbAway = 1 - mktProbHome;
    const oddHome = marketOdd(mktProbHome);
    const oddAway = marketOdd(mktProbAway);

    // Edge = prob do modelo - prob implícita da odd do mercado
    const impliedHome = 1 / oddHome;
    const impliedAway = 1 / oddAway;
    const edgeHome = modelProbHome - impliedHome;
    const edgeAway = modelProbAway - impliedAway;

    let betSide = null;
    let betEdge = 0;
    let betProb = 0;
    let betOdd = 0;

    if (edgeHome >= edgeAway && edgeHome > MIN_EDGE) {
      betSide = 'home';
      betEdge = edgeHome;
      betProb = modelProbHome;
      betOdd = oddHome;
    } else if (edgeAway > edgeHome && edgeAway > MIN_EDGE) {
      betSide = 'away';
      betEdge = edgeAway;
      betProb = modelProbAway;
      betOdd = oddAway;
    }

    const kellyFrac = betSide ? calcKelly(betProb, betOdd) : 0;
    const won = betSide === 'home' ? game.homeWon : !game.homeWon;

    predictions.push({
      date: game.date,
      homeTeam: game.homeTeam,
      awayTeam: game.awayTeam,
      modelProbHome: parseFloat((modelProbHome * 100).toFixed(1)),
      modelProbAway: parseFloat((modelProbAway * 100).toFixed(1)),
      mktProbHome: parseFloat((mktProbHome * 100).toFixed(1)),
      mktProbAway: parseFloat((mktProbAway * 100).toFixed(1)),
      predictedWinner: modelProbHome >= 0.5 ? 'home' : 'away',
      actualWinner: game.homeWon ? 'home' : 'away',
      betSide,
      betEdge: betSide ? parseFloat((betEdge * 100).toFixed(2)) : null,
      betOdd: betSide ? parseFloat(betOdd.toFixed(3)) : null,
      kellyFrac: parseFloat((kellyFrac * 100).toFixed(2)),
      won: betSide ? won : null,
    });

    seenGames.push({ ...game, weight: game.weight });
  }

  console.log(`Predições geradas: ${predictions.length} | Pulados (sem dados): ${skipped}\n`);

  // ── Métricas de acurácia e calibração ──────────────────────────────────────
  let correct = 0;
  let brierSum = 0;
  const buckets = {};
  for (let i = 0; i <= 9; i++) {
    buckets[(0.5 + i * 0.05).toFixed(2)] = { predicted: 0, actual: 0, n: 0 };
  }

  for (const p of predictions) {
    if (p.predictedWinner === p.actualWinner) correct++;
    const predProb = p.modelProbHome >= 50 ? p.modelProbHome / 100 : p.modelProbAway / 100;
    const outcome = p.predictedWinner === p.actualWinner ? 1 : 0;
    brierSum += Math.pow(predProb - outcome, 2);
    const key = (Math.floor(predProb / 0.05) * 0.05).toFixed(2);
    if (buckets[key]) {
      buckets[key].predicted += predProb;
      buckets[key].actual += outcome;
      buckets[key].n++;
    }
  }

  const accuracy = correct / predictions.length;
  const brierScore = brierSum / predictions.length;

  // ── Simulação de ROI com Kelly fracionário ─────────────────────────────────
  const bets = predictions.filter(p => p.betSide !== null);

  let bankroll = 1000;
  const bankrollHistory = [bankroll];
  let totalWagered = 0;
  let totalReturn = 0;
  let wins = 0;
  let losses = 0;
  let maxDrawdown = 0;
  let peak = bankroll;

  for (const p of bets) {
    const stake = bankroll * (p.kellyFrac / 100);
    totalWagered += stake;

    if (p.won) {
      const profit = stake * (p.betOdd - 1);
      bankroll += profit;
      totalReturn += profit;
      wins++;
    } else {
      bankroll -= stake;
      totalReturn -= stake;
      losses++;
    }

    if (bankroll > peak) peak = bankroll;
    const drawdown = (peak - bankroll) / peak;
    if (drawdown > maxDrawdown) maxDrawdown = drawdown;

    bankrollHistory.push(parseFloat(bankroll.toFixed(2)));
  }

  const roi = bets.length > 0 ? totalReturn / totalWagered : 0;
  const winRate = bets.length > 0 ? wins / bets.length : 0;

  // ── ROI por faixa de edge ──────────────────────────────────────────────────
  const edgeBuckets = {
    '0-5%':   { bets: 0, wins: 0, wagered: 0, returned: 0 },
    '5-10%':  { bets: 0, wins: 0, wagered: 0, returned: 0 },
    '10-15%': { bets: 0, wins: 0, wagered: 0, returned: 0 },
    '15%+':   { bets: 0, wins: 0, wagered: 0, returned: 0 },
  };

  let bk = 1000;
  for (const p of bets) {
    const stake = bk * (p.kellyFrac / 100);
    const e = p.betEdge;
    const key = e < 5 ? '0-5%' : e < 10 ? '5-10%' : e < 15 ? '10-15%' : '15%+';
    edgeBuckets[key].bets++;
    edgeBuckets[key].wagered += stake;
    if (p.won) {
      const profit = stake * (p.betOdd - 1);
      edgeBuckets[key].returned += profit;
      edgeBuckets[key].wins++;
      bk += profit;
    } else {
      edgeBuckets[key].returned -= stake;
      bk -= stake;
    }
  }

  // ── Output ─────────────────────────────────────────────────────────────────
  console.log('══════════════════════════════════════════');
  console.log('BACKTESTING NBA H2H — ACURÁCIA E CALIBRAÇÃO');
  console.log(`Sigma: ${SIGMA} | Vig simulada: ${(HOUSE_MARGIN * 100).toFixed(0)}% | Edge mínimo: ${(MIN_EDGE * 100).toFixed(0)}%`);
  console.log('Mercado: win rate histórico simples | Modelo: diferencial de pontos logístico');
  console.log('══════════════════════════════════════════');
  console.log(`Predições totais  : ${predictions.length}`);
  console.log(`Acurácia          : ${(accuracy * 100).toFixed(1)}%`);
  console.log(`Brier Score       : ${brierScore.toFixed(4)} (menor = melhor; 0.25 = chute)`);
  console.log('');
  console.log('Calibração por faixa:');
  console.log('  Faixa      | N    | Pred%  | Real%  | Desvio');
  console.log('  -----------|------|--------|--------|--------');
  for (const [key, b] of Object.entries(buckets)) {
    if (b.n < 5) continue;
    const pred = (b.predicted / b.n * 100).toFixed(1);
    const real = (b.actual / b.n * 100).toFixed(1);
    const dev = ((b.predicted / b.n - b.actual / b.n) * 100).toFixed(1);
    const sinal = parseFloat(dev) > 0 ? '+' : '';
    console.log(`  ${key}-${(parseFloat(key) + 0.05).toFixed(2)} | ${String(b.n).padStart(4)} | ${pred.padStart(5)}% | ${real.padStart(5)}% | ${sinal}${dev}%`);
  }

  console.log('');
  console.log('══════════════════════════════════════════');
  console.log('SIMULAÇÃO DE ROI — KELLY FRACIONÁRIO (15%)');
  console.log(`Banca inicial: 1.000 u | Vig simulada: ${(HOUSE_MARGIN * 100).toFixed(0)}% | Edge mínimo: ${(MIN_EDGE * 100).toFixed(0)}%`);
  console.log('══════════════════════════════════════════');
  console.log(`Apostas realizadas : ${bets.length} de ${predictions.length} jogos`);
  if (bets.length > 0) {
    console.log(`Vitórias / Derrotas: ${wins} / ${losses} (${(winRate * 100).toFixed(1)}%)`);
    console.log(`Banca final        : ${bankroll.toFixed(2)} u`);
    console.log(`Lucro/Prejuízo     : ${totalReturn >= 0 ? '+' : ''}${totalReturn.toFixed(2)} u`);
    console.log(`ROI                : ${(roi * 100).toFixed(2)}%`);
    console.log(`Max Drawdown       : ${(maxDrawdown * 100).toFixed(1)}%`);
    console.log('');
    console.log('ROI por faixa de edge:');
    console.log('  Faixa   | Apostas | Win%   | ROI');
    console.log('  --------|---------|--------|--------');
    for (const [faixa, b] of Object.entries(edgeBuckets)) {
      if (b.bets === 0) continue;
      const winPct = (b.wins / b.bets * 100).toFixed(1);
      const roiPct = b.wagered > 0 ? (b.returned / b.wagered * 100).toFixed(2) : 'n/a';
      const sinal = parseFloat(roiPct) >= 0 ? '+' : '';
      console.log(`  ${faixa.padEnd(7)} | ${String(b.bets).padStart(7)} | ${winPct.padStart(5)}% | ${sinal}${roiPct}%`);
    }
  } else {
    console.log('Nenhuma aposta com edge suficiente encontrada.');
    console.log('Dica: reduza MIN_EDGE ou verifique se os win rates divergem do modelo.');
  }

  // ── Salva resultado ────────────────────────────────────────────────────────
  fs.writeFileSync('nba_backtest_results.json', JSON.stringify({
    config: { sigma: SIGMA, houseMargin: HOUSE_MARGIN, kellyFraction: KELLY_FRACTION, minEdge: MIN_EDGE },
    summary: {
      totalPredictions: predictions.length,
      skipped,
      accuracy: parseFloat((accuracy * 100).toFixed(2)),
      brierScore: parseFloat(brierScore.toFixed(4)),
      bets: bets.length,
      wins,
      losses,
      winRate: parseFloat((winRate * 100).toFixed(2)),
      bankrollFinal: parseFloat(bankroll.toFixed(2)),
      totalReturn: parseFloat(totalReturn.toFixed(2)),
      roi: parseFloat((roi * 100).toFixed(2)),
      maxDrawdown: parseFloat((maxDrawdown * 100).toFixed(2)),
    },
    calibration: Object.fromEntries(
      Object.entries(buckets)
        .filter(([, b]) => b.n > 0)
        .map(([key, b]) => [key, {
          n: b.n,
          predictedPct: parseFloat((b.predicted / b.n * 100).toFixed(1)),
          actualPct: parseFloat((b.actual / b.n * 100).toFixed(1)),
        }])
    ),
    edgeBreakdown: edgeBuckets,
    bankrollHistory,
    predictions,
  }, null, 2));

  console.log('\nnba_backtest_results.json salvo.');
}

main();
