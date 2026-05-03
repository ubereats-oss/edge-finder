const fs = require('fs');

// ── Configuração ───────────────────────────────────────────────────────────────
const KELLY_FRACTION  = 0.25;
const HOUSE_MARGIN    = 0.05;
const MIN_GAMES_MKT   = 8;
const MIN_GAMES_MODEL = 5;
const STAT_KEYS       = ['goals', 'assists', 'points', 'shots', 'blocked'];
const BASE_SEASON     = 2025; // temporada 2024-25
const WALK_SEASON     = 2026; // temporada 2025-26
const BANKROLL_START  = 1000;
const FLAT_STAKE_CAP  = BANKROLL_START * 0.05;
const DECAY           = 0.97;
const MIN_TOI_SECONDS = 300;

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

// ── Calibração isotônica (idêntica ao model_nhl_props.js) ─────────────────────
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

// ── Linha de mercado simulada por stat ────────────────────────────────────────
// shots: arredonda para o 0.5 mais próximo; demais: piso + 0.5
function calcLine(stat, avg) {
  if (stat === 'shots') return Math.round(avg * 2) / 2;
  return Math.floor(avg) + 0.5;
}

// ── Extrai registros de jogo a partir de nhl_player_stats.json ───────────────
// Retorna array de { playerName, date, location, season, stats, blowout, toiSeconds }
// Um registro por (jogador × jogo), ordenado por data.
// Todos os stats de um jogo compartilham o mesmo índice no array do ctx.
function extractPlayerGames(playerStats, seasons) {
  const games = [];
  for (const [playerName, playerData] of Object.entries(playerStats)) {
    for (const [seasonStr, seasonData] of Object.entries(playerData)) {
      const season = parseInt(seasonStr);
      if (!seasons.includes(season)) continue;
      for (const gameType of ['regular', 'playoffs']) {
        for (const loc of ['home', 'away']) {
          const ctx = seasonData[gameType]?.[loc];
          if (!ctx || !ctx.goals || ctx.goals.length === 0) continue;
          const n = ctx.goals.length;
          for (let i = 0; i < n; i++) {
            const base = ctx.goals[i]; // porta date, blowout, toiSeconds
            const stats = {};
            for (const stat of STAT_KEYS) {
              const arr = ctx[stat];
              stats[stat] = arr && arr[i] !== undefined ? (arr[i].value ?? 0) : 0;
            }
            games.push({
              playerName,
              date:       base.date       || '',
              location:   loc,
              season,
              stats,
              blowout:    base.blowout    || false,
              toiSeconds: base.toiSeconds || 0,
              opponent:   base.opponent   || '',
            });
          }
        }
      }
    }
  }
  return games.sort((a, b) => a.date.localeCompare(b.date));
}

