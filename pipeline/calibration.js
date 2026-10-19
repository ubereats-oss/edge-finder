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
//
// Duas salvaguardas contra overfitting de amostra pequena (ver
// pipeline/backtest_calibration_methods.js pra validação com dados reais):
//  1. Nenhum nó da isotônica se apoia em menos de MIN_SAMPLE_TO_CALIBRATE
//     resolvidas — blocos adjacentes do Pool Adjacent Violators são
//     fundidos até atingir o mínimo (ver enforceMinBlockSize).
//  2. Mesmo calibrado, a probabilidade final é uma mistura entre a saída da
//     isotônica e a bruta, com peso (`trust`) que cresce gradualmente com o
//     tamanho da amostra — sem salto abrupto ao cruzar o mínimo — e nunca
//     sai do intervalo [5%, 95%].

const ledger = require('./model_ledger');
const config = require('./risk_config');

// Identifica qual versão do método gerou calibratedProb — gravado em cada
// indicação (model_ledger.recordEvaluation) pra relatório de desempenho e
// app poderem ler a taxa prevista calibrada separada por versão, sem o
// método antigo contaminar a leitura do novo. Indicações gravadas antes
// deste campo existir não têm essa chave — tratadas como 'antigo' por quem
// lê (nunca reescritas retroativamente).
const CALIBRATION_METHOD_VERSION = 'novo';

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

// Funde blocos vizinhos (na ordem, preservando monotonicidade — a média
// ponderada de dois blocos adjacentes sempre fica entre os dois, então nunca
// viola quem está fora do par) até que cada um tenha pelo menos `minN`.
// Um resto final menor que minN é incorporado de volta ao bloco anterior, pra
// nenhum trecho da curva nunca se apoiar em menos de minN resolvidas.
function mergeBlocks(a, b) {
  const n = a.n + b.n;
  return { x: (a.x * a.n + b.x * b.n) / n, y: (a.y * a.n + b.y * b.n) / n, n };
}

function enforceMinBlockSize(blocks, minN) {
  if (!blocks.length) return blocks;
  const merged = [];
  let current = null;
  for (const b of blocks) {
    current = current ? mergeBlocks(current, b) : { x: b.x, y: b.y, n: b.n };
    if (current.n >= minN) { merged.push(current); current = null; }
  }
  if (current) {
    if (merged.length) merged[merged.length - 1] = mergeBlocks(merged[merged.length - 1], current);
    else merged.push(current); // amostra total < minN — um único bloco cobrindo tudo
  }
  return merged;
}

// samples: [{rawProb, won}] (won: 1 ganhou, 0 perdeu) — devolve os nós
// (knots) ordenados por x, já com y monotônico não-decrescente e cada nó
// apoiado em pelo menos minN resolvidas.
function buildIsotonicKnots(samples, minN = config.MIN_SAMPLE_TO_CALIBRATE) {
  const points = samples.map(s => ({ x: s.rawProb, y: s.won })).sort((a, b) => a.x - b.x);
  return enforceMinBlockSize(poolAdjacentViolators(points), minN);
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
      // Conferências manuais de odds de casas PT (tela "Conferir odds") não
      // são avaliação do modelo — nunca entram na calibração automática.
      if (e.source === 'pt_odds_check') continue;
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
  const knots = samples.length >= 2 ? buildIsotonicKnots(samples, config.MIN_SAMPLE_TO_CALIBRATE) : [];
  const fit = { sampleSize: samples.length, knots };
  fitCache.set(key, fit);
  return fit;
}

const MIN_CALIBRATED_PROB = 0.05;
const MAX_CALIBRATED_PROB = 0.95;
function clampProb(p) {
  return Math.min(MAX_CALIBRATED_PROB, Math.max(MIN_CALIBRATED_PROB, p));
}

// Confiança na isotônica acima do mínimo de amostra: 0 bem no limiar (onde
// cai pra bruta, sem salto — contínuo com o fim da mistura em_amostra, que
// termina em shrinkToRaw=1 = puro bruta) e cresce assintoticamente até 1
// conforme a amostra acumula muito além do mínimo. Nunca é tudo-ou-nada.
function trustAboveMinSample(sampleSize, minSample) {
  return sampleSize <= minSample ? 0 : 1 - minSample / sampleSize;
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
    const isotonicProb = applied === null ? rawProb : applied;
    const trust = trustAboveMinSample(fit.sampleSize, config.MIN_SAMPLE_TO_CALIBRATE);
    const calibratedProb = trust * isotonicProb + (1 - trust) * rawProb;
    return {
      calibratedProb: clampProb(calibratedProb),
      segmentState,
      sampleSize: fit.sampleSize,
      stakeFraction: 1,
      methodVersion: CALIBRATION_METHOD_VERSION,
    };
  }

  const { shrinkToRaw, stakeFraction } = inSampleAdjustment(fit.sampleSize);
  const calibratedProb = shrinkToRaw * rawProb + (1 - shrinkToRaw) * impliedProb;
  return {
    calibratedProb: clampProb(calibratedProb),
    segmentState,
    sampleSize: fit.sampleSize,
    stakeFraction,
    methodVersion: CALIBRATION_METHOD_VERSION,
  };
}

/** Limpa o cache de ajuste — só é preciso entre execuções de teste. */
function clearCache() {
  fitCache.clear();
}

module.exports = {
  CALIBRATION_METHOD_VERSION,
  calibrate,
  buildIsotonicKnots,
  applyIsotonic,
  loadSegmentSamples,
  segmentStateFor,
  inSampleAdjustment,
  clearCache,
  poolAdjacentViolators,
  enforceMinBlockSize,
  trustAboveMinSample,
  clampProb,
};
