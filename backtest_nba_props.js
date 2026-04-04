const fs = require('fs');

// ── Configuração ───────────────────────────────────────────────────────────────

const BOXSCORES_CACHE = 'nba_boxscores_cache.json';
const KELLY_FRACTION  = 0.25;
const HOUSE_MARGIN    = 0.05;
const MIN_GAMES_MKT   = 10;
const MIN_GAMES_MODEL = 5;
const STAT_KEYS       = ['points', 'rebounds', 'assists', 'steals', 'threes', 'fouls'];
const BANKROLL_START  = 1000;
// Flat Kelly: stake = BANKROLL_START * kellyFrac (sem compounding)
// Razão: modelo superstima probabilidades 2-16%; compounding com erro de estimativa
// explode a banca. Flat betting isola o sinal do modelo do ruído do compounding.
// Após calibração do modelo, migrar para Kelly composto com banca real.
const FLAT_STAKE_CAP  = BANKROLL_START * 0.05; // cap: máximo 5% da banca inicial por aposta
const DECAY           = 0.98;

// ── Utilitários ────────────────────────────────────────────────────────────────

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

function probOver(mu, sigma, line)  { return 1 - normalCDF(line, mu, sigma); }
function probUnder(mu, sigma, line) { return normalCDF(line, mu, sigma); }

function marketOdd(p) {
  if (p <= 0.01) return null; // evita Infinity
  return 1 / (p * (1 + HOUSE_MARGIN));
}

function calcKelly(prob, odds) {
  const b = odds - 1;
  const q = 1 - prob;
  const k = (prob * b - q) / b;
  return Math.max(0, k * KELLY_FRACTION);
}

// ── Calibração isotônica (mesma tabela do model_nba_props.js) ─────────────────
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

function calcAvgStd(values) {
  if (!values || values.length === 0) return null;
  const avg = values.reduce((s, v) => s + v, 0) / values.length;
  const variance = values.reduce((s, v) => s + Math.pow(v - avg, 2), 0) / values.length;
  return { avg, std: Math.sqrt(variance), count: values.length };
}

function calcWeightedAvgStd(values) {
  if (!values || values.length === 0) return null;
  let wSum = 0, wSumSq = 0, totalW = 0;
  const n = values.length;
  for (let i = 0; i < n; i++) {
    const w = Math.pow(DECAY, n - 1 - i);
    wSum   += values[i] * w;
    wSumSq += values[i] * values[i] * w;
    totalW += w;
  }
  const avg = wSum / totalW;
  const variance = Math.max(0, wSumSq / totalW - avg * avg);
  return { avg, std: Math.sqrt(variance), count: n };
}

// ── Main ───────────────────────────────────────────────────────────────────────

