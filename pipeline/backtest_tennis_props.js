const fs = require('fs');

// ── Configuração ───────────────────────────────────────────────────────────────
const TENNIS_STATS_FILE     = 'tennis_player_stats.json';
const DATA_SPLIT            = '2025-01-01';
const KELLY_FRACTION        = 0.25;
const HOUSE_MARGIN          = 0.05;
const MIN_GAMES_MKT_SURFACE = 6;
const MIN_GAMES_MKT_ALL     = 10;
const MIN_GAMES_MODEL       = 5;
const STAT_KEYS             = ['sets', 'games'];
const SURFACES              = ['clay', 'grass', 'hard', 'hard_indoor'];
const BANKROLL_START        = 1000;
const FLAT_STAKE_CAP        = BANKROLL_START * 0.05;
const DECAY                 = 0.96;
const MIN_STD               = { sets: 0.3, games: 0.5 };

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
  if (p <= 0.01) return null;
  return 1 / (p * (1 + HOUSE_MARGIN));
}

function calcKelly(prob, odds) {
  const b = odds - 1;
  const q = 1 - prob;
  const k = (prob * b - q) / b;
  return Math.max(0, k * KELLY_FRACTION);
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

// ── Calibração isotônica (de model_tennis_props.js) ───────────────────────────
const CALIB_TABLE = [
  { raw: 0.519, cal: 0.504 },
  { raw: 0.576, cal: 0.572 },
  { raw: 0.625, cal: 0.608 },
  { raw: 0.674, cal: 0.671 },
  { raw: 0.723, cal: 0.720 },
  { raw: 0.771, cal: 0.764 },
  { raw: 0.816, cal: 0.811 },
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

// ── Extrai match records de tennis_player_stats.json ──────────────────────────
// Schema: { PlayerName: { surface: { sets: [{value, date, opponent}], games: [...] } } }
// Cada record representa uma partida individual de um jogador.
function extractMatchRecords(playerStats) {
  const records = [];
  for (const [playerName, playerData] of Object.entries(playerStats)) {
    for (const [surface, surfData] of Object.entries(playerData)) {
      const setsArr  = surfData.sets  || [];
      const gamesArr = surfData.games || [];
      const n = Math.min(setsArr.length, gamesArr.length);
      for (let i = 0; i < n; i++) {
        const se = setsArr[i];
        const ge = gamesArr[i];
        if (!se || !ge) continue;
        records.push({
          playerName,
          surface,
          date:     se.date || '',
          opponent: se.opponent || '',
          stats: {
            sets:  se.value ?? 0,
            games: ge.value ?? 0,
          },
        });
      }
    }
  }
  return records.sort((a, b) => a.date.localeCompare(b.date));
}

// ── Seleciona linha de maior |edge| entre as candidatas ───────────────────────
// Sets: linha fixa 1.5; se avg > 2.0 também testa 2.5
// Games: Math.round(avg) + 0.5
function selectBestLine(stat, mktProfile, modelProfile) {
  const candidates = stat === 'sets'
    ? (mktProfile.avg > 2.0 ? [1.5, 2.5] : [1.5])
    : [Math.round(mktProfile.avg) + 0.5];

  let best = null;
  for (const line of candidates) {
    const mktPO = probOver(mktProfile.avg, mktProfile.std, line);
    const mktPU = probUnder(mktProfile.avg, mktProfile.std, line);
    if (mktPO <= 0 || mktPU <= 0) continue;
    const mktOO = marketOdd(mktPO);
    const mktOU = marketOdd(mktPU);
    if (!mktOO || !mktOU || !isFinite(mktOO) || !isFinite(mktOU)) continue;

    const pO = calibrate(probOver(modelProfile.avg, modelProfile.std, line));
    const pU = calibrate(probUnder(modelProfile.avg, modelProfile.std, line));

    const edgeO = pO - mktPO;
    const edgeU = pU - mktPU;
    const bestSide = edgeO >= edgeU ? 'Over' : 'Under';
    const bestEdge = edgeO >= edgeU ? edgeO : edgeU;
    const bestProb = edgeO >= edgeU ? pO : pU;
    const bestOdd  = edgeO >= edgeU ? mktOO : mktOU;

    if (!best || Math.abs(bestEdge) > Math.abs(best.bestEdge)) {
      best = { line, mktOO, mktOU, pO, pU, edgeO, edgeU, bestSide, bestEdge, bestProb, bestOdd };
    }
  }
  return best;
}

// ── Main ───────────────────────────────────────────────────────────────────────
function main() {
  if (!fs.existsSync(TENNIS_STATS_FILE)) {
    console.error(`ERRO: ${TENNIS_STATS_FILE} não encontrado.`);
    process.exit(1);
  }

  const playerStats = JSON.parse(fs.readFileSync(TENNIS_STATS_FILE));
  console.log(`Jogadores carregados: ${Object.keys(playerStats).length}`);

  const allRecords  = extractMatchRecords(playerStats);
  const baseRecords = allRecords.filter(r => r.date < DATA_SPLIT);
  const walkRecords = allRecords.filter(r => r.date >= DATA_SPLIT);

  console.log(`Base (< ${DATA_SPLIT}): ${baseRecords.length} partidas | Walk-forward (≥ ${DATA_SPLIT}): ${walkRecords.length} partidas`);

  // ── Perfil de mercado (base histórica) ────────────────────────────────────
  console.log('Construindo perfil de mercado...');
  const marketRaw = {};

  for (const record of baseRecords) {
    const { playerName, surface, stats } = record;
    if (stats.sets === 0 && stats.games === 0) continue; // walkover

    if (!marketRaw[playerName]) marketRaw[playerName] = {};
    for (const surf of [surface, 'all']) {
      if (!marketRaw[playerName][surf]) marketRaw[playerName][surf] = {};
      for (const stat of STAT_KEYS) {
        const v = stats[stat];
        if (v === null || v === undefined) continue;
        if (!marketRaw[playerName][surf][stat]) marketRaw[playerName][surf][stat] = [];
        marketRaw[playerName][surf][stat].push(v);
      }
    }
  }

  const marketProfiles = {};
  for (const [name, surfs] of Object.entries(marketRaw)) {
    marketProfiles[name] = {};
    for (const [surf, stats] of Object.entries(surfs)) {
      marketProfiles[name][surf] = {};
      const minGames = surf === 'all' ? MIN_GAMES_MKT_ALL : MIN_GAMES_MKT_SURFACE;
      for (const [stat, values] of Object.entries(stats)) {
        const s = calcAvgStd(values);
        if (s && s.count >= minGames) {
          marketProfiles[name][surf][stat] = s;
        }
      }
    }
  }

  console.log(`Perfil de mercado: ${Object.keys(marketProfiles).length} jogadores\n`);

  // ── Walk-forward ───────────────────────────────────────────────────────────
  const modelRaw    = {};
  const predictions = [];
  let skipped = 0, walkovers = 0;

  console.log('Gerando predições walk-forward...');

  for (const record of walkRecords) {
    const { playerName, surface, date, stats } = record;

    // Walkover: ambos sets=0 e games=0
    if (stats.sets === 0 && stats.games === 0) { walkovers++; continue; }

    // Predições ANTES de atualizar modelRaw (walk-forward correto)
    for (const stat of STAT_KEYS) {
      const actual = stats[stat];
      if (actual === null || actual === undefined) continue;

      // Perfil de mercado: superfície → fallback 'all'
      const mktProfile =
        (marketProfiles[playerName]?.[surface]?.[stat]?.count >= MIN_GAMES_MKT_SURFACE)
          ? marketProfiles[playerName][surface][stat]
          : (marketProfiles[playerName]?.['all']?.[stat]?.count >= MIN_GAMES_MKT_ALL)
          ? marketProfiles[playerName]['all'][stat]
          : null;

      if (!mktProfile || mktProfile.std < MIN_STD[stat]) { skipped++; continue; }

      // Perfil do modelo walk-forward: superfície → 'all' → fallback mercado
      const modelEntries =
        (modelRaw[playerName]?.[surface]?.[stat]?.length >= MIN_GAMES_MODEL)
          ? modelRaw[playerName][surface][stat]
          : (modelRaw[playerName]?.['all']?.[stat]?.length >= MIN_GAMES_MODEL)
          ? modelRaw[playerName]['all'][stat]
          : null;

      let modelProfile = null;
      if (modelEntries && modelEntries.length >= MIN_GAMES_MODEL) {
        modelProfile = calcWeightedAvgStd(modelEntries.map(e => e.value));
      } else {
        modelProfile = mktProfile;
      }
      if (!modelProfile) { skipped++; continue; }

      const result = selectBestLine(stat, mktProfile, modelProfile);
      if (!result) { skipped++; continue; }

      const { line, bestSide, bestEdge, bestProb, bestOdd } = result;
      const kelly = calcKelly(bestProb, bestOdd);
      if (kelly <= 0) { skipped++; continue; }

      const won = bestSide === 'Over' ? actual > line : actual < line;

      predictions.push({
        date,
        player: playerName,
        stat,
        surface,
        side: bestSide,
        line,
        actual,
        prob:      parseFloat((bestProb * 100).toFixed(1)),
        edge:      parseFloat((bestEdge * 100).toFixed(2)),
        mktOdd:    parseFloat(bestOdd.toFixed(3)),
        kellyFrac: parseFloat((kelly * 100).toFixed(2)),
        modelAvg:  parseFloat(modelProfile.avg.toFixed(2)),
        modelGames: modelEntries?.length || 0,
        won,
      });
    }

    // Atualiza modelRaw APÓS todas as predições desta partida
    if (!modelRaw[playerName]) modelRaw[playerName] = {};
    for (const surf of [surface, 'all']) {
      if (!modelRaw[playerName][surf]) modelRaw[playerName][surf] = {};
      for (const stat of STAT_KEYS) {
        const v = stats[stat];
        if (v === null || v === undefined) continue;
        if (!modelRaw[playerName][surf][stat]) modelRaw[playerName][surf][stat] = [];
        modelRaw[playerName][surf][stat].push({ value: v });
      }
    }
  }

  console.log(`Props geradas: ${predictions.length} | Puladas: ${skipped} | Walkovers: ${walkovers}\n`);

  // ── Calibração e Brier Score ───────────────────────────────────────────────
  const buckets = {};
  for (let i = 0; i <= 9; i++) {
    buckets[(0.5 + i * 0.05).toFixed(2)] = { predicted: 0, actual: 0, n: 0 };
  }

  let brierSum = 0, correct = 0;
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

  // ── ROI ────────────────────────────────────────────────────────────────────
  const bestByMarket = {};
  for (const p of predictions) {
    const key = `${p.date}|${p.player}|${p.stat}`;
    if (!bestByMarket[key] || Math.abs(p.edge) > Math.abs(bestByMarket[key].edge)) {
      bestByMarket[key] = p;
    }
  }

  const bets = Object.values(bestByMarket).sort((a, b) => a.date.localeCompare(b.date));

  let bankroll = BANKROLL_START, peak = BANKROLL_START, maxDrawdown = 0;
  let totalWagered = 0, totalReturn = 0, wins = 0, losses = 0;
  const bankrollHistory = [bankroll];

  const edgeBuckets = {
    '0-5%':   { bets: 0, wins: 0, wagered: 0, returned: 0 },
    '5-10%':  { bets: 0, wins: 0, wagered: 0, returned: 0 },
    '10-15%': { bets: 0, wins: 0, wagered: 0, returned: 0 },
    '15%+':   { bets: 0, wins: 0, wagered: 0, returned: 0 },
  };

  const statBreakdown = {};
  for (const stat of STAT_KEYS) statBreakdown[stat] = { bets: 0, wins: 0, wagered: 0, returned: 0 };

  const surfaceBreakdown = {};
  for (const surf of [...SURFACES, 'all']) surfaceBreakdown[surf] = { bets: 0, wins: 0, wagered: 0, returned: 0 };

  for (const p of bets) {
    if (!isFinite(p.mktOdd) || p.mktOdd <= 1) continue;
    const stake = Math.min(BANKROLL_START * (p.kellyFrac / 100), FLAT_STAKE_CAP);
    if (stake <= 0) continue;

    totalWagered += stake;
    const eKey = p.edge < 5 ? '0-5%' : p.edge < 10 ? '5-10%' : p.edge < 15 ? '10-15%' : '15%+';
    edgeBuckets[eKey].bets++;
    edgeBuckets[eKey].wagered += stake;
    statBreakdown[p.stat].bets++;
    statBreakdown[p.stat].wagered += stake;
    if (surfaceBreakdown[p.surface]) {
      surfaceBreakdown[p.surface].bets++;
      surfaceBreakdown[p.surface].wagered += stake;
    }

    if (p.won) {
      const profit = stake * (p.mktOdd - 1);
      bankroll    += profit;
      totalReturn += profit;
      wins++;
      edgeBuckets[eKey].returned    += profit;
      edgeBuckets[eKey].wins++;
      statBreakdown[p.stat].returned += profit;
      statBreakdown[p.stat].wins++;
      if (surfaceBreakdown[p.surface]) {
        surfaceBreakdown[p.surface].returned += profit;
        surfaceBreakdown[p.surface].wins++;
      }
    } else {
      bankroll    -= stake;
      totalReturn -= stake;
      losses++;
      edgeBuckets[eKey].returned    -= stake;
      statBreakdown[p.stat].returned -= stake;
      if (surfaceBreakdown[p.surface]) {
        surfaceBreakdown[p.surface].returned -= stake;
      }
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
  console.log('BACKTESTING TENNIS PROPS v1');
  console.log(`Split: base < ${DATA_SPLIT} | walk-forward ≥ ${DATA_SPLIT}`);
  console.log(`Mercado: média simples histórica por superfície | Modelo: média ponderada walk-forward`);
  console.log(`Filtros: sem walkover (sets=0 e games=0)`);
  console.log(`Kelly: ${KELLY_FRACTION * 100}% | Vig: ${HOUSE_MARGIN * 100}% | Min jogos mkt surf: ${MIN_GAMES_MKT_SURFACE} | Min jogos mkt all: ${MIN_GAMES_MKT_ALL} | Min jogos modelo: ${MIN_GAMES_MODEL}`);
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
  console.log('');
  console.log('ROI por superfície:');
  console.log('  Superfície   | Apostas | Win%   | ROI');
  console.log('  -------------|---------|--------|--------');
  for (const [surf, b] of Object.entries(surfaceBreakdown)) {
    if (b.bets === 0) continue;
    const wp = (b.wins / b.bets * 100).toFixed(1);
    const r  = b.wagered > 0 ? (b.returned / b.wagered * 100).toFixed(2) : 'n/a';
    const s  = parseFloat(r) >= 0 ? '+' : '';
    console.log(`  ${surf.padEnd(12)} | ${String(b.bets).padStart(7)} | ${wp.padStart(5)}% | ${s}${r}%`);
  }

  fs.writeFileSync('tennis_props_backtest_results.json', JSON.stringify({
    version: 1,
    config: {
      dataSplit: DATA_SPLIT,
      kellyFraction: KELLY_FRACTION,
      houseMargin: HOUSE_MARGIN,
      minGamesMktSurface: MIN_GAMES_MKT_SURFACE,
      minGamesMktAll: MIN_GAMES_MKT_ALL,
      minGamesModel: MIN_GAMES_MODEL,
      decay: DECAY,
      filters: ['no_walkover'],
    },
    summary: {
      totalProps: predictions.length,
      skipped,
      walkovers,
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
    surfaceBreakdown,
    bankrollHistory,
  }, null, 2));

  console.log('\ntennis_props_backtest_results.json salvo.');
}

main();
