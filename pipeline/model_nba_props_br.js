const fs = require('fs');
const path = require('path');

// Leitura segura — não crasha se arquivo ausente ou vazio
function readJsonSafe(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  const raw = fs.readFileSync(file, 'utf-8').trim();
  if (!raw) return fallback;
  try { return JSON.parse(raw); } catch (e) {
    console.warn(`Aviso: ${file} inválido — usando fallback. ${e.message}`);
    return fallback;
  }
}

const playerStats = readJsonSafe('nba_player_stats.json', {});
const props = readJsonSafe('nba_props_pinnacle.json', []);

const SEASON_WEIGHT = { 2024: 1, 2025: 2, 2026: 3 };
const MIN_GAMES_CONTEXT = 10;
const INEFFICIENT_MARKET_EDGE = 20;
const KELLY_FRACTION = 0.25;

// Carrega ausentes do dia (gerado por get_nba_injuries.js)
let injuriesToday = {};
if (fs.existsSync('nba_injuries_today.json')) {
  injuriesToday = readJsonSafe('nba_injuries_today.json', {});
} else {
  console.warn('nba_injuries_today.json não encontrado — filtro de ausentes desativado.');
}
const playerPositions = readJsonSafe('nba_player_positions.json', {});

function getPlayerGroup(playerName) {
  if (!playerName) return 'unknown';
  const direct = playerPositions[playerName];
  if (direct) return direct.group;
  const lower = playerName.toLowerCase();
  for (const [key, val] of Object.entries(playerPositions)) {
    if (key.toLowerCase().includes(lower) || lower.includes(key.toLowerCase())) {
      return val.group;
    }
  }
  return 'unknown';
}

