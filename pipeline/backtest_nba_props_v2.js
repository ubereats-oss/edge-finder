const fs = require('fs');

// ── Configuração ───────────────────────────────────────────────────────────────
const BOXSCORES_CACHE = 'nba_boxscores_cache.json';
const KELLY_FRACTION  = 0.25;
const HOUSE_MARGIN    = 0.05;
const MIN_GAMES_MKT   = 10;
const MIN_GAMES_MODEL = 5;
const STAT_KEYS       = ['points', 'rebounds', 'assists', 'steals', 'threes', 'fouls'];
const BANKROLL_START  = 1000;
const FLAT_STAKE_CAP  = BANKROLL_START * 0.05;
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

// ── Calibração isotônica ───────────────────────────────────────────────────────
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

// ── Carrega metadados do nba_player_stats.json ────────────────────────────────
// Monta índice: playerName -> statKey -> location -> [{ value, blowout, isOvertime, absentStarters, opponent, date }]
// Indexado por opponent+date para cruzamento com cache
function buildMetaIndex(playerStats) {
  // metaIndex[playerName][statKey][location] = Map<date|oppKey, entry>
  const metaIndex = {};

  for (const [playerName, playerData] of Object.entries(playerStats)) {
    metaIndex[playerName] = {};
    for (const statKey of STAT_KEYS) {
      metaIndex[playerName][statKey] = { home: new Map(), away: new Map() };
      for (const seasonData of Object.values(playerData)) {
        for (const gameType of ['regular', 'playoffs']) {
          for (const loc of ['home', 'away']) {
            const ctx = seasonData[gameType]?.[loc];
            if (!ctx || !ctx[statKey]) continue;
            for (const entry of ctx[statKey]) {
              if (typeof entry !== 'object' || entry === null) continue;
              const oppKey = (entry.opponent || '').split(' ').pop().toLowerCase();
              if (!oppKey) continue;
              const val = {
                blowout: entry.blowout || false,
                isOvertime: entry.isOvertime || false,
                absentStarters: entry.absentStarters || [],
              };
              // Chave primária: date (YYYY-MM-DD) + oppKey
              if (entry.date) {
                const dateKey = `${entry.date.slice(0, 10)}|${oppKey}`;
                metaIndex[playerName][statKey][loc].set(dateKey, val);
              }
              // Chave fallback: só oppKey (último match vence — usado se date não disponível)
              metaIndex[playerName][statKey][loc].set(oppKey, val);
            }
          }
        }
      }
    }
  }
  return metaIndex;
}

// Busca metadados de um jogo específico para um jogador
function getGameMeta(metaIndex, playerName, statKey, location, homeTeam, awayTeam, gameDate) {
  const idx = metaIndex[playerName]?.[statKey]?.[location];
  if (!idx) return null;
  const opponent = location === 'home' ? awayTeam : homeTeam;
  const oppKey = (opponent || '').split(' ').pop().toLowerCase();
  // Tenta match exato por data primeiro
  if (gameDate) {
    const dateKey = `${gameDate.slice(0, 10)}|${oppKey}`;
    if (idx.has(dateKey)) return idx.get(dateKey);
  }
  return idx.get(oppKey) || null;
}

// ── Filtra valores históricos por contexto de ausentes ────────────────────────
function filterByAbsentContext(values, absentToday) {
  if (!absentToday || absentToday.length === 0) return null;
  const filtered = values.filter(v =>
    v._absentStarters && absentToday.some(absent =>
      v._absentStarters.some(h =>
        h.toLowerCase().includes(absent.toLowerCase()) ||
        absent.toLowerCase().includes(h.toLowerCase())
      )
    )
  );
  return filtered.length >= 5 ? filtered.map(v => v.value) : null;
}

