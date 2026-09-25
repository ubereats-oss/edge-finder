const fs = require('fs');
const path = require('path');
const ledger = require('./model_ledger');
const calibration = require('./calibration');
const riskGuards = require('./risk_guards');
const riskConfig = require('./risk_config');

const ESPORTE = 'americanfootball/nfl';
const RUN_ID = new Date().toISOString();

function readJsonSafe(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  const raw = fs.readFileSync(file, 'utf-8').trim();
  if (!raw) return fallback;
  try { return JSON.parse(raw); } catch (e) {
    console.warn(`Aviso: ${file} inválido. ${e.message}`);
    return fallback;
  }
}

const playerStats   = readJsonSafe('nfl_player_stats.json', {});
const props         = readJsonSafe('nfl_props.json', []);
const playerTeamMap = readJsonSafe('nfl_player_team.json', {});

const SEASON_WEIGHT = { 2024: 1, 2025: 2, 2026: 3 };
const MIN_GAMES_CONTEXT = 6;
const INEFFICIENT_MARKET_EDGE = 20;
const KELLY_FRACTION = riskConfig.KELLY_FRACTION;

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

// ─── passTDs: distribuição de contagem (Poisson) ───────────────────────────
// TDs de passe por jogo é uma contagem discreta e baixa (tipicamente 0-3);
// desvio-padrão histórico abaixo de 1 é o normal pra esse tipo de estatística,
// não sinal de dado ruim como seria numa distribuição contínua de jardas.
// Por isso só este mercado usa Poisson(lambda = média histórica) em vez do
// guard de sigma + CDF normal aplicados aos demais mercados de NFL.
function poissonPMF(k, lambda) {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  let logP = -lambda + k * Math.log(lambda);
  for (let i = 2; i <= k; i++) logP -= Math.log(i);
  return Math.exp(logP);
}

function poissonCDF(k, lambda) {
  let sum = 0;
  for (let i = 0; i <= k; i++) sum += poissonPMF(i, lambda);
  return Math.min(1, sum);
}

// Linha de passTDs é sempre .5 (evita push) — "Under" cobre X <= floor(line).
function probOverPoisson(lambda, line) { return 1 - poissonCDF(Math.floor(line), lambda); }
function probUnderPoisson(lambda, line) { return poissonCDF(Math.floor(line), lambda); }

function calcKelly(p, odd, stakeFraction = 1) {
  const b = odd - 1;
  const q = 1 - p;
  const kelly = (p * b - q) / b;
  return Math.max(0, parseFloat((kelly * KELLY_FRACTION * stakeFraction * 100).toFixed(2)));
}

function findPlayer(name) {
  if (playerStats[name]) return playerStats[name];
  const lower = name.toLowerCase();
  for (const key of Object.keys(playerStats)) {
    if (key.toLowerCase().includes(lower) || lower.includes(key.toLowerCase())) return playerStats[key];
  }
  return null;
}

function calcRecentAvg(playerData, statKey, n) {
  const entries = [];
  for (const seasonData of Object.values(playerData)) {
    for (const gameTypeData of Object.values(seasonData)) {
      for (const loc of ['home', 'away']) {
        const ctx = gameTypeData[loc];
        if (!ctx || !ctx[statKey] || !Array.isArray(ctx[statKey])) continue;
        for (const entry of ctx[statKey]) {
          if (entry.blowout) continue;
          entries.push({ val: entry.value ?? 0, date: entry.date || '' });
        }
      }
    }
  }
  entries.sort((a, b) => b.date.localeCompare(a.date));
  const slice = entries.slice(0, n);
  if (!slice.length) return null;
  return parseFloat((slice.reduce((s, e) => s + e.val, 0) / slice.length).toFixed(1));
}