function main() {
  if (!fs.existsSync(BOXSCORES_CACHE)) {
    console.error(`ERRO: ${BOXSCORES_CACHE} não encontrado.`);
    process.exit(1);
  }

  const cache = JSON.parse(fs.readFileSync(BOXSCORES_CACHE));
  const allGames = Object.values(cache)
    .sort((a, b) => new Date(a.date) - new Date(b.date));

  const baseGames = allGames.filter(g => g.season === 'base');
  const walkGames = allGames.filter(g => g.season === 'walk');

  console.log(`Base (2024-25): ${baseGames.length} jogos | Walk-forward (2025-26): ${walkGames.length} jogos`);

  // ── Perfil de mercado ──────────────────────────────────────────────────────
  console.log('Construindo perfil de mercado (base histórica)...');
  const marketRaw = {};

  for (const game of baseGames) {
    for (const p of game.players) {
      if (!p.playerName || !p.location) continue;
      if (!marketRaw[p.playerName]) marketRaw[p.playerName] = { home: {}, away: {}, all: {} };
      for (const stat of STAT_KEYS) {
        const v = p.stats[stat];
        if (v === null || v === undefined) continue;
        for (const loc of [p.location, 'all']) {
          if (!marketRaw[p.playerName][loc][stat]) marketRaw[p.playerName][loc][stat] = [];
          marketRaw[p.playerName][loc][stat].push(v);
        }
      }
    }
  }

  const marketProfiles = {};
  for (const [name, locs] of Object.entries(marketRaw)) {
    marketProfiles[name] = {};
    for (const [loc, stats] of Object.entries(locs)) {
      marketProfiles[name][loc] = {};
      for (const [stat, values] of Object.entries(stats)) {
        const s = calcAvgStd(values);
        if (s && s.count >= (loc === 'all' ? MIN_GAMES_MKT : 3)) {
          marketProfiles[name][loc][stat] = s;
        }
      }
    }
  }

  console.log(`Perfil de mercado: ${Object.keys(marketProfiles).length} jogadores\n`);

  // ── Walk-forward ───────────────────────────────────────────────────────────
  const modelRaw = {};
  const predictions = [];
  let skipped = 0;

  console.log('Gerando predições walk-forward...');

  for (const game of walkGames) {
    for (const player of game.players) {
      const { playerName, location, stats } = player;
      if (!playerName || !location) continue;

      for (const stat of STAT_KEYS) {
        const actual = stats[stat];
        if (actual === null || actual === undefined) continue;

        const mktProfile =
          marketProfiles[playerName]?.[location]?.[stat]?.count >= MIN_GAMES_MKT
            ? marketProfiles[playerName][location][stat]
            : marketProfiles[playerName]?.['all']?.[stat]?.count >= MIN_GAMES_MKT
            ? marketProfiles[playerName]['all'][stat]
            : null;

        if (!mktProfile || mktProfile.std < 0.3) { skipped++; continue; }

        const rawLine = mktProfile.avg;
        const line = Math.floor(rawLine) + 0.5;
        if (line < 0) { skipped++; continue; }

        const mktPOver    = probOver(mktProfile.avg, mktProfile.std, line);
        const mktPUnder   = probUnder(mktProfile.avg, mktProfile.std, line);
        if (mktPOver <= 0 || mktPUnder <= 0) { skipped++; continue; }
        const mktOddOver  = marketOdd(mktPOver);
        const mktOddUnder = marketOdd(mktPUnder);
        if (!isFinite(mktOddOver) || !isFinite(mktOddUnder)) { skipped++; continue; }

        if (!mktOddOver || !mktOddUnder) { skipped++; continue; }
        const modelValues =
          modelRaw[playerName]?.[location]?.[stat] ||
          modelRaw[playerName]?.['all']?.[stat] ||
          null;

        let modelProfile = null;
        if (modelValues && modelValues.length >= MIN_GAMES_MODEL) {
          modelProfile = calcWeightedAvgStd(modelValues);
        } else if (mktProfile) {
          modelProfile = mktProfile;
        }

        if (!modelProfile || modelProfile.std < 0.3) { skipped++; continue; }

        // Probabilidades calibradas (mesma correção do model_nba_props.js)
        const modPOver  = calibrate(probOver(modelProfile.avg, modelProfile.std, line));
        const modPUnder = calibrate(probUnder(modelProfile.avg, modelProfile.std, line));

        const impliedOver  = 1 / mktOddOver;
        const impliedUnder = 1 / mktOddUnder;
        const edgeOver     = modPOver  - impliedOver;
        const edgeUnder    = modPUnder - impliedUnder;

        const side = edgeOver >= edgeUnder ? 'Over' : 'Under';
        const edge = edgeOver >= edgeUnder ? edgeOver : edgeUnder;
        const prob = edgeOver >= edgeUnder ? modPOver : modPUnder;
        const odd  = edgeOver >= edgeUnder ? mktOddOver : mktOddUnder;

        const won   = side === 'Over' ? actual > line : actual < line;
        const kelly = calcKelly(prob, odd);

        predictions.push({
          date: game.date,
          player: playerName,
          stat,
          location,
          line,
          side,
          edge: parseFloat((edge * 100).toFixed(2)),
          prob: parseFloat((prob * 100).toFixed(1)),
          mktAvg: parseFloat(mktProfile.avg.toFixed(2)),
          modelAvg: parseFloat(modelProfile.avg.toFixed(2)),
          mktOdd: parseFloat(odd.toFixed(3)),
          kellyFrac: parseFloat((kelly * 100).toFixed(2)),
          actual,
          won,
          modelGames: modelValues?.length || 0,
        });
      }

      // Atualiza modelRaw APÓS predição (walk-forward correto)
      if (!modelRaw[playerName]) modelRaw[playerName] = { home: {}, away: {}, all: {} };
      for (const stat of STAT_KEYS) {
        const v = stats[stat];
        if (v === null || v === undefined) continue;
        for (const loc of [location, 'all']) {
          if (!modelRaw[playerName][loc][stat]) modelRaw[playerName][loc][stat] = [];
          modelRaw[playerName][loc][stat].push(v);
        }
      }
    }
  }

  console.log(`Props geradas: ${predictions.length} | Puladas: ${skipped}\n`);

  // ── Calibração ─────────────────────────────────────────────────────────────
  const buckets = {};
  for (let i = 0; i <= 9; i++) {
    buckets[(0.5 + i * 0.05).toFixed(2)] = { predicted: 0, actual: 0, n: 0 };
  }

  let brierSum = 0;
  let correct  = 0;

  for (const p of predictions) {
    const prob    = p.prob / 100;
    const outcome = p.won ? 1 : 0;
    brierSum += Math.pow(prob - outcome, 2);
    if (p.won) correct++;
    const key = (Math.floor(prob / 0.05) * 0.05).toFixed(2);
    if (buckets[key]) {
      buckets[key].predicted += prob;
      buckets[key].actual    += outcome;
      buckets[key].n++;
    }
  }

  const accuracy   = correct / predictions.length;
  const brierScore = brierSum / predictions.length;

  // ── ROI — melhor linha por mercado ─────────────────────────────────────────
  const bestByMarket = {};
  for (const p of predictions) {
    const key = `${p.date}|${p.player}|${p.stat}`;
    if (!bestByMarket[key] || Math.abs(p.edge) > Math.abs(bestByMarket[key].edge)) {
      bestByMarket[key] = p;
    }
  }

  const bets = Object.values(bestByMarket).sort(
    (a, b) => new Date(a.date) - new Date(b.date)
  );

  // ── Simulação de banca (variável única) ────────────────────────────────────
  let bankroll     = BANKROLL_START;
  let peak         = bankroll;
  let maxDrawdown  = 0;
  let totalWagered = 0;
  let totalReturn  = 0;
  let wins         = 0;
  let losses       = 0;
  let skippedBets  = 0;
  const bankrollHistory = [bankroll];

  const edgeBuckets = {
    '0-5%':   { bets: 0, wins: 0, wagered: 0, returned: 0 },
    '5-10%':  { bets: 0, wins: 0, wagered: 0, returned: 0 },
    '10-15%': { bets: 0, wins: 0, wagered: 0, returned: 0 },
    '15%+':   { bets: 0, wins: 0, wagered: 0, returned: 0 },
  };

  const statBreakdown = {};
  for (const stat of STAT_KEYS) statBreakdown[stat] = { bets: 0, wins: 0, wagered: 0, returned: 0 };

  for (const p of bets) {
    if (!isFinite(p.mktOdd) || p.mktOdd <= 1) continue;

    // Flat Kelly: stake baseado na banca inicial, sem compounding
    const stake = Math.min(BANKROLL_START * (p.kellyFrac / 100), FLAT_STAKE_CAP);
    if (stake <= 0) continue;

    totalWagered += stake;
    const eKey = p.edge < 5 ? '0-5%' : p.edge < 10 ? '5-10%' : p.edge < 15 ? '10-15%' : '15%+';

    edgeBuckets[eKey].bets++;
    edgeBuckets[eKey].wagered += stake;
    statBreakdown[p.stat].bets++;
    statBreakdown[p.stat].wagered += stake;

    if (p.won) {
      const profit = stake * (p.mktOdd - 1);
      bankroll    += profit;
      totalReturn += profit;
      wins++;
      edgeBuckets[eKey].returned    += profit;
      edgeBuckets[eKey].wins++;
      statBreakdown[p.stat].returned += profit;
      statBreakdown[p.stat].wins++;
    } else {
      bankroll    -= stake;
      totalReturn -= stake;
      losses++;
      edgeBuckets[eKey].returned    -= stake;
      statBreakdown[p.stat].returned -= stake;
    }

    if (bankroll > peak) peak = bankroll;
    const dd = (peak - bankroll) / peak;
    if (dd > maxDrawdown) maxDrawdown = dd;
    bankrollHistory.push(parseFloat(bankroll.toFixed(2)));
  }

  const roi     = totalWagered > 0 ? totalReturn / totalWagered : 0;
  const winRate = (wins + losses) > 0 ? wins / (wins + losses) : 0;

  // ── Output ─────────────────────────────────────────────────────────────────
  console.log('══════════════════════════════════════════');
  console.log('BACKTESTING NBA PROPS');
  console.log(`Mercado: média simples 2024-25 | Modelo: média ponderada walk-forward`);
  console.log(`Kelly: ${KELLY_FRACTION * 100}% | Vig: ${HOUSE_MARGIN * 100}% | Min jogos mkt: ${MIN_GAMES_MKT} | Min jogos modelo: ${MIN_GAMES_MODEL}`);
  console.log('══════════════════════════════════════════');
  console.log(`Props totais       : ${predictions.length}`);
  console.log(`Acurácia           : ${(accuracy * 100).toFixed(1)}%`);
  console.log(`Brier Score        : ${brierScore.toFixed(4)}`);
  console.log('');
  console.log('Calibração por faixa:');
  console.log('  Faixa      | N      | Pred%  | Real%  | Desvio');
  console.log('  -----------|--------|--------|--------|--------');
  for (const [key, b] of Object.entries(buckets)) {
    if (b.n < 10) continue;
    const pred  = (b.predicted / b.n * 100).toFixed(1);
    const real  = (b.actual    / b.n * 100).toFixed(1);
    const dev   = ((b.predicted / b.n - b.actual / b.n) * 100).toFixed(1);
    const sinal = parseFloat(dev) > 0 ? '+' : '';
    console.log(`  ${key}-${(parseFloat(key) + 0.05).toFixed(2)} | ${String(b.n).padStart(6)} | ${pred.padStart(5)}% | ${real.padStart(5)}% | ${sinal}${dev}%`);
  }
  console.log('');
  console.log('══════════════════════════════════════════');
  console.log('SIMULAÇÃO DE ROI');
  console.log('══════════════════════════════════════════');
  console.log(`Mercados únicos    : ${bets.length}`);
  console.log(`Vitórias / Derrotas: ${wins} / ${losses} (${(winRate * 100).toFixed(1)}%)`);
  console.log(`Banca final        : ${bankroll.toFixed(2)} u`);
  console.log(`ROI                : ${(roi * 100).toFixed(2)}%`);
  console.log(`Max Drawdown       : ${(maxDrawdown * 100).toFixed(1)}%`);
  console.log('');
  console.log('ROI por faixa de edge:');
  console.log('  Faixa   | Apostas | Win%   | ROI');
  console.log('  --------|---------|--------|--------');
  for (const [faixa, b] of Object.entries(edgeBuckets)) {
    if (b.bets === 0) continue;
    const wp = (b.wins / b.bets * 100).toFixed(1);
    const r  = b.wagered > 0 ? (b.returned / b.wagered * 100).toFixed(2) : 'n/a';
    const s  = parseFloat(r) >= 0 ? '+' : '';
    console.log(`  ${faixa.padEnd(7)} | ${String(b.bets).padStart(7)} | ${wp.padStart(5)}% | ${s}${r}%`);
  }
  console.log('');
  console.log('ROI por tipo de stat:');
  console.log('  Stat        | Apostas | Win%   | ROI');
  console.log('  ------------|---------|--------|--------');
  for (const [stat, b] of Object.entries(statBreakdown)) {
    if (b.bets === 0) continue;
    const wp = (b.wins / b.bets * 100).toFixed(1);
    const r  = b.wagered > 0 ? (b.returned / b.wagered * 100).toFixed(2) : 'n/a';
    const s  = parseFloat(r) >= 0 ? '+' : '';
    console.log(`  ${stat.padEnd(11)} | ${String(b.bets).padStart(7)} | ${wp.padStart(5)}% | ${s}${r}%`);
  }

  fs.writeFileSync('nba_props_backtest_results.json', JSON.stringify({
    config: { kellyFraction: KELLY_FRACTION, houseMargin: HOUSE_MARGIN, minGamesMkt: MIN_GAMES_MKT, minGamesModel: MIN_GAMES_MODEL, decay: DECAY },
    summary: {
      totalProps: predictions.length, skipped,
      accuracy: parseFloat((accuracy * 100).toFixed(2)),
      brierScore: parseFloat(brierScore.toFixed(4)),
      uniqueMarkets: bets.length,
      wins, losses,
      winRate: parseFloat((winRate * 100).toFixed(2)),
      bankrollFinal: parseFloat(bankroll.toFixed(2)),
      roi: parseFloat((roi * 100).toFixed(2)),
      maxDrawdown: parseFloat((maxDrawdown * 100).toFixed(2)),
    },
    calibration: Object.fromEntries(
      Object.entries(buckets)
        .filter(([, b]) => b.n > 0)
        .map(([key, b]) => [key, {
          n: b.n,
          predictedPct: parseFloat((b.predicted / b.n * 100).toFixed(1)),
          actualPct:    parseFloat((b.actual    / b.n * 100).toFixed(1)),
        }])
    ),
    edgeBreakdown: edgeBuckets,
    statBreakdown,
    bankrollHistory,
  }, null, 2));

  console.log('\nnba_props_backtest_results.json salvo.');
}

main();
