// pipeline/generate_report.js
// Relatório periódico de desempenho, agrupado por esporte + mercado + faixa
// de edge. Usa só indicações publicadas, resolvidas (ganhou/perdeu/push/
// cancelado) e válidas para calibração — os mesmos critérios usados na
// calibração, pra manter relatório e calibração consistentes entre si.
// Push e cancelado contam no lucro (stake devolvido = 0 de lucro) mas ficam
// fora da taxa de acerto, igual já é feito no resto do sistema.
//
// Uso: node pipeline/generate_report.js
// Grava odds_history/relatorio_desempenho.md (leitura humana, texto pronto)
// e odds_history/relatorio_desempenho.json (dado estruturado — é esse que
// pipeline/firebase_sync.js report sincroniza pro app ler).

const fs = require('fs');
const path = require('path');
const ledger = require('./model_ledger');
const riskConfig = require('./risk_config');

const OUT_FILE = path.join(ledger.HISTORY_DIR, 'relatorio_desempenho.md');
const OUT_JSON = path.join(ledger.HISTORY_DIR, 'relatorio_desempenho.json');
const EDGE_BUCKET_SIZE = 5; // %

function edgeBucket(edgePct) {
  const lo = Math.floor(edgePct / EDGE_BUCKET_SIZE) * EDGE_BUCKET_SIZE;
  return `${lo}-${lo + EDGE_BUCKET_SIZE}%`;
}

function loadAllEntries() {
  const files = ledger.listAllPartitions();
  const entries = [];
  for (const file of files) entries.push(...ledger.loadPartitionFile(file));
  return entries;
}

function isCountable(e) {
  return e.published
    && e.hasModelProb
    && e.validForCalibration !== false
    && e.resolutionStatus === ledger.RESOLUTION_STATUS.RESOLVIDO
    && e.result;
}

function isWinLoss(e) {
  return e.result.status === ledger.RESULT_STATUS.GANHOU || e.result.status === ledger.RESULT_STATUS.PERDEU;
}

// Lucro em "unidades de Kelly": stake = kelly% (do bankroll), lucro =
// stake*(odds-1) se ganhou, -stake se perdeu, 0 se push/cancelado.
function profitUnits(e) {
  const stake = typeof e.kelly === 'number' ? e.kelly : 0;
  if (e.result.status === ledger.RESULT_STATUS.GANHOU) return stake * (e.odds - 1);
  if (e.result.status === ledger.RESULT_STATUS.PERDEU) return -stake;
  return 0; // push / cancelado — stake devolvido, sem lucro nem perda
}

function segmentSampleSize(esporte, market, allEntries) {
  // mesma contagem usada pela calibração: resolvidas, válidas, binárias.
  return allEntries.filter(e =>
    e.esporte === esporte && e.market === market && e.hasModelProb &&
    e.validForCalibration !== false && e.resolutionStatus === ledger.RESOLUTION_STATUS.RESOLVIDO &&
    e.result && isWinLoss(e)
  ).length;
}

function main() {
  const all = loadAllEntries();
  const countable = all.filter(isCountable);

  const groups = new Map(); // `${esporte}|${market}|${bucket}` -> entries[]
  for (const e of countable) {
    const key = `${e.esporte}|${e.market}|${edgeBucket(e.edge)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(e);
  }

  const rows = [];
  for (const [key, entries] of groups) {
    const [esporte, market, bucket] = key.split('|');
    const winLoss = entries.filter(isWinLoss);
    const acertos = winLoss.filter(e => e.result.status === ledger.RESULT_STATUS.GANHOU).length;
    const winRateReal = winLoss.length ? acertos / winLoss.length * 100 : null;
    const winRateModelo = entries.length ? entries.reduce((s, e) => s + e.modelProb, 0) / entries.length : null;
    const lucro = entries.reduce((s, e) => s + profitUnits(e), 0);
    const stakeTotal = entries.reduce((s, e) => s + (typeof e.kelly === 'number' ? e.kelly : 0), 0);
    const roi = stakeTotal > 0 ? (lucro / stakeTotal) * 100 : null;
    const comClv = entries.filter(e => typeof e.clv === 'number');
    const clvMedio = comClv.length ? comClv.reduce((s, e) => s + e.clv, 0) / comClv.length : null;

    const sampleSize = segmentSampleSize(esporte, market, all);
    const segmentState = sampleSize >= riskConfig.MIN_SAMPLE_TO_CALIBRATE ? ledger.SEGMENT_STATE.CALIBRADO : ledger.SEGMENT_STATE.EM_AMOSTRA;
    const faltamParaCalibrar = Math.max(0, riskConfig.MIN_SAMPLE_TO_CALIBRATE - sampleSize);

    rows.push({
      esporte, market,
      edgeBucket: bucket,
      nResolvidasValidas: entries.length,
      nBinarias: winLoss.length,
      winRateReal: winRateReal === null ? null : parseFloat(winRateReal.toFixed(1)),
      winRateModelo: winRateModelo === null ? null : parseFloat(winRateModelo.toFixed(1)),
      roi: roi === null ? null : parseFloat(roi.toFixed(1)),
      clvMedio: clvMedio === null ? null : parseFloat(clvMedio.toFixed(2)),
      clvComOdd: comClv.length,
      semClv: entries.length - comClv.length,
      segmentState, sampleSize, faltamParaCalibrar,
    });
  }

  rows.sort((a, b) => a.esporte.localeCompare(b.esporte) || a.market.localeCompare(b.market) || a.edgeBucket.localeCompare(b.edgeBucket));

  const generatedAt = new Date().toISOString();

  const fmt = (n, d = 1) => n === null || n === undefined ? '—' : n.toFixed(d);
  const lines = [];
  lines.push('# Relatório de desempenho — histórico central de indicações');
  lines.push('');
  lines.push(`Gerado em: ${generatedAt}`);
  lines.push('');
  lines.push('Só inclui indicações publicadas, resolvidas e válidas para calibração (mesmo critério da calibração — NHL pré-correção da agregação de odds fica de fora, por exemplo). Push e cancelado entram no lucro/ROI mas não na taxa de acerto.');
  lines.push('');
  lines.push('| Esporte | Mercado | Faixa de edge | Nº resolvidas válidas | Taxa de acerto real | Taxa prevista pelo modelo | ROI | CLV médio | Estado do segmento | Faltam p/ calibrar |');
  lines.push('|---|---|---|---|---|---|---|---|---|---|');
  for (const r of rows) {
    const clvCell = r.clvMedio === null ? '—' : `${fmt(r.clvMedio)}% (${r.clvComOdd}/${r.nResolvidasValidas} com odd de fechamento)`;
    lines.push(`| ${r.esporte} | ${r.market} | ${r.edgeBucket} | ${r.nResolvidasValidas} | ${fmt(r.winRateReal)}% (${r.nBinarias} decididas) | ${fmt(r.winRateModelo)}% | ${r.roi === null ? '—' : fmt(r.roi) + '%'} | ${clvCell} | ${r.segmentState} | ${r.faltamParaCalibrar} |`);
  }
  if (!rows.length) lines.push('| _sem dados ainda_ | | | | | | | | | |');

  if (!fs.existsSync(ledger.HISTORY_DIR)) fs.mkdirSync(ledger.HISTORY_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, lines.join('\n') + '\n');
  fs.writeFileSync(OUT_JSON, JSON.stringify({ generatedAt, rows }, null, 2));
  console.log(`Relatório salvo em ${OUT_FILE} e ${OUT_JSON} — ${rows.length} grupo(s) esporte+mercado+faixa de edge.`);
}

main();