function combineContexts(playerData, statKey, locations) {
  let weightedSum = 0, weightedSumSq = 0, totalWeight = 0, totalGames = 0, contextGames = 0;

  for (const [seasonStr, seasonData] of Object.entries(playerData)) {
    const season = parseInt(seasonStr);
    const w = SEASON_WEIGHT[season] || 1;
    for (const loc of locations) {
      const ctx = seasonData?.regular?.[loc];
      if (!ctx || !ctx[statKey] || !Array.isArray(ctx[statKey])) continue;
      for (const entry of ctx[statKey]) {
        if (entry.blowout) continue;
        const value = entry.value ?? 0;
        weightedSum    += value * w;
        weightedSumSq  += value * value * w;
        totalWeight    += w;
        totalGames++;
        if (season === 2026) contextGames++;
      }
    }
  }

  if (totalWeight === 0) return null;
  const avg = weightedSum / totalWeight;
  const variance = Math.max(0, weightedSumSq / totalWeight - avg * avg);
  return {
    avg: parseFloat(avg.toFixed(1)),
    std: parseFloat(Math.sqrt(variance).toFixed(1)),
    totalGames, contextGames,
    lowSample: contextGames < MIN_GAMES_CONTEXT,
  };
}

const PROP_MAP = {
  passYards:      'passYards',
  passTDs:        'passTDs',
  rushYards:      'rushYards',
  receptions:     'receptions',
  receptionYards: 'receptionYards',
};

if (!props.length) { console.log('nfl_props.json vazio.'); process.exit(0); }
if (Object.keys(playerStats).length === 0) {
  console.error('nfl_player_stats.json ausente.');
  process.exit(1);
}

const NOW = Date.now();
let descartadosSemStats = 0, descartadosSigmaBaixa = 0, descartadosJogoBloqueado = 0;
let descartadosPassTDsMediaZero = 0;
let descartadosMarginRatio = 0;
const descartadosMercadoForaCobertura = {};
const candidates = [];

const DISCARD_REASONS = {
  SEM_STATS_JOGADOR: 'sem_stats_jogador',
  SEM_STATS_CONTEXTO: 'sem_stats_contexto',
  SIGMA_BAIXO: 'sigma_baixo',
};

function pctOrNull(value) {
  return typeof value === 'number' ? parseFloat((value * 100).toFixed(1)) : null;
}

function dataDiscardCandidate(prop, stats, reason) {
  return {
    prop,
    stats: stats ?? { avg: null, std: null, totalGames: null, contextGames: null, lowSample: null },
    avg5: null,
    avg10: null,
    bestSide: 'n/a',
    bestOdds: null,
    bestEdge: null,
    edgePct: null,
    kellyCrit: null,
    bestRawProb: null,
    bestCalib: { calibratedProb: null, segmentState: null, sampleSize: null, stakeFraction: null },
    inefficientMarket: false,
    published: false,
    rejectionReason: reason,
    game: prop.game,
    player: prop.player,
    hasModelProb: false,
    validForCalibration: false,
    invalidReason: reason,
    resolutionStatus: ledger.RESOLUTION_STATUS.NAO_APURAVEL,
  };
}

