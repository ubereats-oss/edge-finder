// pipeline/model_ledger.js
// Histórico central de indicações do modelo — liga a probabilidade que o
// modelo deu a cada prop ao resultado real do evento. É do modelo, não do
// usuário: registra toda indicação avaliada (publicada ou não), independente
// de alguém ter apostado nela. Usado depois para calibração, relatório de
// desempenho e controle de risco por segmento.
//
// Particionado por esporte e por mês em:
//   odds_history/model_ledger_<sportSlug>_<yyyy-mm>.json
// Cada chamada de recordEvaluation() só atualiza a partição do próprio
// esporte/mês — nunca mexe nas outras.

const fs = require('fs');
const path = require('path');
const closingOddsRules = require('./closing_odds_rules');

const HISTORY_DIR = path.join(__dirname, '..', 'odds_history');

// Quantas tentativas o segundo processo (settle_model_ledger.js) faz antes
// de desistir de apurar o resultado de uma indicação.
const MAX_RESOLUTION_ATTEMPTS = 5;

const REJECTION_REASONS = {
  EDGE_ABAIXO_LIMIAR: 'edge_abaixo_limiar',
  SEGMENTO_DESABILITADO: 'segmento_desabilitado',
  GUARDA_EDGE_MAXIMO: 'guarda_edge_maximo',
  GUARDA_MAX_APOSTAS_JOGO: 'guarda_max_apostas_jogo',
  GUARDA_MAX_POR_JOGADOR: 'guarda_max_por_jogador',
  SYNC_BR_EDGE_INSUFICIENTE: 'sync_br_edge_insuficiente',
};

const RESULT_STATUS = {
  GANHOU: 'ganhou',
  PERDEU: 'perdeu',
  PUSH: 'push',
  CANCELADO: 'cancelado',
};

const RESOLUTION_STATUS = {
  PENDENTE: 'pendente',
  RESOLVIDO: 'resolvido',
  NAO_APURAVEL: 'nao_apuravel',
};

// Rastreio da odd de fechamento — independente de resolutionStatus (que é
// sobre o RESULTADO da aposta). 'pendente' = ainda dentro (ou antes) da
// janela de captura; 'capturada' = closingOdds já preenchido; 'expirada' =
// a janela de captura passou sem sucesso (closingOdds continua nulo) — não
// entra mais na varredura de capture_closing_odds.js nem do
// closingOddsScheduler. Expiração é estado terminal: nunca volta a pendente.
const CLOSING_ODDS_STATUS = {
  PENDENTE: 'pendente',
  CAPTURADA: 'capturada',
  EXPIRADA: 'expirada',
};

// Janela de captura de odd de fechamento — mesma usada por
// capture_closing_odds.js (o que tenta buscar) e settle_model_ledger.js (o
// que expira quem passou da janela sem sucesso). Fonte única pra evitar os
// dois lados divergirem.
const CLOSING_ODDS_CAPTURE_WINDOW_BEFORE_MS = closingOddsRules.CLOSING_ODDS_CAPTURE_WINDOW_BEFORE_MS; // até 2h antes do início
const CLOSING_ODDS_CAPTURE_WINDOW_AFTER_MS  = closingOddsRules.CLOSING_ODDS_CAPTURE_WINDOW_AFTER_MS;  // até 10min depois

const SEGMENT_STATE = {
  EM_AMOSTRA: 'em_amostra',
  CALIBRADO: 'calibrado',
};

function readJsonSafe(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  const raw = fs.readFileSync(file, 'utf-8').trim();
  if (!raw) return fallback;
  try { return JSON.parse(raw); } catch (e) {
    console.warn(`Aviso: ${file} inválido — usando fallback. ${e.message}`);
    return fallback;
  }
}

// 'hockey/nhl' -> 'nhl' | 'basketball/nba' -> 'nba' | 'nhl' -> 'nhl'
function sportSlug(esporte) {
  return esporte && esporte.includes('/') ? esporte.split('/')[1] : esporte;
}

function monthOf(isoOrDate) {
  const d = isoOrDate ? new Date(isoOrDate) : new Date();
  if (isNaN(d.getTime())) return new Date().toISOString().slice(0, 7);
  return d.toISOString().slice(0, 7);
}

function partitionPath(esporte, month) {
  return path.join(HISTORY_DIR, `model_ledger_${sportSlug(esporte)}_${month}.json`);
}

function loadPartition(esporte, month) {
  return readJsonSafe(partitionPath(esporte, month), []);
}

function savePartition(esporte, month, entries) {
  if (!fs.existsSync(HISTORY_DIR)) fs.mkdirSync(HISTORY_DIR, { recursive: true });
  fs.writeFileSync(partitionPath(esporte, month), JSON.stringify(entries, null, 2));
}

// Variantes por caminho de arquivo direto — usadas por scripts que varrem
// todas as partições já existentes (calibração, reprocessamento, relatório,
// captura de odd de fechamento) sem saber de antemão esporte/mês.
function loadPartitionFile(filePath) {
  return readJsonSafe(filePath, []);
}

