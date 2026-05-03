const fs = require('fs');
const path = require('path');

function readJsonSafe(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  const raw = fs.readFileSync(file, 'utf-8').trim();
  if (!raw) return fallback;
  try { return JSON.parse(raw); } catch (e) {
    console.warn(`Aviso: ${file} inválido — usando fallback. ${e.message}`);
    return fallback;
  }
}

const playerStats   = readJsonSafe('mlb_player_stats.json', {});
const props         = readJsonSafe('mlb_props.json', []);
const playerTeamMap = readJsonSafe('mlb_player_team.json', {});
let injuriesToday   = readJsonSafe('mlb_injuries_today.json', {});
if (!Object.keys(injuriesToday).length) {
  console.warn('mlb_injuries_today.json não encontrado ou vazio — filtro de ausentes desativado.');
}

const SEASON_WEIGHT = { 2023: 1, 2024: 2, 2025: 3, 2026: 4 };
const MIN_GAMES_CONTEXT = 10;
const INEFFICIENT_MARKET_EDGE = 20;
const KELLY_FRACTION = 0.15;

// Calibração isotônica gerada por backtest_mlb_props.js
const CALIB_TABLE = [
  { raw: 0.500, cal: 0.517 },
  { raw: 0.550, cal: 0.537 },
  { raw: 0.600, cal: 0.589 },
  { raw: 0.650, cal: 0.604 },
  { raw: 0.700, cal: 0.643 },
  { raw: 0.750, cal: 0.680 },
  { raw: 0.800, cal: 0.721 },
  { raw: 0.850, cal: 0.772 },
  { raw: 0.900, cal: 0.816 },
  { raw: 0.950, cal: 0.849 },
  { raw: 1.000, cal: 0.892 },
];