for (const prop of props) {
  const commence = new Date(prop.commence_time).getTime();
  if (commence - NOW < 0) { descartadosJogoBloqueado++; continue; }

  const statKey = PROP_MAP[prop.prop];
  if (!statKey) {
    descartadosMercadoForaCobertura[prop.prop] = (descartadosMercadoForaCobertura[prop.prop] || 0) + 1;
    continue;
  }

  const playerData = findPlayer(prop.player);
  if (!playerData) {
    descartadosSemStats++;
    candidates.push(dataDiscardCandidate(prop, null, DISCARD_REASONS.SEM_STATS_JOGADOR));
    continue;
  }

  const locations = prop.location === 'home' || prop.location === 'away'
    ? [prop.location] : ['home', 'away'];

  const stats = combineContexts(playerData, statKey, locations);
  if (!stats) {
    descartadosSemStats++;
    candidates.push(dataDiscardCandidate(prop, null, DISCARD_REASONS.SEM_STATS_CONTEXTO));
    continue;
  }

  const isPassTDs = prop.prop === 'passTDs';

  if (isPassTDs) {
    // Sem guard de sigma aqui (ver comentário no topo do arquivo) — só
    // descarta se não há nenhum sinal histórico de TD pra montar Poisson
    // (lambda <= 0 é degenerado: modelo sempre daria 100% em "Under").
    // Diferente dos outros descartes de qualidade de dado, este é logado
    // no histórico central (published:false + rejectionReason), a pedido —
    // antes esse tipo de descarte era silencioso pra todos os mercados.
    if (stats.avg <= 0) {
      descartadosPassTDsMediaZero++;
      candidates.push({
        prop, stats, avg5: null, avg10: null,
        bestSide: 'Over', bestOdds: prop.oddsOver, bestEdge: null, edgePct: null,
        kellyCrit: null, bestRawProb: null,
        bestCalib: { calibratedProb: null, segmentState: null, sampleSize: null, stakeFraction: null },
        inefficientMarket: false, published: false,
        rejectionReason: 'passtds_media_historica_zero',
        game: prop.game, player: prop.player,
      });
      continue;
    }
  } else if (stats.std < 1) {
    descartadosSigmaBaixa++;
    candidates.push(dataDiscardCandidate(prop, stats, DISCARD_REASONS.SIGMA_BAIXO));
    continue;
  }

  // Linha muito perto da média histórica do jogador (relativa ao desvio-padrão)
  // — modelo não tem sinal suficiente pra diferenciar de um chute aleatório.
  // Mesmo padrão de rastreabilidade do guard de passTDs: antes descartava
  // silenciosamente (nem published, nem rejectionReason); agora fica visível
  // no histórico central. Lógica do filtro em si (limiar 0.4) não mudou.
  const marginRatio = Math.abs(prop.line - stats.avg) / stats.std;
  if (marginRatio < 0.4) {
    descartadosMarginRatio++;
    candidates.push({
      prop, stats, avg5: null, avg10: null,
      bestSide: 'Over', bestOdds: prop.oddsOver, bestEdge: null, edgePct: null,
      kellyCrit: null, bestRawProb: null,
      bestCalib: { calibratedProb: null, segmentState: null, sampleSize: null, stakeFraction: null },
      inefficientMarket: false, published: false,
      rejectionReason: 'margem_insuficiente',
      game: prop.game, player: prop.player,
    });
    continue;
  }

  const avg5  = calcRecentAvg(playerData, statKey, 5);
  const avg10 = calcRecentAvg(playerData, statKey, 10);

  const rawOver  = isPassTDs ? probOverPoisson(stats.avg, prop.line)        : probOverRaw(stats.avg, stats.std, prop.line);
  const rawUnder = isPassTDs ? probUnderPoisson(stats.avg, prop.line)       : probUnderRaw(stats.avg, stats.std, prop.line);

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
  const passedMinEdge   = edgePct >= riskConfig.MIN_EDGE_PCT;
  const edgeTooHigh     = edgePct > riskConfig.EDGE_CAP_PCT;

  let published = passedMinEdge && !segmentDisabled && !edgeTooHigh;
  let rejectionReason = null;
  if (segmentDisabled) rejectionReason = ledger.REJECTION_REASONS.SEGMENTO_DESABILITADO;
  else if (!passedMinEdge) rejectionReason = ledger.REJECTION_REASONS.EDGE_ABAIXO_LIMIAR;
  else if (edgeTooHigh) rejectionReason = ledger.REJECTION_REASONS.GUARDA_EDGE_MAXIMO;

  candidates.push({
    prop, stats, avg5, avg10, bestSide, bestOdds, bestEdge, edgePct, kellyCrit,
    bestRawProb, bestCalib, inefficientMarket, published, rejectionReason,
    game: prop.game, player: prop.player,
  });
}

riskGuards.applyGameGuards(candidates);