function classifyAbsents(absentToday, playerName) {
  const playerGroup = getPlayerGroup(playerName);
  return absentToday.map(absent => {
    const absentGroup = getPlayerGroup(absent);
    let impact = 'indireto';
    if (playerGroup !== 'unknown' && absentGroup !== 'unknown' && playerGroup === absentGroup) {
      impact = 'direto';
    }
    return { name: absent, position: playerPositions[absent]?.position ?? null, group: absentGroup, impact };
  });
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

function getAbsentToday(teamName) {
  if (!teamName || teamName === 'unknown') return [];
  for (const [key, players] of Object.entries(injuriesToday)) {
    if (key === teamName || key.includes(teamName) || teamName.includes(key)) {
      return players;
    }
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

function combineContexts(playerData, statKey, locations, gameTypes, absentToday) {
  let weightedSum = 0;
  let weightedSumSq = 0;
  let totalWeight = 0;
  let totalGames = 0;
  let contextGames = 0;

  const hasAbsentContext = absentToday.length > 0;
  let usedAbsentFilter = false;

  if (hasAbsentContext) {
    let filteredSum = 0, filteredSumSq = 0, filteredWeight = 0, filteredGames = 0, filteredContext = 0;

    for (const [seasonStr, seasonData] of Object.entries(playerData)) {
      const season = parseInt(seasonStr);
      const w = SEASON_WEIGHT[season] || 1;

      for (const gameType of gameTypes) {
        for (const location of locations) {
          const ctx = seasonData?.[gameType]?.[location];
          if (!ctx || !ctx[statKey] || !Array.isArray(ctx[statKey])) continue;

          for (const entry of ctx[statKey]) {
            if (entry.blowout) continue;
            if (!matchesAbsentContext(entry.absentStarters || [], absentToday)) continue;

            filteredSum += entry.value * w;
            filteredSumSq += entry.value * entry.value * w;
            filteredWeight += w;
            filteredGames++;
            if (season === 2026) filteredContext++;
          }
        }
      }
    }

    if (filteredGames >= 5) {
      weightedSum = filteredSum;
      weightedSumSq = filteredSumSq;
      totalWeight = filteredWeight;
      totalGames = filteredGames;
      contextGames = filteredContext;
      usedAbsentFilter = true;
    }
  }

  if (!usedAbsentFilter) {
    for (const [seasonStr, seasonData] of Object.entries(playerData)) {
      const season = parseInt(seasonStr);
      const w = SEASON_WEIGHT[season] || 1;

      for (const gameType of gameTypes) {
        for (const location of locations) {
          const ctx = seasonData?.[gameType]?.[location];
          if (!ctx || !ctx[statKey] || !Array.isArray(ctx[statKey])) continue;

          for (const entry of ctx[statKey]) {
            if (entry.blowout) continue;

            const value = typeof entry === 'object' ? entry.value : entry;
            weightedSum += value * w;
            weightedSumSq += value * value * w;
            totalWeight += w;
            totalGames++;
            if (season === 2026) contextGames++;
          }
        }
      }
    }
  }

  if (totalWeight === 0) return null;

  const avg = weightedSum / totalWeight;
  const variance = Math.max(0, weightedSumSq / totalWeight - avg * avg);

  return {
    avg: parseFloat(avg.toFixed(2)),
    std: parseFloat(Math.sqrt(variance).toFixed(2)),
    totalGames,
    contextGames,
    lowSample: contextGames < MIN_GAMES_CONTEXT,
    usedAbsentFilter,
  };
}

function findPlayer(name) {
  if (playerStats[name]) return playerStats[name];
  const lower = name.toLowerCase();
  for (const key of Object.keys(playerStats)) {
    if (key.toLowerCase().includes(lower) || lower.includes(key.toLowerCase())) {
      return playerStats[key];
    }
  }
  return null;
}

const PROP_MAP = {
  points: 'points',
  rebounds: 'rebounds',
  assists: 'assists',
  steals: 'steals',
  threes: 'threes',
  fouls: 'fouls',
};

if (!props.length) {
  console.log('nba_props_pinnacle.json vazio — rode get_nba_props_br.js primeiro.');
  process.exit(0);
}

if (Object.keys(playerStats).length === 0) {
  console.error('nba_player_stats.json vazio ou ausente — rode get_nba_player_stats.js primeiro.');
  process.exit(1);
}

const NOW = Date.now();
const MIN_15 = 0; // sem filtro temporal — o Flutter filtra em tempo real

let descartadosSemStats = 0;
let descartadosSigmaBaixa = 0;
let descartadosJogoBloqueado = 0;
let comFiltroAusentes = 0;
const results = [];

for (const prop of props) {
  const commence = new Date(prop.commence_time).getTime();
  if (commence - NOW < MIN_15) { descartadosJogoBloqueado++; continue; }

  const playerData = findPlayer(prop.player);
  if (!playerData) { descartadosSemStats++; continue; }

  const statKey = PROP_MAP[prop.prop];
  if (!statKey) continue;

  const locations = prop.location === 'home' || prop.location === 'away'
    ? [prop.location]
    : ['home', 'away'];

  const gameParts = prop.game ? prop.game.split(' x ') : [];
  let teamName = 'unknown';
  if (prop.location === 'home' && gameParts.length >= 1) teamName = gameParts[0];
  else if (prop.location === 'away' && gameParts.length >= 2) teamName = gameParts[1];

  const absentToday = getAbsentToday(teamName);

  const stats = combineContexts(playerData, statKey, locations, ['regular'], absentToday);
  if (!stats) { descartadosSemStats++; continue; }
  if (stats.std < 0.3) { descartadosSigmaBaixa++; continue; }
  // Descarta quando a diferença entre média e linha é menor que 0.75 desvios padrão
  const marginRatio = Math.abs(prop.line - stats.avg) / stats.std;
  if (marginRatio < 0.75) continue;
  if (stats.usedAbsentFilter) comFiltroAusentes++;

  const pOverRaw  = probOverRaw(stats.avg, stats.std, prop.line);
  const pUnderRaw = probUnderRaw(stats.avg, stats.std, prop.line);

  const pOver  = calibrate(pOverRaw);
  const pUnder = calibrate(pUnderRaw);

  const impliedOver  = 1 / prop.oddsOver;
  const impliedUnder = 1 / prop.oddsUnder;

  const edgeOver  = pOver  - impliedOver;
  const edgeUnder = pUnder - impliedUnder;

  const bestSide  = edgeOver >= edgeUnder ? 'Over' : 'Under';
  const bestEdge  = edgeOver >= edgeUnder ? edgeOver : edgeUnder;
  const bestProb  = edgeOver >= edgeUnder ? pOver : pUnder;
  const bestOdds  = edgeOver >= edgeUnder ? prop.oddsOver : prop.oddsUnder;

  const edgePct           = parseFloat((bestEdge * 100).toFixed(2));
  const kellyCrit         = calcKelly(bestProb, bestOdds);
  const inefficientMarket = !stats.lowSample && edgePct >= INEFFICIENT_MARKET_EDGE;

  results.push({
    game: prop.game,
    commence_time: prop.commence_time,
    player: prop.player,
    prop: prop.prop,
    location: prop.location,
    line: prop.line,
    playerAvg: stats.avg,
    playerStd: stats.std,
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
    absentToday: absentToday.length > 0 ? classifyAbsents(absentToday, prop.player) : undefined,
    playerPosition: playerPositions[prop.player]?.position ?? null,
  });
}

console.log(`Props processadas: ${results.length} | Sem stats: ${descartadosSemStats} | Sigma baixo: ${descartadosSigmaBaixa} | Jogo bloqueado: ${descartadosJogoBloqueado} | Filtro ausentes: ${comFiltroAusentes}`);

results.sort((a, b) => b.edge - a.edge);

results.slice(0, 15).forEach((r, i) => {
  const warn   = r.lowSample         ? ' ⚠️' : '';
  const target = r.inefficientMarket ? ' 🎯' : '';
  const loc    = r.location !== 'unknown' ? ` [${r.location}]` : '';
  const absent = r.absentFilter      ? ' 🔄' : '';
  console.log(
    `[${i + 1}] ${r.player}${warn}${target}${loc}${absent} | ${r.prop} ${r.side} ${r.line} | Edge: ${r.edge}% | Kelly: ${r.kelly}%`
  );
});

fs.writeFileSync('nba_props_br_results.json', JSON.stringify(results, null, 2));
console.log('nba_props_br_results.json salvo.');

// ── Salva no histórico de modelos ──────────────────────────────────────────────
const HISTORY_DIR = path.join(__dirname, '..', 'odds_history');
if (!fs.existsSync(HISTORY_DIR)) fs.mkdirSync(HISTORY_DIR, { recursive: true });
const today = new Date().toISOString().slice(0, 10);
const month = new Date().toISOString().slice(0, 7);
const modelHistFile = path.join(HISTORY_DIR, `basketball_nba_model_br_${month}.json`);
const modelHist = fs.existsSync(modelHistFile)
  ? readJsonSafe(modelHistFile, [])
  : [];
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
