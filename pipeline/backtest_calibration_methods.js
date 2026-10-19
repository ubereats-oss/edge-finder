// pipeline/backtest_calibration_methods.js
// Valida a calibração isotônica em produção (pipeline/calibration.js) contra
// o método antigo (congelado aqui como referência) antes de qualquer mudança
// ir pra main: simula, segmento por segmento, cada indicação resolvida em
// ordem cronológica, recalibrando a cada passo só com o que já tinha
// acontecido até ali (walk-forward) — exatamente como o pipeline real opera
// (calibration.js relê o ledger inteiro a cada execução). Compara Brier
// score e log-loss dos dois métodos, mais a probabilidade bruta sem
// calibração nenhuma, como referência.
//
// Só leitura: não grava nada no histórico central. Uso:
//   node pipeline/backtest_calibration_methods.js

const ledger = require('./model_ledger');
const config = require('./risk_config');
const calibration = require('./calibration');

const NHL_STATS_FIX_CUTOFF = '2026-10-06T22:25:11.000Z';

// ── Método ANTIGO — congelado aqui só pra comparação (isotônica pura acima
// de MIN_SAMPLE_TO_CALIBRATE, sem piso de amostra por nó, sem teto/piso de
// probabilidade, sem encolhimento gradual acima do mínimo). ────────────────
function oldApplyIsotonic(knots, rawProb) {
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

function oldCalibrate(trainSamples, rawProb, impliedProb) {
  const n = trainSamples.length;
  if (n >= config.MIN_SAMPLE_TO_CALIBRATE) {
    const knots = calibration.poolAdjacentViolators(
      trainSamples.map(s => ({ x: s.rawProb, y: s.won })).sort((a, b) => a.x - b.x)
    );
    const applied = oldApplyIsotonic(knots, rawProb);
    return applied === null ? rawProb : applied;
  }
  const t = config.MIN_SAMPLE_TO_CALIBRATE > 0 ? Math.max(0, Math.min(1, n / config.MIN_SAMPLE_TO_CALIBRATE)) : 1;
  const shrinkToRaw = config.MIN_SHRINK_TO_RAW + t * (1 - config.MIN_SHRINK_TO_RAW);
  return shrinkToRaw * rawProb + (1 - shrinkToRaw) * impliedProb;
}

// ── Método NOVO — usa o módulo real de produção, pra nunca divergir do que
// de fato roda no pipeline. ─────────────────────────────────────────────────
function newCalibrate(trainSamples, rawProb, impliedProb) {
  const n = trainSamples.length;
  const minN = config.MIN_SAMPLE_TO_CALIBRATE;
  if (n >= minN) {
    const knots = calibration.enforceMinBlockSize(
      calibration.poolAdjacentViolators(trainSamples.map(s => ({ x: s.rawProb, y: s.won })).sort((a, b) => a.x - b.x)),
      minN
    );
    const applied = calibration.applyIsotonic(knots, rawProb);
    const isotonicProb = applied === null ? rawProb : applied;
    const trust = calibration.trustAboveMinSample(n, minN);
    return calibration.clampProb(trust * isotonicProb + (1 - trust) * rawProb);
  }
  const t = minN > 0 ? Math.max(0, Math.min(1, n / minN)) : 1;
  const shrinkToRaw = config.MIN_SHRINK_TO_RAW + t * (1 - config.MIN_SHRINK_TO_RAW);
  return calibration.clampProb(shrinkToRaw * rawProb + (1 - shrinkToRaw) * impliedProb);
}

// ── Amostra: todas as avaliações resolvidas e válidas (publicadas ou não) ──
function isNhlValidAfterStatsFix(e) {
  if (e.esporte !== 'hockey/nhl') return true;
  const isModelSourced = e.source === 'model';
  const marca = isModelSourced ? (e.firstEvaluatedAt || e.evaluatedAt) : (e.commenceTime || e.firstEvaluatedAt || e.evaluatedAt);
  if (!marca) return true;
  return new Date(marca).getTime() >= new Date(NHL_STATS_FIX_CUTOFF).getTime();
}

function loadSegments() {
  const files = ledger.listAllPartitions();
  const all = [];
  for (const f of files) all.push(...ledger.loadPartitionFile(f));

  const segments = new Map(); // `${esporte}|${market}` -> samples[]
  for (const e of all) {
    if (!e.hasModelProb) continue;
    if (e.validForCalibration === false) continue;
    if (!isNhlValidAfterStatsFix(e)) continue;
    if (e.resolutionStatus !== 'resolvido') continue;
    if (!e.result || (e.result.status !== 'ganhou' && e.result.status !== 'perdeu')) continue;
    if (typeof e.rawProb !== 'number') continue;
    if (typeof e.odds !== 'number' || e.odds <= 1) continue;
    const time = e.firstEvaluatedAt || e.evaluatedAt;
    if (!time) continue;
    const key = `${e.esporte}|${e.market}`;
    if (!segments.has(key)) segments.set(key, []);
    segments.get(key).push({
      time,
      rawProb: e.rawProb / 100,
      impliedProb: 1 / e.odds,
      won: e.result.status === 'ganhou' ? 1 : 0,
    });
  }
  for (const samples of segments.values()) samples.sort((a, b) => new Date(a.time) - new Date(b.time));
  return segments;
}

// ── Métricas ────────────────────────────────────────────────────────────────
const EPS = 1e-6;
function brier(p, y) { return (p - y) ** 2; }
function logLoss(p, y) {
  const pc = Math.min(1 - EPS, Math.max(EPS, p));
  return -(y * Math.log(pc) + (1 - y) * Math.log(1 - pc));
}

function main() {
  const segments = loadSegments();
  const rows = [];
  const grand = {
    old: { brierSum: 0, logLossSum: 0, n: 0, clipped: 0 },
    new: { brierSum: 0, logLossSum: 0, n: 0, clipped: 0 },
    raw: { brierSum: 0, logLossSum: 0, n: 0 },
  };

  for (const [key, samples] of segments) {
    if (samples.length < 2 * config.MIN_SAMPLE_TO_CALIBRATE) {
      rows.push({ key, n: samples.length, skipped: true });
      continue;
    }

    const acc = {
      old: { brierSum: 0, logLossSum: 0, n: 0, clipped: 0 },
      new: { brierSum: 0, logLossSum: 0, n: 0, clipped: 0 },
      raw: { brierSum: 0, logLossSum: 0, n: 0 },
    };

    const WARMUP = 5;
    for (let i = WARMUP; i < samples.length; i++) {
      const train = samples.slice(0, i);
      const test = samples[i];

      const pOld = oldCalibrate(train, test.rawProb, test.impliedProb);
      const pNew = newCalibrate(train, test.rawProb, test.impliedProb);

      acc.old.brierSum += brier(pOld, test.won);
      acc.old.logLossSum += logLoss(pOld, test.won);
      acc.old.n++;
      if (pOld <= EPS || pOld >= 1 - EPS) acc.old.clipped++;

      acc.new.brierSum += brier(pNew, test.won);
      acc.new.logLossSum += logLoss(pNew, test.won);
      acc.new.n++;
      if (pNew <= EPS || pNew >= 1 - EPS) acc.new.clipped++;

      acc.raw.brierSum += brier(test.rawProb, test.won);
      acc.raw.logLossSum += logLoss(test.rawProb, test.won);
      acc.raw.n++;
    }

    for (const m of ['old', 'new', 'raw']) {
      grand[m].brierSum += acc[m].brierSum;
      grand[m].logLossSum += acc[m].logLossSum;
      grand[m].n += acc[m].n;
      if (m !== 'raw') grand[m].clipped += acc[m].clipped;
    }

    rows.push({
      key, n: samples.length, tested: acc.old.n,
      oldBrier: acc.old.brierSum / acc.old.n,
      newBrier: acc.new.brierSum / acc.new.n,
      oldLogLoss: acc.old.logLossSum / acc.old.n,
      newLogLoss: acc.new.logLossSum / acc.new.n,
      oldClipped: acc.old.clipped,
      newClipped: acc.new.clipped,
    });
  }

  console.log('# Backtest: calibração antiga vs nova (walk-forward, por segmento)\n');
  console.log('| Segmento | N resolvidas | N testadas | Brier antigo | Brier novo | LogLoss antigo | LogLoss novo | 0%/100% antigo | 0%/100% novo |');
  console.log('|---|---|---|---|---|---|---|---|---|');
  let anyRegression = false;
  for (const r of rows) {
    if (r.skipped) {
      console.log(`| ${r.key} | ${r.n} | _amostra insuficiente (<${2 * config.MIN_SAMPLE_TO_CALIBRATE}) — não validado_ | | | | | | |`);
      continue;
    }
    const regressedBrier = r.newBrier > r.oldBrier + 1e-9;
    const regressedLogLoss = r.newLogLoss > r.oldLogLoss + 1e-9;
    if (regressedBrier || regressedLogLoss) anyRegression = true;
    console.log(`| ${r.key} | ${r.n} | ${r.tested} | ${r.oldBrier.toFixed(4)} | ${r.newBrier.toFixed(4)}${regressedBrier ? ' ⚠' : ''} | ${r.oldLogLoss.toFixed(4)} | ${r.newLogLoss.toFixed(4)}${regressedLogLoss ? ' ⚠' : ''} | ${r.oldClipped} | ${r.newClipped} |`);
  }

  const oldBrierAvg = grand.old.brierSum / grand.old.n;
  const newBrierAvg = grand.new.brierSum / grand.new.n;
  const oldLogLossAvg = grand.old.logLossSum / grand.old.n;
  const newLogLossAvg = grand.new.logLossSum / grand.new.n;
  const rawBrierAvg = grand.raw.brierSum / grand.raw.n;
  const rawLogLossAvg = grand.raw.logLossSum / grand.raw.n;

  console.log('\n## Agregado (todas as predições testadas, ponderado por segmento)\n');
  console.log(`N total testado: ${grand.old.n}`);
  console.log(`Brier  — bruta: ${rawBrierAvg.toFixed(4)} | antigo: ${oldBrierAvg.toFixed(4)} | novo: ${newBrierAvg.toFixed(4)}`);
  console.log(`LogLoss — bruta: ${rawLogLossAvg.toFixed(4)} | antigo: ${oldLogLossAvg.toFixed(4)} | novo: ${newLogLossAvg.toFixed(4)}`);
  console.log(`Predições em 0%/100% exatos — antigo: ${grand.old.clipped} | novo: ${grand.new.clipped}`);

  const overallBetter = newBrierAvg <= oldBrierAvg + 1e-9 && newLogLossAvg <= oldLogLossAvg + 1e-9;
  console.log(`\nVEREDITO: ${overallBetter ? 'NOVO método é igual ou melhor no agregado.' : 'NOVO método PIOROU no agregado — não enviar.'}`);
  if (anyRegression) console.log('Atenção: houve regressão (⚠) em pelo menos um segmento individual mesmo com agregado melhor — ver tabela acima.');
}

main();
