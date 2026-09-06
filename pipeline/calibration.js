// pipeline/calibration.js
// Calibra a probabilidade bruta do modelo por regressão isotônica, ajustada
// sob demanda a partir do histórico central de indicações (odds_history/
// model_ledger_*), agrupada por esporte + mercado.
//
// Não existe uma tabela de calibração persistida — cada chamada relê o
// estado atual do ledger e reajusta na hora. É assim que a calibração
// "reajusta automaticamente a cada sincronização de resultados": não há
// nada pra ficar dessincronizado, o ajuste É o histórico no momento em que é
// consultado. O cache abaixo é só pra não reler o mesmo segmento várias
// vezes dentro da mesma execução de um script.

const ledger = require('./model_ledger');
const config = require('./risk_config');

// ── Regressão isotônica (Pool Adjacent Violators) ──────────────────────────

// points: [{x, y}] — devolve blocos monotônicos não-decrescentes em y.
function poolAdjacentViolators(points) {
  const blocks = [];
  for (const p of points) {
    blocks.push({ xMin: p.x, xMax: p.x, xSum: p.x, n: 1, ySum: p.y });
    while (blocks.length >= 2) {
      const last = blocks[blocks.length - 1];
      const prev = blocks[blocks.length - 2];
      if (prev.ySum / prev.n > last.ySum / last.n) {
        prev.xMin = Math.min(prev.xMin, last.xMin);
        prev.xMax = Math.max(prev.xMax, last.xMax);
        prev.xSum += last.xSum;
        prev.n += last.n;
        prev.ySum += last.ySum;
        blocks.pop();
      } else {
        break;
      }
    }
  }
  return blocks.map(b => ({ x: b.xSum / b.n, y: b.ySum / b.n, n: b.n }));
}

// samples: [{rawProb, won}] (won: 1 ganhou, 0 perdeu) — devolve os nós
// (knots) ordenados por x, já com y monotônico não-decrescente.
function buildIsotonicKnots(samples) {
  const points = samples.map(s => ({ x: s.rawProb, y: s.won })).sort((a, b) => a.x - b.x);
  return poolAdjacentViolators(points);
}

// Interpola linearmente entre nós; fora do intervalo observado, mantém o
// valor do nó mais próximo (extrapolação plana — mais segura que linear pra
// isotônica, e cobre o caso de faixa de probabilidade sem histórico).
function applyIsotonic(knots, rawProb) {
  if (!knots.length) return null;
  if (rawProb <= knots[0].x) return knots[0].y;
  if (rawProb >= knots[knots.length - 1].x) return knots[knots.length - 1].y;
  for (let i = 0; i < knots.length - 1; i++) {
    const a = knots[i], b = knots[i + 1];
    if (rawProb >= a.x && rawProb <= b.x) {
      if (b.x === a.x) return a.y;
      const t = (rawProb - a.x) / (b.x - a.x);
      return a.y + t * (b.y - a.y);
    }
  }
  return knots[knots.length - 1].y;
}

// ── Amostra do histórico por segmento ───────────────────────────────────────

// Carrega apostas resolvidas, válidas e com desfecho binário (ganhou/perdeu)
// de um segmento — é o que alimenta a isotônica. Push/cancelado/não-apurável
// não carregam sinal de calibração e ficam de fora da amostra (mas continuam
// existindo no histórico geral, fora deste filtro).
function loadSegmentSamples(esporte, market) {
  const files = ledger.listPartitions(esporte);
  const samples = [];
  for (const file of files) {
    const entries = ledger.loadPartitionFile(file);
    for (const e of entries) {
      if (e.market !== market) continue;
      if (!e.hasModelProb) continue;
      if (e.validForCalibration === false) continue;
      if (e.resolutionStatus !== ledger.RESOLUTION_STATUS.RESOLVIDO) continue;
      if (!e.result) continue;
      if (e.result.status !== ledger.RESULT_STATUS.GANHOU && e.result.status !== ledger.RESULT_STATUS.PERDEU) continue;
      if (typeof e.rawProb !== 'number') continue;
      samples.push({ rawProb: e.rawProb / 100, won: e.result.status === ledger.RESULT_STATUS.GANHOU ? 1 : 0 });
    }
  }
  return samples;
}

function segmentStateFor(sampleSize) {
  return sampleSize >= config.MIN_SAMPLE_TO_CALIBRATE
    ? ledger.SEGMENT_STATE.CALIBRADO
    : ledger.SEGMENT_STATE.EM_AMOSTRA;
}

// Encolhimento em direção à odd implícita e fração de stake — ambos vão de
// um mínimo conservador (amostra zero) até neutro (amostra completa).
function inSampleAdjustment(sampleSize) {
  const min = config.MIN_SAMPLE_TO_CALIBRATE;
  const t = min > 0 ? Math.max(0, Math.min(1, sampleSize / min)) : 1;
  const shrinkToRaw = config.MIN_SHRINK_TO_RAW + t * (1 - config.MIN_SHRINK_TO_RAW);
  const stakeFraction = config.MIN_STAKE_FRACTION + t * (1 - config.MIN_STAKE_FRACTION);
  return { shrinkToRaw, stakeFraction };
}

const fitCache = new Map(); // `${esporte}|${market}` -> { sampleSize, knots }

function getSegmentFit(esporte, market) {
  const key = `${esporte}|${market}`;
  if (fitCache.has(key)) return fitCache.get(key);
  const samples = loadSegmentSamples(esporte, market);
  const knots = samples.length >= 2 ? buildIsotonicKnots(samples) : [];
  const fit = { sampleSize: samples.length, knots };
  fitCache.set(key, fit);
  return fit;
}

/**
 * Calibra uma probabilidade bruta do modelo pro segmento esporte+mercado.
 * rawProb, impliedProb: 0-1 (não em %).
 * Devolve { calibratedProb, segmentState, sampleSize, stakeFraction }, todos
 * prontos pra gravar na indicação e usar no cálculo de edge/Kelly.
 */
function calibrate({ esporte, market, rawProb, impliedProb }) {
  const fit = getSegmentFit(esporte, market);
  const segmentState = segmentStateFor(fit.sampleSize);

  if (segmentState === ledger.SEGMENT_STATE.CALIBRADO) {
    const applied = applyIsotonic(fit.knots, rawProb);
    return {
      calibratedProb: applied === null ? rawProb : applied,
      segmentState,
      sampleSize: fit.sampleSize,
      stakeFraction: 1,
    };
  }

  const { shrinkToRaw, stakeFraction } = inSampleAdjustment(fit.sampleSize);
  const calibratedProb = shrinkToRaw * rawProb + (1 - shrinkToRaw) * impliedProb;
  return { calibratedProb, segmentState, sampleSize: fit.sampleSize, stakeFraction };
}

/** Limpa o cache de ajuste — só é preciso entre execuções de teste. */
function clearCache() {
  fitCache.clear();
}

module.exports = {
  calibrate,
  buildIsotonicKnots,
  applyIsotonic,
  loadSegmentSamples,
  segmentStateFor,
  inSampleAdjustment,
  clearCache,
};