function calibrate(p) {
  if (p < 0.5) return 1 - calibrate(1 - p);
  const n = CALIB_TABLE.length;
  if (p <= CALIB_TABLE[0].raw) {
    const slope = (CALIB_TABLE[1].cal - CALIB_TABLE[0].cal) / (CALIB_TABLE[1].raw - CALIB_TABLE[0].raw);
    return Math.min(1, Math.max(0, CALIB_TABLE[0].cal + slope * (p - CALIB_TABLE[0].raw)));
  }
  if (p >= CALIB_TABLE[n - 1].raw) {
    const slope = (CALIB_TABLE[n - 1].cal - CALIB_TABLE[n - 2].cal) / (CALIB_TABLE[n - 1].raw - CALIB_TABLE[n - 2].raw);
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

function probOverRaw(mu, sigma, line) { return 1 - normalCDF(line, mu, sigma); }
function probUnderRaw(mu, sigma, line) { return normalCDF(line, mu, sigma); }

function calcKelly(p, odd) {
  const b = odd - 1;
  const q = 1 - p;
  const kelly = (p * b - q) / b;
  return Math.max(0, parseFloat((kelly * KELLY_FRACTION * 100).toFixed(2)));
}

function findPlayer(name) {
  if (playerStats[name]) return playerStats[name];
  const lower = name.toLowerCase();
  for (const key of Object.keys(playerStats)) {
    if (key.toLowerCase().includes(lower) || lower.includes(key.toLowerCase())) return playerStats[key];
  }
  return null;
}

function getAbsentToday(teamName) {
  if (!teamName || teamName === 'unknown') return [];
  for (const [key, players] of Object.entries(injuriesToday)) {
    if (key === teamName || key.includes(teamName) || teamName.includes(key)) return players;
  }
  return [];
}

function matchesAbsentContext(entryAbsentStarters, absentToday) {
  if (absentToday.length === 0) return false;
  return absentToday.some(absent =>
    entryAbsentStarters.some(h =>
      h.toLowerCase().includes(absent.toLowerCase()) ||
      absent.toLowerCase().includes(h.toLowerCase())
    )
  );
}

function calcRecentAvg(playerData, statKey, n) {
  const entries = [];
  for (const seasonData of Object.values(playerData)) {
    for (const gameTypeData of Object.values(seasonData)) {
      for (const loc of ['home', 'away']) {
        const ctx = gameTypeData[loc];
        if (!ctx || !ctx[statKey] || !Array.isArray(ctx[statKey])) continue;
        for (const entry of ctx[statKey]) {
          const val  = typeof entry === 'object' ? entry.value : entry;
          const date = typeof entry === 'object' ? (entry.date || '') : '';
          entries.push({ val, date });
        }
      }
    }
  }
  entries.sort((a, b) => b.date.localeCompare(a.date));
  const slice = entries.slice(0, n);
  if (!slice.length) return null;
  return parseFloat((slice.reduce((s, e) => s + e.val, 0) / slice.length).toFixed(2));
}

function combineContexts(playerData, statKey, locations, absentToday) {
  let weightedSum = 0, weightedSumSq = 0, totalWeight = 0, totalGames = 0, contextGames = 0;
  let usedAbsentFilter = false;

  if (absentToday.length > 0) {
    let fSum = 0, fSumSq = 0, fWeight = 0, fGames = 0, fContext = 0;
    for (const [seasonStr, seasonData] of Object.entries(playerData)) {
      const season = parseInt(seasonStr);
      const w = SEASON_WEIGHT[season] || 1;
      for (const loc of locations) {
        const ctx = seasonData?.regular?.[loc];
        if (!ctx || !ctx[statKey] || !Array.isArray(ctx[statKey])) continue;
        for (const entry of ctx[statKey]) {
          if (entry.blowout) continue;
          if (!matchesAbsentContext(entry.absentStarters || [], absentToday)) continue;
          fSum += entry.value * w; fSumSq += entry.value * entry.value * w;
          fWeight += w; fGames++;
          if (season === 2026) fContext++;
        }
      }
    }
    if (fGames >= 5) {
      weightedSum = fSum; weightedSumSq = fSumSq;
      totalWeight = fWeight; totalGames = fGames; contextGames = fContext;
      usedAbsentFilter = true;
    }
  }

  if (!usedAbsentFilter) {
    for (const [seasonStr, seasonData] of Object.entries(playerData)) {
      const season = parseInt(seasonStr);
      const w = SEASON_WEIGHT[season] || 1;
      for (const loc of locations) {
        const ctx = seasonData?.regular?.[loc];
        if (!ctx || !ctx[statKey] || !Array.isArray(ctx[statKey])) continue;
        for (const entry of ctx[statKey]) {
          if (entry.blowout) continue;
          const value = typeof entry === 'object' ? entry.value : entry;
          weightedSum += value * w; weightedSumSq += value * value * w;
          totalWeight += w; totalGames++;
          if (season === 2026) contextGames++;
        }
      }
    }
  }

  if (totalWeight === 0) return null;
  const avg = weightedSum / totalWeight;
  const variance = Math.max(0, weightedSumSq / totalWeight - avg * avg);
  return {
    avg: parseFloat(avg.toFixed(3)),
    std: parseFloat(Math.sqrt(variance).toFixed(3)),
    totalGames, contextGames,
    lowSample: contextGames < MIN_GAMES_CONTEXT,
    usedAbsentFilter,
  };
}

const PROP_CONFIG = {
  hits:        { key: 'hits' },
  // homeRuns desativado — ROI de 0.4% em 10.5k bets no backtest (inviável)
  strikeouts:  { key: 'strikeouts' },
  hitsAllowed: { key: 'hitsAllowed' },
};

if (!props.length) { console.log('mlb_props.json vazio — sem props disponíveis.'); process.exit(0); }
if (Object.keys(playerStats).length === 0) {
  console.error('mlb_player_stats.json vazio ou ausente — rode get_mlb_player_stats.js primeiro.');
  process.exit(1);
}

const NOW = Date.now();
const MIN_15 = 0;
let descartadosSemStats = 0, descartadosSigmaBaixa = 0, descartadosJogoBloqueado = 0, comFiltroAusentes = 0;
const results = [];

for (const prop of props) {
  const commence = new Date(prop.commence_time).getTime();
  if (commence - NOW < MIN_15) { descartadosJogoBloqueado++; continue; }

  const config = PROP_CONFIG[prop.prop];
  if (!config) continue;

  const playerData = findPlayer(prop.player);
  if (!playerData) { descartadosSemStats++; continue; }

  const isPlayerAbsent = Object.values(injuriesToday).some(players =>
    players.some(absent =>
      absent.toLowerCase().includes(prop.player.toLowerCase()) ||
      prop.player.toLowerCase().includes(absent.toLowerCase())
    )
  );
  if (isPlayerAbsent) { descartadosSemStats++; continue; }

  const locations = prop.location === 'home' || prop.location === 'away'
    ? [prop.location] : ['home', 'away'];

  const gameParts = prop.game ? prop.game.split(' x ') : [];
  let teamName = 'unknown';
  if (prop.location === 'home' && gameParts.length >= 1) teamName = gameParts[0];
  else if (prop.location === 'away' && gameParts.length >= 2) teamName = gameParts[1];

  const absentToday = getAbsentToday(teamName);
  const avg5  = calcRecentAvg(playerData, config.key, 5);
  const avg10 = calcRecentAvg(playerData, config.key, 10);

  const stats = combineContexts(playerData, config.key, locations, absentToday);
  if (!stats) { descartadosSemStats++; continue; }
  if (stats.std < 0.1) { descartadosSigmaBaixa++; continue; }

  const marginRatio = Math.abs(prop.line - stats.avg) / stats.std;
  if (marginRatio < 0.75) continue;

  if (stats.usedAbsentFilter) comFiltroAusentes++;

  const pOver  = calibrate(probOverRaw(stats.avg, stats.std, prop.line));
  const pUnder = calibrate(probUnderRaw(stats.avg, stats.std, prop.line));

  const impliedOver  = 1 / prop.oddsOver;
  const impliedUnder = 1 / prop.oddsUnder;
  const edgeOver  = pOver  - impliedOver;
  const edgeUnder = pUnder - impliedUnder;

  const bestSide = edgeOver >= edgeUnder ? 'Over' : 'Under';
  const bestProb = edgeOver >= edgeUnder ? pOver : pUnder;
  const bestOdds = edgeOver >= edgeUnder ? prop.oddsOver : prop.oddsUnder;
  const bestEdge = edgeOver >= edgeUnder ? edgeOver : edgeUnder;

  const edgePct           = parseFloat((bestEdge * 100).toFixed(2));
  const kellyCrit         = calcKelly(bestProb, bestOdds);
  const inefficientMarket = !stats.lowSample && edgePct >= INEFFICIENT_MARKET_EDGE;

  if (edgePct < 15) { continue; }
  results.push({
    game: prop.game,
    commence_time: prop.commence_time,
    player: prop.player,
    prop: prop.prop,
    isPitcher: prop.isPitcher,
    location: prop.location,
    line: prop.line,
    playerAvg: stats.avg,
    playerStd: stats.std,
    playerAvg5: avg5,
    playerAvg10: avg10,
    playerTeam: playerTeamMap[prop.player] ?? null,
    side: bestSide,
    modelProb: parseFloat((bestProb * 100).toFixed(1)),
    impliedProb: parseFloat(((1 / bestOdds) * 100).toFixed(1)),
    edge: edgePct,
    odds: bestOdds,
    oddsOver: prop.oddsOver,
    oddsUnder: prop.oddsUnder,
    kelly: kellyCrit,
    totalGames: stats.totalGames,
    contextGames: stats.contextGames,
    lowSample: stats.lowSample,
    inefficientMarket,
    absentFilter: stats.usedAbsentFilter,
    absentToday: absentToday.length > 0 ? absentToday : undefined,
    pinnacleId: prop.pinnacleId ?? null,
    pinnacleSlug: prop.pinnacleSlug ?? null,
  });
}

console.log(`Props processadas: ${results.length} | Sem stats: ${descartadosSemStats} | Sigma baixo: ${descartadosSigmaBaixa} | Jogo bloqueado: ${descartadosJogoBloqueado} | Filtro ausentes: ${comFiltroAusentes}`);

results.sort((a, b) => b.edge - a.edge);

results.slice(0, 15).forEach((r, i) => {
  const warn   = r.lowSample         ? ' ⚠️' : '';
  const target = r.inefficientMarket ? ' 🎯' : '';
  const loc    = r.location !== 'unknown' ? ` [${r.location}]` : '';
  const absent = r.absentFilter      ? ' 🔄' : '';
  console.log(`[${i + 1}] ${r.player}${warn}${target}${loc}${absent} | ${r.prop} ${r.side} ${r.line} | Edge: ${r.edge}% | Kelly: ${r.kelly}%`);
});

fs.writeFileSync('mlb_props_results.json', JSON.stringify(results, null, 2));
console.log('mlb_props_results.json salvo.');

const HISTORY_DIR = path.join(__dirname, '..', 'odds_history');
if (!fs.existsSync(HISTORY_DIR)) fs.mkdirSync(HISTORY_DIR, { recursive: true });
const today = new Date().toISOString().slice(0, 10);
const month = new Date().toISOString().slice(0, 7);
const modelHistFile = path.join(HISTORY_DIR, `baseball_mlb_model_${month}.json`);
const modelHist = readJsonSafe(modelHistFile, []);
const existing = new Set(modelHist.map(e => e._key));
let added = 0;
for (const r of results) {
  const key = `${r.game}|${r.player}|${r.prop}|${r.side}|${today}`;
  if (existing.has(key)) continue;
  modelHist.push({ _key: key, savedDate: today, savedAt: new Date().toISOString(), ...r });
  existing.add(key);
  added++;
}
fs.writeFileSync(modelHistFile, JSON.stringify(modelHist, null, 2));
console.log(`Histórico do modelo salvo: +${added} entradas.`);