// ── Main ───────────────────────────────────────────────────────────────────────
function main() {
  if (!fs.existsSync('nhl_player_stats.json')) {
    console.error('ERRO: nhl_player_stats.json não encontrado.');
    process.exit(1);
  }

  const playerStats = JSON.parse(fs.readFileSync('nhl_player_stats.json'));
  console.log(`Jogadores carregados: ${Object.keys(playerStats).length}`);

  const baseGames = extractPlayerGames(playerStats, [BASE_SEASON]);
  const walkGames = extractPlayerGames(playerStats, [WALK_SEASON]);

  console.log(`Base (2024-25): ${baseGames.length} player-games | Walk-forward (2025-26): ${walkGames.length} player-games`);

  // ── Perfil de mercado (base histórica) ────────────────────────────────────
  console.log('Construindo perfil de mercado...');
  const marketRaw = {};

  for (const g of baseGames) {
    if (g.blowout || g.toiSeconds < MIN_TOI_SECONDS) continue;
    if (!marketRaw[g.playerName]) marketRaw[g.playerName] = { home: {}, away: {}, all: {} };
    for (const stat of STAT_KEYS) {
      const v = g.stats[stat];
      if (v === null || v === undefined) continue;
      for (const loc of [g.location, 'all']) {
        if (!marketRaw[g.playerName][loc][stat]) marketRaw[g.playerName][loc][stat] = [];
        marketRaw[g.playerName][loc][stat].push(v);
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
  const modelRaw = {}; // acumula valores walk-forward com metadados
  const predictions = [];
  let skipped = 0, filtroBlowout = 0, filtroToi = 0;

  console.log('Gerando predições walk-forward...');

  for (const g of walkGames) {
    const { playerName, location, stats, blowout, toiSeconds, date } = g;

    // ── Predição para cada stat ANTES de atualizar modelRaw ───────────────
    for (const stat of STAT_KEYS) {
      const actual = stats[stat];
      if (actual === null || actual === undefined) continue;

      if (blowout)                      { filtroBlowout++; continue; }
      if (toiSeconds < MIN_TOI_SECONDS) { filtroToi++;    continue; }

      // Perfil de mercado
      const mktProfile =
        marketProfiles[playerName]?.[location]?.[stat]?.count >= MIN_GAMES_MKT
          ? marketProfiles[playerName][location][stat]
          : marketProfiles[playerName]?.['all']?.[stat]?.count >= MIN_GAMES_MKT
          ? marketProfiles[playerName]['all'][stat]
          : null;

      if (!mktProfile || mktProfile.std < 0.2) { skipped++; continue; }

      const line = calcLine(stat, mktProfile.avg);
      if (line < 0.5) { skipped++; continue; }

      const mktPOver  = probOver(mktProfile.avg, mktProfile.std, line);
      const mktPUnder = probUnder(mktProfile.avg, mktProfile.std, line);
      if (mktPOver <= 0 || mktPUnder <= 0) { skipped++; continue; }

      const mktOddOver  = marketOdd(mktPOver);
      const mktOddUnder = marketOdd(mktPUnder);
      if (!mktOddOver || !mktOddUnder || !isFinite(mktOddOver) || !isFinite(mktOddUnder)) {
        skipped++; continue;
      }

      // Modelo walk-forward
      const modelEntries =
        modelRaw[playerName]?.[location]?.[stat] ||
        modelRaw[playerName]?.['all']?.[stat] ||
        null;

      let modelValues = null;
      if (modelEntries && modelEntries.length >= MIN_GAMES_MODEL) {
        modelValues = modelEntries
          .filter(e => !e._blowout && !e._toiLow)
          .map(e => e.value);
        if (modelValues.length < MIN_GAMES_MODEL) modelValues = modelEntries.map(e => e.value);
      }

      let modelProfile = null;
      if (modelValues && modelValues.length >= MIN_GAMES_MODEL) {
        modelProfile = calcWeightedAvgStd(modelValues);
      } else if (mktProfile) {
        modelProfile = mktProfile;
      }

      if (!modelProfile) { skipped++; continue; }

      const pOverRaw  = probOver(modelProfile.avg, modelProfile.std, line);
      const pUnderRaw = probUnder(modelProfile.avg, modelProfile.std, line);
      const pOver  = calibrate(pOverRaw);
      const pUnder = calibrate(pUnderRaw);

      const edgeOver  = pOver  - mktPOver;
      const edgeUnder = pUnder - mktPUnder;

      const bestSide = edgeOver >= edgeUnder ? 'Over' : 'Under';
      const bestProb = edgeOver >= edgeUnder ? pOver  : pUnder;
      const bestOdd  = edgeOver >= edgeUnder ? mktOddOver : mktOddUnder;
      const bestEdge = edgeOver >= edgeUnder ? edgeOver : edgeUnder;

      const kelly = calcKelly(bestProb, bestOdd);
      if (kelly <= 0) { skipped++; continue; }

      const won = bestSide === 'Over' ? actual > line : actual < line;

      predictions.push({
        date,
        player: playerName,
        stat,
        location,
        side: bestSide,
        line,
        actual,
        prob:      parseFloat((bestProb * 100).toFixed(1)),
        edge:      parseFloat((bestEdge * 100).toFixed(2)),
        mktOdd:    parseFloat(bestOdd.toFixed(3)),
        kellyFrac: parseFloat((kelly * 100).toFixed(2)),
        modelAvg:  parseFloat(modelProfile.avg.toFixed(2)),
        won,
        modelGames: modelValues?.length || 0,
      });
    }

    // ── Atualiza modelRaw APÓS predição (walk-forward correto) ────────────
    if (!modelRaw[playerName]) modelRaw[playerName] = { home: {}, away: {}, all: {} };
    for (const stat of STAT_KEYS) {
      const v = stats[stat];
      if (v === null || v === undefined) continue;
      const entry = {
        value:    v,
        _blowout: blowout,
        _toiLow:  toiSeconds < MIN_TOI_SECONDS,
      };
      for (const loc of [location, 'all']) {
        if (!modelRaw[playerName][loc][stat]) modelRaw[playerName][loc][stat] = [];
        modelRaw[playerName][loc][stat].push(entry);
      }
    }
  }

  console.log(`Props geradas: ${predictions.length} | Puladas: ${skipped}`);
  console.log(`Filtros aplicados — Blowout: ${filtroBlowout} | TOI < 5min: ${filtroToi}\n`);

  if (predictions.length === 0) {
    console.log('Nenhuma predição gerada. Verifique se nhl_player_stats.json tem dados da temporada 2026.');
    process.exit(0);
  }

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

  const bets = Object.values(bestByMarket).sort((a, b) => new Date(a.date) - new Date(b.date));

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

    if (p.won) {
      const profit = stake * (p.mktOdd - 1);
      bankroll    += profit;
      totalReturn += profit;
      wins++;
      edgeBuckets[eKey].returned     += profit;
      edgeBuckets[eKey].wins++;
      statBreakdown[p.stat].returned += profit;
      statBreakdown[p.stat].wins++;
    } else {
      bankroll    -= stake;
      totalReturn -= stake;
      losses++;
      edgeBuckets[eKey].returned     -= stake;
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
  console.log('BACKTESTING NHL PROPS v1');
  console.log(`Mercado: média simples 2024-25 | Modelo: média ponderada walk-forward`);
  console.log(`Filtros: sem blowout (≥4 gols), TOI mín. 5min`);
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

  fs.writeFileSync('nhl_props_backtest_results.json', JSON.stringify({
    version: 1,
    config: {
      kellyFraction:  KELLY_FRACTION,
      houseMargin:    HOUSE_MARGIN,
      minGamesMkt:    MIN_GAMES_MKT,
      minGamesModel:  MIN_GAMES_MODEL,
      decay:          DECAY,
      minToiSeconds:  MIN_TOI_SECONDS,
      filters: ['no_blowout_4plus', 'toi_min_5min'],
    },
    summary: {
      totalProps:    predictions.length,
      skipped,
      filtroBlowout,
      filtroToi,
      accuracy:      parseFloat((accuracy * 100).toFixed(2)),
      brierScore:    parseFloat(brierScore.toFixed(4)),
      uniqueMarkets: bets.length,
      wins, losses,
      winRate:       parseFloat((winRate * 100).toFixed(2)),
      bankrollFinal: parseFloat(bankroll.toFixed(2)),
      roi:           parseFloat((roi * 100).toFixed(2)),
      maxDrawdown:   parseFloat((maxDrawdown * 100).toFixed(2)),
    },
    calibration: Object.fromEntries(
      Object.entries(buckets)
        .filter(([, b]) => b.n > 0)
        .map(([key, b]) => [key, {
          n:            b.n,
          predictedPct: parseFloat((b.predicted / b.n * 100).toFixed(1)),
          actualPct:    parseFloat((b.actual    / b.n * 100).toFixed(1)),
        }])
    ),
    edgeBreakdown: edgeBuckets,
    statBreakdown,
    bankrollHistory,
  }, null, 2));

  console.log('\nnhl_props_backtest_results.json salvo.');
}

main();
