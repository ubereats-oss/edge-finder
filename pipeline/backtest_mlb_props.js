const fs = require('fs');

// ── Configuração ────────────────────────────────────────────────────────────────
const KELLY_FRACTION  = 0.25;
const HOUSE_MARGIN    = 0.05;
const MIN_GAMES_MKT   = 10;
const MIN_GAMES_MODEL = 5;
const BANKROLL_START  = 1000;
const FLAT_STAKE_CAP  = BANKROLL_START * 0.05;
const DECAY           = 0.98;

const BATTER_KEYS  = ['hits', 'homeRuns'];
const PITCHER_KEYS = ['strikeouts', 'hitsAllowed'];
const ALL_STAT_KEYS = [...BATTER_KEYS, ...PITCHER_KEYS];

// Temporadas: base = 2023+2024, walk-forward = 2025+2026
const BASE_SEASONS = [2023, 2024];
const WALK_SEASONS = [2025, 2026];

// ── Utilitários ─────────────────────────────────────────────────────────────────
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

// ── Isotônica PAVA ──────────────────────────────────────────────────────────────
function isotonicRegression(pairs) {
  // pairs: [{x, y}] ordenados por x, y in [0,1]
  // Retorna [{x, y_iso}] com regressão isotônica crescente
  const n = pairs.length;
  if (n === 0) return [];
  const g = pairs.map(p => ({ sum: p.y, count: 1, x: p.x }));
  let i = 0;
  while (i < g.length - 1) {
    if (g[i].sum / g[i].count > g[i + 1].sum / g[i + 1].count) {
      g[i].sum += g[i + 1].sum;
      g[i].count += g[i + 1].count;
      g.splice(i + 1, 1);
      if (i > 0) i--;
    } else {
      i++;
    }
  }
  const result = [];
  for (const group of g) {
    const val = group.sum / group.count;
    result.push({ x: group.x, y: val });
  }
  return result;
}

function buildCalibTable(predictions) {
  // Agrupa por faixas de 5pp e aplica isotônica
  const buckets = {};
  for (const p of predictions) {
    const prob = p.prob / 100;
    // Espelha abaixo de 0.5
    const normProb = prob >= 0.5 ? prob : 1 - prob;
    const normOutcome = prob >= 0.5 ? (p.won ? 1 : 0) : (p.won ? 0 : 1);
    const key = Math.round(normProb * 20) / 20; // arredonda para 0.05
    if (!buckets[key]) buckets[key] = { sum: 0, count: 0 };
    buckets[key].sum += normOutcome;
    buckets[key].count++;
  }

  const pairs = Object.entries(buckets)
    .filter(([, b]) => b.count >= 10)
    .map(([k, b]) => ({ x: parseFloat(k), y: b.sum / b.count }))
    .sort((a, b) => a.x - b.x);

  return isotonicRegression(pairs);
}

function calibrateWithTable(p, table) {
  if (table.length === 0) return p;
  const mirrored = p >= 0.5;
  const normP = mirrored ? p : 1 - p;

  if (normP <= table[0].x) {
    const cal = table[0].y;
    return mirrored ? cal : 1 - cal;
  }
  if (normP >= table[table.length - 1].x) {
    const cal = table[table.length - 1].y;
    return mirrored ? cal : 1 - cal;
  }
  for (let i = 0; i < table.length - 1; i++) {
    if (normP >= table[i].x && normP <= table[i + 1].x) {
      const t = (normP - table[i].x) / (table[i + 1].x - table[i].x);
      const cal = table[i].y + t * (table[i + 1].y - table[i].y);
      return mirrored ? cal : 1 - cal;
    }
  }
  return p;
}

// ── Extrai todas as entradas de mlb_player_stats.json ──────────────────────────
// Retorna array de { playerName, stat, season, location, value, date, opponent, blowout, isExtraInnings, absentStarters }
function extractEntries(playerStats) {
  const entries = [];
  for (const [playerName, playerData] of Object.entries(playerStats)) {
    for (const [seasonStr, seasonData] of Object.entries(playerData)) {
      const season = parseInt(seasonStr);
      for (const gameType of ['regular', 'playoffs']) {
        for (const loc of ['home', 'away']) {
          const ctx = seasonData[gameType]?.[loc];
          if (!ctx) continue;
          for (const stat of ALL_STAT_KEYS) {
            for (const entry of ctx[stat] || []) {
              if (typeof entry !== 'object' || entry === null) continue;
              entries.push({
                playerName,
                stat,
                season,
                location: loc,
                value: entry.value,
                date: entry.date || '',
                opponent: entry.opponent || '',
                blowout: entry.blowout || false,
                isExtraInnings: entry.isExtraInnings || false,
                absentStarters: entry.absentStarters || [],
              });
            }
          }
        }
      }
    }
  }
  return entries.sort((a, b) => a.date.localeCompare(b.date));
}