const results = [];
for (const c of candidates) {
  const hasModelProb = c.hasModelProb ?? c.edgePct !== null;
  ledger.recordEvaluation({
    esporte: ESPORTE,
    eventId: c.prop.eventId ?? `${c.prop.game}|${c.prop.commence_time}`,
    game: c.prop.game,
    commenceTime: c.prop.commence_time,
    player: c.prop.player,
    playerTeam: playerTeamMap[c.prop.player] ?? null,
    market: c.prop.prop,
    line: c.prop.line,
    side: c.bestSide,
    modelProb: pctOrNull(c.bestCalib.calibratedProb),
    rawProb: pctOrNull(c.bestRawProb),
    odds: c.bestOdds,
    bookmaker: c.bestSide === 'Over' ? (c.prop.bookmakerOver ?? null) : (c.prop.bookmakerUnder ?? null),
    edge: c.edgePct,
    kelly: c.kellyCrit,
    published: c.published,
    rejectionReason: c.rejectionReason,
    segmentState: c.bestCalib.segmentState,
    sampleSize: c.bestCalib.sampleSize,
    hasModelProb,
    validForCalibration: c.validForCalibration ?? hasModelProb,
    invalidReason: c.invalidReason ?? (hasModelProb ? null : c.rejectionReason),
    resolutionStatus: c.resolutionStatus ?? (hasModelProb ? undefined : ledger.RESOLUTION_STATUS.NAO_APURAVEL),
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
  });
}

// Dois grupos: descartado ANTES de calcular probabilidade/edge (dado
// insuficiente pra avaliar) vs avaliado (edgePct calculado) e rejeitado
// depois — por edge abaixo do limiar ou por guarda de risco. Antes esse
// segundo contador somava os dois grupos junto, distorcendo quantas
// indicações o modelo de fato avaliou e recusou por falta de edge.
const descartadosAntesDeAvaliar = descartadosSemStats + descartadosSigmaBaixa + descartadosPassTDsMediaZero + descartadosMarginRatio;
const avaliadosRejeitados = candidates.filter(c => !c.published && c.edgePct !== null).length;
console.log(`Props NFL: ${results.length} | Descartado antes de avaliar: ${descartadosAntesDeAvaliar} (sem stats: ${descartadosSemStats}, sigma baixo: ${descartadosSigmaBaixa}, passTDs média zero: ${descartadosPassTDsMediaZero}, margem insuficiente: ${descartadosMarginRatio}) | Bloqueado: ${descartadosJogoBloqueado} | Avaliado e rejeitado: ${avaliadosRejeitados}`);
console.log(`Mercados fora da cobertura (NFL): ${JSON.stringify(descartadosMercadoForaCobertura)}`);

const ledgerSummary = ledger.flush();
console.log(`Histórico de indicações (NFL): ${ledgerSummary.partitionsSaved} partição(ões) atualizada(s), ${ledgerSummary.duplicatesInRun} indicação(ões) duplicada(s) na mesma execução.`);

results.sort((a, b) => b.edge - a.edge);

results.slice(0, 10).forEach((r, i) => {
  const warn = r.lowSample ? ' ⚠️' : '';
  const target = r.inefficientMarket ? ' 🎯' : '';
  console.log(`[${i + 1}] ${r.player}${warn}${target} | ${r.prop} ${r.side} ${r.line} | Edge: ${r.edge}% | Kelly: ${r.kelly}%`);
});

fs.writeFileSync('nfl_props_results.json', JSON.stringify(results, null, 2));
console.log('nfl_props_results.json salvo.');

const HISTORY_DIR = path.join(__dirname, '..', 'odds_history');
if (!fs.existsSync(HISTORY_DIR)) fs.mkdirSync(HISTORY_DIR, { recursive: true });
const today = new Date().toISOString().slice(0, 10);
const month = new Date().toISOString().slice(0, 7);
const histFile = path.join(HISTORY_DIR, `football_nfl_model_${month}.json`);
const hist = readJsonSafe(histFile, []);
const existingKeys = new Set(hist.map(e => e._key));
let added = 0;
for (const r of results) {
  const key = `${r.game}|${r.player}|${r.prop}|${r.side}|${today}`;
  if (existingKeys.has(key)) continue;
  hist.push({ _key: key, savedDate: today, savedAt: new Date().toISOString(), ...r });
  existingKeys.add(key);
  added++;
}
fs.writeFileSync(histFile, JSON.stringify(hist, null, 2));
console.log(`Histórico NFL: +${added} entradas.`);