function savePartitionFile(filePath, entries) {
  fs.writeFileSync(filePath, JSON.stringify(entries, null, 2));
}

// Lista os arquivos de partição já existentes para um esporte (todos os meses).
function listPartitions(esporte) {
  if (!fs.existsSync(HISTORY_DIR)) return [];
  const prefix = `model_ledger_${sportSlug(esporte)}_`;
  return fs.readdirSync(HISTORY_DIR)
    .filter(f => f.startsWith(prefix) && f.endsWith('.json'))
    .map(f => path.join(HISTORY_DIR, f));
}

// Lista as partições de TODOS os esportes (todos os meses) — usado por
// scripts que varrem o histórico inteiro (reprocessamento, relatório,
// captura de odd de fechamento).
function listAllPartitions() {
  if (!fs.existsSync(HISTORY_DIR)) return [];
  return fs.readdirSync(HISTORY_DIR)
    .filter(f => f.startsWith('model_ledger_') && f.endsWith('.json'))
    .map(f => path.join(HISTORY_DIR, f));
}

function makeKey({ eventId, player, market, line, side }) {
  return `${eventId}|${player}|${market}|${line}|${side}`;
}

function indicationId(rec) {
  return makeKey({
    eventId: rec.eventId ?? rec.gameId ?? rec.pinnacleId ?? `${rec.game}|${rec.commenceTime ?? rec.commence_time}`,
    player: rec.player,
    market: rec.market ?? rec.prop,
    line: rec.line,
    side: rec.side,
  });
}

// Estado de rastreio da odd de fechamento pra uma indicação, inferindo a
// partir de closingOdds quando o campo closingOddsStatus ainda não existir
// (compat com indicações gravadas antes deste campo existir).
function closingOddsStatusOf(entry) {
  if (entry.closingOddsStatus) return entry.closingOddsStatus;
  return (entry.closingOdds !== null && entry.closingOdds !== undefined)
    ? CLOSING_ODDS_STATUS.CAPTURADA
    : CLOSING_ODDS_STATUS.PENDENTE;
}

// Marca como expirada uma indicação cuja janela de captura de odd de
// fechamento já passou sem sucesso. Não mexe em resolutionStatus. Nunca
// reverte uma indicação já expirada ou já capturada (expiração é estado
// terminal) nem expira uma indicação sem commenceTime válido — essa
// simplesmente não muda de estado, sem travar a checagem das demais.
// Devolve true se mudou o estado (pra quem chama saber se precisa salvar).
function maybeExpireClosingOdds(entry, now) {
  if (closingOddsStatusOf(entry) !== CLOSING_ODDS_STATUS.PENDENTE) return false;
  const commence = new Date(entry.commenceTime).getTime();
  if (isNaN(commence)) return false;
  if (commence + CLOSING_ODDS_CAPTURE_WINDOW_AFTER_MS >= now) return false;
  entry.closingOddsStatus = CLOSING_ODDS_STATUS.EXPIRADA;
  return true;
}

// Buffer em memória por esporte+mês durante a execução do script chamador,
// pra não reler/reescrever o arquivo a cada indicação avaliada.
const buffers = new Map(); // `${esporte}|${month}` -> { esporte, month, byKey: Map }
let duplicatesInRun = 0;
const seenThisRun = new Set();

function bufferFor(esporte, month) {
  const bufKey = `${esporte}|${month}`;
  if (!buffers.has(bufKey)) {
    const entries = loadPartition(esporte, month);
    const byKey = new Map(entries.map(e => [e._key, e]));
    buffers.set(bufKey, { esporte, month, byKey });
  }
  return buffers.get(bufKey);
}

/**
 * Registra uma indicação avaliada pelo modelo (publicada ou rejeitada).
 * Registra também descartes de qualidade de dado quando o chamador passa
 * hasModelProb:false e validForCalibration:false.
 */