function filterByAbsentContext(entries, absentToday) {
  if (!absentToday || absentToday.length === 0) return null;
  const filtered = entries.filter(e =>
    e.absentStarters && absentToday.some(absent =>
      e.absentStarters.some(h =>
        h.toLowerCase().includes(absent.toLowerCase()) ||
        absent.toLowerCase().includes(h.toLowerCase())
      )
    )
  );
  return filtered.length >= MIN_GAMES_MODEL ? filtered.map(e => e.value) : null;
}

// ── Main ────────────────────────────────────────────────────────────────────────
function main() {
  if (!fs.existsSync('mlb_player_stats.json')) {
    console.error('ERRO: mlb_player_stats.json não encontrado.');
    process.exit(1);
  }

  const playerStats = JSON.parse(fs.readFileSync('mlb_player_stats.json'));
  console.log(`Jogadores carregados: ${Object.keys(playerStats).length}`);

  const allEntries = extractEntries(playerStats);
  console.log(`Entradas totais: ${allEntries.length}`);

  const baseEntries = allEntries.filter(e => BASE_SEASONS.includes(e.season));
  const walkEntries = allEntries.filter(e => WALK_SEASONS.includes(e.season));

  console.log(`Base (${BASE_SEASONS.join('+')}): ${baseEntries.length} entradas`);
  console.log(`Walk-forward (${WALK_SEASONS.join('+')}): ${walkEntries.length} entradas\n`);

  // ── Perfil de mercado (base) ─────────────────────────────────────────────────
  console.log('Construindo perfil de mercado...');
  const marketRaw = {};
  for (const e of baseEntries) {
    if (e.blowout || e.isExtraInnings) continue;
    const key = e.playerName;
    if (!marketRaw[key]) marketRaw[key] = {};
    for (const loc of [e.location, 'all']) {
      if (!marketRaw[key][loc]) marketRaw[key][loc] = {};
      if (!marketRaw[key][loc][e.stat]) marketRaw[key][loc][e.stat] = [];
      marketRaw[key][loc][e.stat].push({ value: e.value, absentStarters: e.absentStarters });
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

  // ── Walk-forward (primeira passagem — sem calibração) ────────────────────────
  console.log('Gerando predições walk-forward (passagem 1)...');

  // Índice walk: playerName -> stat -> location -> [entries em ordem de data]
  const modelRaw = {};
  const predictions = [];
  let skipped = 0, filtroBlowout = 0, filtroExtra = 0, filtroAusentes = 0;

  // Agrupa walkEntries por data+jogador para processar jogo a jogo
  const byDatePlayer = {};
  for (const e of walkEntries) {
    const key = `${e.date}|${e.playerName}`;
    if (!byDatePlayer[key]) byDatePlayer[key] = [];
    byDatePlayer[key].push(e);
  }

  const orderedKeys = Object.keys(byDatePlayer).sort();

  for (const dpKey of orderedKeys) {
    const gameEntries = byDatePlayer[dpKey];
    const { playerName, date, location, opponent, blowout, isExtraInnings } = gameEntries[0];

    for (const e of gameEntries) {
      const { stat, value, absentStarters } = e;

      if (e.blowout)          { filtroBlowout++; continue; }
      if (e.isExtraInnings)   { filtroExtra++;   continue; }

      // Perfil de mercado
      const mktProfile =
        marketProfiles[playerName]?.[location]?.[stat]?.count >= MIN_GAMES_MKT
          ? marketProfiles[playerName][location][stat]
          : marketProfiles[playerName]?.['all']?.[stat]?.count >= MIN_GAMES_MKT
          ? marketProfiles[playerName]['all'][stat]
          : null;

      const minStd = BATTER_KEYS.includes(stat) ? 0.3 : 0.5;
      if (!mktProfile || mktProfile.std < minStd) { skipped++; continue; }

      const rawLine = mktProfile.avg;
      const line = Math.floor(rawLine) + 0.5;
      if (line < 0) { skipped++; continue; }

      const mktPOver  = probOver(mktProfile.avg, mktProfile.std, line);
      const mktPUnder = probUnder(mktProfile.avg, mktProfile.std, line);
      if (mktPOver <= 0 || mktPUnder <= 0) { skipped++; continue; }

      const mktOddOver  = marketOdd(mktPOver);
      const mktOddUnder = marketOdd(mktPUnder);
      if (!mktOddOver || !mktOddUnder || !isFinite(mktOddOver) || !isFinite(mktOddUnder)) { skipped++; continue; }

      // Modelo walk-forward
      const modelEntries =
        modelRaw[playerName]?.[location]?.[stat] ||
        modelRaw[playerName]?.['all']?.[stat] ||
        null;

      let modelValues = null;
      let usedAbsentFilter = false;

      if (modelEntries && modelEntries.length >= MIN_GAMES_MODEL) {
        const filtered = filterByAbsentContext(modelEntries, absentStarters);
        if (filtered && filtered.length >= MIN_GAMES_MODEL) {
          modelValues = filtered;
          usedAbsentFilter = true;
          filtroAusentes++;
        } else {
          modelValues = modelEntries
            .filter(e => !e._blowout && !e._extra)
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

      // Passagem 1: sem calibração (será aplicada na passagem 2)
      const pOver  = pOverRaw;
      const pUnder = pUnderRaw;

      const edgeOver  = pOver  - mktPOver;
      const edgeUnder = pUnder - mktPUnder;

      const bestSide = edgeOver >= edgeUnder ? 'Over' : 'Under';
      const bestProb = edgeOver >= edgeUnder ? pOver  : pUnder;
      const bestOdd  = edgeOver >= edgeUnder ? mktOddOver : mktOddUnder;
      const bestEdge = edgeOver >= edgeUnder ? edgeOver : edgeUnder;

      const kelly = calcKelly(bestProb, bestOdd);
      if (kelly <= 0) { skipped++; continue; }

      const won = bestSide === 'Over' ? value > line : value < line;

      predictions.push({
        date,
        player: playerName,
        stat,
        location,
        opponent,
        side: bestSide,
        line,
        actual: value,
        prob: parseFloat((bestProb * 100).toFixed(1)),
        edge: parseFloat((bestEdge * 100).toFixed(2)),
        mktOdd: parseFloat(bestOdd.toFixed(3)),
        kellyFrac: parseFloat((kelly * 100).toFixed(2)),
        modelAvg: parseFloat(modelProfile.avg.toFixed(3)),
        usedAbsentFilter,
        won,
        modelGames: modelValues?.length || 0,
      });
    }

    // Atualiza modelRaw APÓS predição (walk-forward correto)
    for (const e of gameEntries) {
      const { stat, value, absentStarters } = e;
      if (!modelRaw[playerName]) modelRaw[playerName] = {};
      const entry = {
        value,
        absentStarters,
        _blowout: e.blowout,
        _extra: e.isExtraInnings,
      };
      for (const loc of [location, 'all']) {
        if (!modelRaw[playerName][loc]) modelRaw[playerName][loc] = {};
        if (!modelRaw[playerName][loc][stat]) modelRaw[playerName][loc][stat] = [];
        modelRaw[playerName][loc][stat].push(entry);
      }
    }
  }

  console.log(`Props geradas: ${predictions.length} | Puladas: ${skipped}`);
  console.log(`Filtros — Blowout: ${filtroBlowout} | Extra innings: ${filtroExtra} | Ausentes: ${filtroAusentes}\n`);

  // ── Calibração isotônica própria ─────────────────────────────────────────────
  console.log('Calculando calibração isotônica...');
  const calibTable = buildCalibTable(predictions);

  console.log('Tabela de calibração gerada:');
  console.log('  raw   → cal');
  for (const row of calibTable) {
    console.log(`  ${row.x.toFixed(3)} → ${row.y.toFixed(3)}`);
  }
  console.log('');

  // ── Aplica calibração e recalcula métricas ───────────────────────────────────
  for (const p of predictions) {
    const rawProb = p.prob / 100;
    p.probCal = parseFloat((calibrateWithTable(rawProb, calibTable) * 100).toFixed(1));
  }

  // ── Calibração e Brier Score ─────────────────────────────────────────────────
  const buckets = {};
  for (let i = 0; i <= 9; i++) {
    buckets[(0.5 + i * 0.05).toFixed(2)] = { predicted: 0, actual: 0, n: 0 };
  }

  let brierRaw = 0, brierCal = 0, correct = 0;
  for (const p of predictions) {
    const probRaw = p.prob / 100;
    const probCal = p.probCal / 100;
    const outcome = p.won ? 1 : 0;
    brierRaw += Math.pow(probRaw - outcome, 2);
    brierCal += Math.pow(probCal - outcome, 2);
    if (p.won) correct++;
    const key = (Math.floor(probCal / 0.05) * 0.05).toFixed(2);
    if (buckets[key]) {
      buckets[key].predicted += probCal;
      buckets[key].actual    += outcome;
      buckets[key].n++;
    }
  }

  const accuracy     = correct / predictions.length;
  const brierScoreRaw = brierRaw / predictions.length;
  const brierScoreCal = brierCal / predictions.length;

  // ── ROI ───────────────────────────────────────────────────────────────────────
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
  for (const stat of ALL_STAT_KEYS) statBreakdown[stat] = { bets: 0, wins: 0, wagered: 0, returned: 0 };

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

  // ── Output ────────────────────────────────────────────────────────────────────
  console.log('══════════════════════════════════════════');
  console.log('BACKTESTING MLB PROPS');
  console.log(`Base: ${BASE_SEASONS.join('+')} | Walk-forward: ${WALK_SEASONS.join('+')}`);
  console.log(`Filtros: sem blowout (≥7 runs), sem extra innings, contexto de ausentes`);
  console.log(`Kelly: ${KELLY_FRACTION * 100}% | Vig: ${HOUSE_MARGIN * 100}% | Min jogos mkt: ${MIN_GAMES_MKT} | Min jogos modelo: ${MIN_GAMES_MODEL}`);
  console.log('══════════════════════════════════════════');
  console.log(`Props totais       : ${predictions.length}`);
  console.log(`Acurácia           : ${(accuracy * 100).toFixed(1)}%`);
  console.log(`Brier Score (raw)  : ${brierScoreRaw.toFixed(4)}`);
  console.log(`Brier Score (cal)  : ${brierScoreCal.toFixed(4)}`);
  console.log('');
  console.log('Calibração por faixa (pós-calibração):');
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

  // ── Tabela de calibração formatada para copiar em model_mlb_props.js ─────────
  console.log('');
  console.log('══════════════════════════════════════════');
  console.log('TABELA DE CALIBRAÇÃO — copie em model_mlb_props.js:');
  console.log('══════════════════════════════════════════');
  console.log('const CALIB_TABLE = [');
  for (const row of calibTable) {
    console.log(`  { raw: ${row.x.toFixed(3)}, cal: ${row.y.toFixed(3)} },`);
  }
  console.log('];');

  fs.writeFileSync('mlb_props_backtest_results.json', JSON.stringify({
    version: 1,
    config: {
      baseSeasons: BASE_SEASONS,
      walkSeasons: WALK_SEASONS,
      kellyFraction: KELLY_FRACTION,
      houseMargin: HOUSE_MARGIN,
      minGamesMkt: MIN_GAMES_MKT,
      minGamesModel: MIN_GAMES_MODEL,
      decay: DECAY,
      filters: ['no_blowout_7runs', 'no_extra_innings', 'absent_starters_context'],
    },
    calibrationTable: calibTable,
    summary: {
      totalProps: predictions.length,
      skipped,
      filtroBlowout,
      filtroExtraInnings: filtroExtra,
      filtroAusentes,
      accuracy: parseFloat((accuracy * 100).toFixed(2)),
      brierScoreRaw: parseFloat(brierScoreRaw.toFixed(4)),
      brierScoreCal: parseFloat(brierScoreCal.toFixed(4)),
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

  console.log('\nmlb_props_backtest_results.json salvo.');
}

main();