// ── Main ───────────────────────────────────────────────────────────────────────
function main() {
  if (!fs.existsSync(BOXSCORES_CACHE)) {
    console.error(`ERRO: ${BOXSCORES_CACHE} não encontrado.`);
    process.exit(1);
  }
  if (!fs.existsSync('nba_player_stats.json')) {
    console.error('ERRO: nba_player_stats.json não encontrado.');
    process.exit(1);
  }

  const cache = JSON.parse(fs.readFileSync(BOXSCORES_CACHE));
  const playerStats = JSON.parse(fs.readFileSync('nba_player_stats.json'));

  const allGames = Object.values(cache).sort((a, b) => new Date(a.date) - new Date(b.date));
  const baseGames = allGames.filter(g => g.season === 'base');
  const walkGames = allGames.filter(g => g.season === 'walk');

  console.log(`Base (2024-25): ${baseGames.length} jogos | Walk-forward (2025-26): ${walkGames.length} jogos`);
  console.log(`Jogadores com metadados: ${Object.keys(playerStats).length}`);

  // Constrói índice de metadados
  console.log('Construindo índice de metadados...');
  const metaIndex = buildMetaIndex(playerStats);

  // ── Perfil de mercado (base histórica) ────────────────────────────────────
  console.log('Construindo perfil de mercado...');
  const marketRaw = {};

  for (const game of baseGames) {
    for (const p of game.players) {
      if (!p.playerName || !p.location) continue;

      // Busca metadados do jogo no nba_player_stats.json
      const meta = getGameMeta(metaIndex, p.playerName, 'points', p.location, game.homeTeam, game.awayTeam, game.date);

      // Exclui blowouts e overtimes do perfil de mercado
      if (meta && (meta.blowout || meta.isOvertime)) continue;

      if (!marketRaw[p.playerName]) marketRaw[p.playerName] = { home: {}, away: {}, all: {} };
      for (const stat of STAT_KEYS) {
        const v = p.stats[stat];
        if (v === null || v === undefined) continue;

        // Busca absentStarters para esta stat
        const statMeta = getGameMeta(metaIndex, p.playerName, stat, p.location, game.homeTeam, game.awayTeam, game.date);
        const absentStarters = statMeta?.absentStarters || [];

        for (const loc of [p.location, 'all']) {
          if (!marketRaw[p.playerName][loc][stat]) marketRaw[p.playerName][loc][stat] = [];
          marketRaw[p.playerName][loc][stat].push({ value: v, _absentStarters: absentStarters });
        }
      }
    }
  }

  const marketProfiles = {};
  for (const [name, locs] of Object.entries(marketRaw)) {
    marketProfiles[name] = {};
    for (const [loc, stats] of Object.entries(locs)) {
      marketProfiles[name][loc] = {};
      for (const [stat, entries] of Object.entries(stats)) {
        const values = entries.map(e => e.value);
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
  let skipped = 0;
  let filtroAusentes = 0;
  let filtroBlowout = 0;
  let filtroOvertime = 0;

  console.log('Gerando predições walk-forward...');

  for (const game of walkGames) {
    for (const player of game.players) {
      const { playerName, location, stats } = player;
      if (!playerName || !location) continue;

      for (const stat of STAT_KEYS) {
        const actual = stats[stat];
        if (actual === null || actual === undefined) continue;

        // Busca metadados do jogo atual
        const meta = getGameMeta(metaIndex, playerName, stat, location, game.homeTeam, game.awayTeam, game.date);

        // Exclui blowouts e overtimes das predições
        if (meta?.blowout)    { filtroBlowout++;   continue; }
        if (meta?.isOvertime) { filtroOvertime++;  continue; }

        const absentToday = meta?.absentStarters || [];

        // Perfil de mercado
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

        const mktPOver  = probOver(mktProfile.avg, mktProfile.std, line);
        const mktPUnder = probUnder(mktProfile.avg, mktProfile.std, line);
        if (mktPOver <= 0 || mktPUnder <= 0) { skipped++; continue; }

        const mktOddOver  = marketOdd(mktPOver);
        const mktOddUnder = marketOdd(mktPUnder);
        if (!mktOddOver || !mktOddUnder || !isFinite(mktOddOver) || !isFinite(mktOddUnder)) { skipped++; continue; }

        // Modelo walk-forward: tenta filtrar por ausentes antes de usar valores brutos
        const modelEntries =
          modelRaw[playerName]?.[location]?.[stat] ||
          modelRaw[playerName]?.['all']?.[stat] ||
          null;

        let modelValues = null;
        let usedAbsentFilter = false;

        if (modelEntries && modelEntries.length >= MIN_GAMES_MODEL) {
          // Tenta filtro de ausentes
          const filtered = filterByAbsentContext(modelEntries, absentToday);
          if (filtered && filtered.length >= MIN_GAMES_MODEL) {
            modelValues = filtered;
            usedAbsentFilter = true;
            filtroAusentes++;
          } else {
            // Fallback: exclui blowouts e overtimes mas usa todos
            modelValues = modelEntries
              .filter(e => !e._blowout && !e._overtime)
              .map(e => e.value);
            if (modelValues.length < MIN_GAMES_MODEL) modelValues = modelEntries.map(e => e.value);
          }
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
          date: game.date,
          player: playerName,
          stat,
          location,
          side: bestSide,
          line,
          actual,
          prob: parseFloat((bestProb * 100).toFixed(1)),
          edge: parseFloat((bestEdge * 100).toFixed(2)),
          mktOdd: parseFloat(bestOdd.toFixed(3)),
          kellyFrac: parseFloat((kelly * 100).toFixed(2)),
          modelAvg: parseFloat(modelProfile.avg.toFixed(2)),
          usedAbsentFilter,
          won,
          modelGames: modelValues?.length || 0,
        });
      }

      // Atualiza modelRaw APÓS predição (walk-forward correto)
      if (!modelRaw[playerName]) modelRaw[playerName] = { home: {}, away: {}, all: {} };
      for (const stat of STAT_KEYS) {
        const v = stats[stat];
        if (v === null || v === undefined) continue;

        const meta = getGameMeta(metaIndex, playerName, stat, location, game.homeTeam, game.awayTeam, game.date);
        const entry = {
          value: v,
          _absentStarters: meta?.absentStarters || [],
          _blowout: meta?.blowout || false,
          _overtime: meta?.isOvertime || false,
        };

        for (const loc of [location, 'all']) {
          if (!modelRaw[playerName][loc][stat]) modelRaw[playerName][loc][stat] = [];
          modelRaw[playerName][loc][stat].push(entry);
        }
      }
    }
  }

  console.log(`Props geradas: ${predictions.length} | Puladas: ${skipped}`);
  console.log(`Filtros aplicados — Blowout: ${filtroBlowout} | Overtime: ${filtroOvertime} | Ausentes: ${filtroAusentes}\n`);

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
  console.log('BACKTESTING NBA PROPS v2');
  console.log(`Mercado: média simples 2024-25 | Modelo: média ponderada walk-forward`);
  console.log(`Filtros: sem blowout, sem OT, contexto de ausentes`);
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

  fs.writeFileSync('nba_props_backtest_v2_results.json', JSON.stringify({
    version: 2,
    config: {
      kellyFraction: KELLY_FRACTION,
      houseMargin: HOUSE_MARGIN,
      minGamesMkt: MIN_GAMES_MKT,
      minGamesModel: MIN_GAMES_MODEL,
      decay: DECAY,
      filters: ['no_blowout', 'no_overtime', 'absent_starters_context'],
    },
    summary: {
      totalProps: predictions.length,
      skipped,
      filtroBlowout,
      filtroOvertime,
      filtroAusentes,
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

  console.log('\nnba_props_backtest_v2_results.json salvo.');
}

main();