function recordEvaluation(rec) {
  const {
    esporte, eventId, game, commenceTime, player, market, line, side,
    // modelProb = probabilidade CALIBRADA (é o que edge/Kelly usam). rawProb
    // = probabilidade bruta do modelo, antes da calibração, só para auditoria.
    modelProb, rawProb, odds, bookmaker, edge, kelly, published, rejectionReason,
    playerTeam,
    playerAvg, playerStd, playerAvg5, playerAvg10,
    runId,
    // Estado do controle de risco por segmento no momento da avaliação.
    segmentState, sampleSize,
    // Odd de fechamento (capturada perto do início do evento) e CLV — ficam
    // null até capture_closing_odds.js preencher, perto do começo do jogo.
    closingOdds, clv,
    // Overrides usados só por scripts de importação de histórico legado
    // (ex.: import_legacy_apostas.js) — indicações reais do modelo nunca
    // precisam passar isso, os defaults ('model'/true) cobrem o caso normal.
    source, hasModelProb, result, resolutionStatus, resolutionAttempts,
    validForCalibration, invalidReason,
  } = rec;

  if (!esporte || eventId == null || player == null || market == null || line == null || !side) {
    console.warn('model_ledger: registro descartado por campos obrigatórios ausentes.', rec);
    return;
  }

  const _key = makeKey({ eventId, player, market, line, side });
  const month = monthOf(commenceTime);
  const buf = bufferFor(esporte, month);

  if (seenThisRun.has(_key)) duplicatesInRun++;
  seenThisRun.add(_key);

  const now = new Date().toISOString();
  const existing = buf.byKey.get(_key);

  const evaluation = {
    _key,
    indicationId: _key,
    esporte,
    eventId,
    game: game ?? existing?.game ?? null,
    commenceTime: commenceTime ?? existing?.commenceTime ?? null,
    player,
    playerTeam: playerTeam ?? existing?.playerTeam ?? null,
    playerAvg: playerAvg ?? existing?.playerAvg ?? null,
    playerStd: playerStd ?? existing?.playerStd ?? null,
    playerAvg5: playerAvg5 ?? existing?.playerAvg5 ?? null,
    playerAvg10: playerAvg10 ?? existing?.playerAvg10 ?? null,
    market,
    line,
    side,
    modelProb,
    rawProb: rawProb ?? null,
    odds,
    bookmaker: bookmaker ?? null,
    edge,
    kelly,
    published: published ?? null,
    rejectionReason: rejectionReason ?? null,
    segmentState: segmentState ?? null,
    sampleSize: sampleSize ?? null,
    runId: runId ?? now,
    evaluatedAt: now,
  };

  if (existing) {
    // Indicação já avaliada em execução anterior (evento ainda não começou).
    // Atualiza os dados da avaliação, preserva o que já foi apurado.
    buf.byKey.set(_key, {
      ...existing,
      ...evaluation,
      indicationId: _key,
      firstEvaluatedAt: existing.firstEvaluatedAt ?? existing.evaluatedAt ?? now,
      result: existing.result ?? result ?? null,
      resolutionAttempts: existing.resolutionAttempts ?? resolutionAttempts ?? 0,
      resolutionStatus: resolutionStatus ?? existing.resolutionStatus ?? RESOLUTION_STATUS.PENDENTE,
      source: existing.source ?? source ?? 'model',
      hasModelProb: hasModelProb ?? existing.hasModelProb ?? true,
      validForCalibration: validForCalibration ?? existing.validForCalibration ?? true,
      invalidReason: invalidReason ?? existing.invalidReason ?? null,
      closingOdds: existing.closingOdds ?? closingOdds ?? null,
      clv: existing.clv ?? clv ?? null,
      adjustedClosingLine: existing.adjustedClosingLine ?? null,
      adjustedClosingOverOdds: existing.adjustedClosingOverOdds ?? null,
      adjustedClosingUnderOdds: existing.adjustedClosingUnderOdds ?? null,
      closingLineMovement: existing.closingLineMovement ?? null,
      lineAdjustedClv: existing.lineAdjustedClv ?? null,
      closingOddsMissingReason: existing.closingOddsMissingReason ?? null,
      closingOddsAvailableLines: existing.closingOddsAvailableLines ?? null,
      closingOddsLastAttemptAt: existing.closingOddsLastAttemptAt ?? null,
      closingOddsStatus: existing.closingOddsStatus ?? CLOSING_ODDS_STATUS.PENDENTE,
    });
  } else {
    buf.byKey.set(_key, {
      ...evaluation,
      indicationId: _key,
      firstEvaluatedAt: now,
      result: result ?? null,
      resolutionAttempts: resolutionAttempts ?? 0,
      resolutionStatus: resolutionStatus ?? RESOLUTION_STATUS.PENDENTE,
      source: source ?? 'model',
      hasModelProb: hasModelProb ?? true,
      validForCalibration: validForCalibration ?? true,
      invalidReason: invalidReason ?? null,
      closingOdds: closingOdds ?? null,
      clv: clv ?? null,
      closingOddsStatus: CLOSING_ODDS_STATUS.PENDENTE,
    });
  }
}

/** Grava no disco todas as partições tocadas nesta execução. */
function flush() {
  let partitionsSaved = 0;
  for (const buf of buffers.values()) {
    savePartition(buf.esporte, buf.month, Array.from(buf.byKey.values()));
    partitionsSaved++;
  }
  const summary = { duplicatesInRun, partitionsSaved };
  buffers.clear();
  seenThisRun.clear();
  duplicatesInRun = 0;
  return summary;
}

module.exports = {
  HISTORY_DIR,
  MAX_RESOLUTION_ATTEMPTS,
  REJECTION_REASONS,
  RESULT_STATUS,
  RESOLUTION_STATUS,
  CLOSING_ODDS_STATUS,
  CLOSING_ODDS_CAPTURE_WINDOW_BEFORE_MS,
  CLOSING_ODDS_CAPTURE_WINDOW_AFTER_MS,
  SEGMENT_STATE,
  sportSlug,
  monthOf,
  makeKey,
  indicationId,
  closingOddsStatusOf,
  maybeExpireClosingOdds,
  loadPartition,
  savePartition,
  loadPartitionFile,
  savePartitionFile,
  listPartitions,
  listAllPartitions,
  recordEvaluation,
  flush,
};
