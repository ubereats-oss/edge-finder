const fs = require('fs');
const path = require('path');
const ledger = require('./model_ledger');
const calibration = require('./calibration');
const riskGuards = require('./risk_guards');
const riskConfig = require('./risk_config');

const ESPORTE = 'basketball/nba';
const RUN_ID = new Date().toISOString();
const MIN_EDGE_PCT = 10;

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

let injuriesToday = {};
if (fs.existsSync('nba_injuries_today.json')) {
  injuriesToday = readJsonSafe('nba_injuries_today.json', {});
} else {
  console.warn('nba_injuries_today.json não encontrado — filtro de ausentes desativado.');
}
const playerPositions = readJsonSafe('nba_player_positions.json', {});
const playerTeamMap   = readJsonSafe('nba_player_team.json', {});

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

function calcKelly(p, odd, stakeFraction = 1) {
  const b = odd - 1;
  const q = 1 - p;
  const kelly = (p * b - q) / b;
  return Math.max(0, parseFloat((kelly * KELLY_FRACTION * stakeFraction * 100).toFixed(2)));
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

// calcRecentAvg definida fora do loop — corrigido
function calcRecentAvg(playerData, statKey, n) {
  const entries = [];
  for (const [, seasonData] of Object.entries(playerData)) {
    for (const [, locs] of Object.entries(seasonData)) {
      for (const [, ctx] of Object.entries(locs)) {
        if (!ctx || !ctx[statKey] || !Array.isArray(ctx[statKey])) continue;
        for (const entry of ctx[statKey]) {
          if (entry.blowout) continue;
          const val = typeof entry === 'object' ? entry.value : entry;
          const date = entry.date || '';
          entries.push({ val, date });
        }
      }
    }
  }
  entries.sort((a, b) => b.date.localeCompare(a.date));
  const slice = entries.slice(0, n);
  if (!slice.length) return null;
  return parseFloat((slice.reduce((s, e) => s + e.val, 0) / slice.length).toFixed(1));
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
const MIN_15 = 0;

let descartadosSemStats = 0;
let descartadosSigmaBaixa = 0;
let descartadosJogoBloqueado = 0;
let comFiltroAusentes = 0;
const candidates = [];

for (const prop of props) {
  const commence = new Date(prop.commence_time).getTime();
  if (commence - NOW < MIN_15) { descartadosJogoBloqueado++; continue; }

  const playerData = findPlayer(prop.player);
  if (!playerData) { descartadosSemStats++; continue; }

  const isPlayerAbsent = Object.values(injuriesToday).some(players =>
    players.some(absent =>
      absent.toLowerCase().includes(prop.player.toLowerCase()) ||
      prop.player.toLowerCase().includes(absent.toLowerCase())
    )
  );
  if (isPlayerAbsent) { descartadosSemStats++; continue; }

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
  const marginRatio = Math.abs(prop.line - stats.avg) / stats.std;
  if (marginRatio < 0.5) continue;
  const lowMarginRatio = marginRatio < 0.75;
  if (stats.usedAbsentFilter) comFiltroAusentes++;

  const avg5  = calcRecentAvg(playerData, statKey, 5);
  const avg10 = calcRecentAvg(playerData, statKey, 10);

  const rawOver  = probOverRaw(stats.avg, stats.std, prop.line);
  const rawUnder = probUnderRaw(stats.avg, stats.std, prop.line);

  const impliedOver  = 1 / prop.oddsOver;
  const impliedUnder = 1 / prop.oddsUnder;

  const calibOver  = calibration.calibrate({ esporte: ESPORTE, market: prop.prop, rawProb: rawOver,  impliedProb: impliedOver });
  const calibUnder = calibration.calibrate({ esporte: ESPORTE, market: prop.prop, rawProb: rawUnder, impliedProb: impliedUnder });

  const edgeOver  = calibOver.calibratedProb  - impliedOver;
  const edgeUnder = calibUnder.calibratedProb - impliedUnder;

  const overIsBest  = edgeOver >= edgeUnder;
  const bestSide    = overIsBest ? 'Over' : 'Under';
  const bestCalib   = overIsBest ? calibOver : calibUnder;
  const bestRawProb = overIsBest ? rawOver : rawUnder;
  const bestOdds    = overIsBest ? prop.oddsOver : prop.oddsUnder;
  const bestEdge    = overIsBest ? edgeOver : edgeUnder;

  const edgePct           = parseFloat((bestEdge * 100).toFixed(2));
  const kellyCrit         = calcKelly(bestCalib.calibratedProb, bestOdds, bestCalib.stakeFraction);
  const inefficientMarket = !stats.lowSample && edgePct >= INEFFICIENT_MARKET_EDGE;

  const segmentDisabled = riskConfig.isSegmentDisabled(ESPORTE, prop.prop);
  const passedMinEdge   = edgePct >= MIN_EDGE_PCT;
  const edgeTooHigh     = edgePct > riskConfig.EDGE_CAP_PCT;

  let published = passedMinEdge && !segmentDisabled && !edgeTooHigh;
  let rejectionReason = null;
  if (!passedMinEdge) rejectionReason = ledger.REJECTION_REASONS.EDGE_ABAIXO_LIMIAR;
  else if (segmentDisabled) rejectionReason = ledger.REJECTION_REASONS.SEGMENTO_DESABILITADO;
  else if (edgeTooHigh) rejectionReason = ledger.REJECTION_REASONS.GUARDA_EDGE_MAXIMO;

  candidates.push({
    prop, stats, avg5, avg10, absentToday, lowMarginRatio, bestSide, bestOdds, bestEdge, edgePct, kellyCrit,
    bestRawProb, bestCalib, inefficientMarket, published, rejectionReason,
    game: prop.game, player: prop.player,
  });
}

riskGuards.applyGameGuards(candidates);

const results = [];
for (const c of candidates) {
  ledger.recordEvaluation({
    esporte: ESPORTE,
    eventId: c.prop.eventId ?? `${c.prop.game}|${c.prop.commence_time}`,
    game: c.prop.game,
    commenceTime: c.prop.commence_time,
    player: c.prop.player,
    market: c.prop.prop,
    line: c.prop.line,
    side: c.bestSide,
    modelProb: parseFloat((c.bestCalib.calibratedProb * 100).toFixed(1)),
    rawProb: parseFloat((c.bestRawProb * 100).toFixed(1)),
    odds: c.bestOdds,
    bookmaker: c.prop.bookmaker ?? null,
    edge: c.edgePct,
    kelly: c.kellyCrit,
    published: c.published,
    rejectionReason: c.rejectionReason,
    segmentState: c.bestCalib.segmentState,
    sampleSize: c.bestCalib.sampleSize,
    runId: RUN_ID,
  });

  if (!c.published) continue;
  results.push({
    game: c.prop.game,
    commence_time: c.prop.commence_time,
    player: c.prop.player,
    prop: c.prop.prop,
    location: c.prop.location,
    line: c.prop.line,
    playerAvg: c.stats.avg,
    playerStd: c.stats.std,
    playerAvg5: c.avg5,
    playerAvg10: c.avg10,
    playerTeam: playerTeamMap[c.prop.player] ?? null,
    side: c.bestSide,
    modelProb: parseFloat((c.bestCalib.calibratedProb * 100).toFixed(1)),
    rawProb: parseFloat((c.bestRawProb * 100).toFixed(1)),
    impliedProb: parseFloat(((1 / c.bestOdds) * 100).toFixed(1)),
    edge: c.edgePct,
    odds: c.bestOdds,
    oddsOver: c.prop.oddsOver,
    oddsUnder: c.prop.oddsUnder,
    kelly: c.kellyCrit,
    totalGames: c.stats.totalGames,
    contextGames: c.stats.contextGames,
    lowSample: c.stats.lowSample,
    inefficientMarket: c.inefficientMarket,
    segmentState: c.bestCalib.segmentState,
    sampleSize: c.bestCalib.sampleSize,
    lowMarginRatio: c.lowMarginRatio,
    absentFilter: c.stats.usedAbsentFilter,
    absentToday: c.absentToday.length > 0 ? classifyAbsents(c.absentToday, c.prop.player) : undefined,
    playerPosition: playerPositions[c.prop.player]?.position ?? null,
    formWarning: c.avg5 !== null && (c.bestSide === 'Over' ? c.avg5 < c.prop.line : c.avg5 > c.prop.line),
    pinnacleId: c.prop.pinnacleId ?? null,
    pinnacleSlug: c.prop.pinnacleSlug ?? null,
  });
}

const descartadosGuardas = candidates.filter(c => !c.published && c.rejectionReason && c.rejectionReason !== ledger.REJECTION_REASONS.EDGE_ABAIXO_LIMIAR).length;
console.log(`Props processadas: ${results.length} | Sem stats: ${descartadosSemStats} | Sigma baixo: ${descartadosSigmaBaixa} | Jogo bloqueado: ${descartadosJogoBloqueado} | Filtro ausentes: ${comFiltroAusentes} | Rejeitadas por guarda/segmento: ${descartadosGuardas}`);

const ledgerSummary = ledger.flush();
console.log(`Histórico de indicações (NBA BR): ${ledgerSummary.partitionsSaved} partição(ões) atualizada(s), ${ledgerSummary.duplicatesInRun} indicação(ões) duplicada(s) na mesma execução.`);

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
