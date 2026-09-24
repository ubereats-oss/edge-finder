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

async function loadBets() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    const admin = require('firebase-admin');
    if (!admin.apps.length) {
      admin.initializeApp({
        credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)),
      });
    }
    const snap = await admin.firestore().collection('bets').get();
    const bets = [];
    snap.forEach(doc => bets.push({ id: doc.id, ...doc.data() }));
    return bets;
  }

  const file = path.join(__dirname, '..', 'bets.json');
  if (!fs.existsSync(file)) return [];
  const raw = fs.readFileSync(file, 'utf8').trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    console.warn(`Aviso: bets.json inválido — visão de apostas reais ignorada. ${e.message}`);
    return [];
  }
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

function betProfit(bet) {
  if (typeof bet.profit === 'number') return bet.profit;
  if (bet.status !== 'resolved' || typeof bet.won !== 'boolean') return null;
  const stake = typeof bet.stake === 'number' ? bet.stake : 0;
  const odds = typeof bet.odds === 'number' ? bet.odds : 0;
  return bet.won ? stake * (odds - 1) : -stake;
}

function computeBetClv(bet, entry) {
  if (typeof bet.odds !== 'number' || typeof entry.closingOdds !== 'number') return null;
  return (bet.odds / entry.closingOdds - 1) * 100;
}

function realBetRows(bets, allEntries) {
  const byId = new Map();
  for (const entry of allEntries) {
    const id = entry.indicationId ?? entry._key;
    if (id) byId.set(id, entry);
  }

  const linked = [];
  let manualWithoutIndication = 0;
  let unresolvedLinked = 0;
  for (const bet of bets) {
    const indicationId = bet.indicationId ?? bet.ledgerKey ?? null;
    if (!indicationId) {
      manualWithoutIndication++;
      continue;
    }
    const entry = byId.get(indicationId);
    if (!entry) {
      linked.push({ bet, entry: null, clv: null, profit: betProfit(bet), missingLedger: true });
      continue;
    }
    if (bet.status !== 'resolved') unresolvedLinked++;
    linked.push({ bet, entry, clv: computeBetClv(bet, entry), profit: betProfit(bet), missingLedger: false });
  }

  const groups = new Map();
  for (const item of linked) {
    const entry = item.entry;
    const sport = entry?.esporte ?? item.bet.sport ?? 'manual';
    const market = entry?.market ?? item.bet.prop ?? 'manual';
    const key = `${sport}|${market}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }

  const rows = [];
  for (const [key, items] of groups) {
    const [esporte, market] = key.split('|');
    const resolved = items.filter(i => i.bet.status === 'resolved');
    const wins = resolved.filter(i => i.bet.won === true).length;
    const stakeTotal = items.reduce((s, i) => s + (typeof i.bet.stake === 'number' ? i.bet.stake : 0), 0);
    const profitTotal = resolved.reduce((s, i) => s + (i.profit ?? 0), 0);
    const withClv = items.filter(i => typeof i.clv === 'number');
    rows.push({
      esporte,
      market,
      apostas: items.length,
      resolvidas: resolved.length,
      semLedger: items.filter(i => i.missingLedger).length,
      winRate: resolved.length ? parseFloat((wins / resolved.length * 100).toFixed(1)) : null,
      stakeTotal: parseFloat(stakeTotal.toFixed(2)),
      lucro: parseFloat(profitTotal.toFixed(2)),
      roi: stakeTotal > 0 ? parseFloat((profitTotal / stakeTotal * 100).toFixed(1)) : null,
      clvMedio: withClv.length ? parseFloat((withClv.reduce((s, i) => s + i.clv, 0) / withClv.length).toFixed(2)) : null,
      clvComOdd: withClv.length,
    });
  }
  rows.sort((a, b) => a.esporte.localeCompare(b.esporte) || a.market.localeCompare(b.market));
  return { rows, manualWithoutIndication, unresolvedLinked, linked: linked.length };
}

function segmentSampleSize(esporte, market, allEntries) {
  // mesma contagem usada pela calibração: resolvidas, válidas, binárias.
  return allEntries.filter(e =>
    e.esporte === esporte && e.market === market && e.hasModelProb &&
    e.validForCalibration !== false && e.resolutionStatus === ledger.RESOLUTION_STATUS.RESOLVIDO &&
    e.result && isWinLoss(e)
  ).length;
}

async function main() {
  const all = loadAllEntries();
  const bets = await loadBets();
  const countable = all.filter(isCountable);
  const realBets = realBetRows(bets, all);

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
  lines.push('');
  lines.push('## Apostas reais');
  lines.push('');
  lines.push('Inclui só apostas registradas com identificador de indicação. Apostas manuais sem indicação de origem ficam fora desta visão e são sinalizadas abaixo.');
  lines.push('');
  lines.push(`Apostas sem indicação de origem: ${realBets.manualWithoutIndication}`);
  lines.push('');
  lines.push('| Esporte | Mercado | Apostas | Resolvidas | Taxa de acerto | Stake | Lucro | ROI | CLV médio | Sem ledger |');
  lines.push('|---|---|---|---|---|---|---|---|---|---|');
  for (const r of realBets.rows) {
    const clvCell = r.clvMedio === null ? '—' : `${fmt(r.clvMedio)}% (${r.clvComOdd}/${r.apostas})`;
    lines.push(`| ${r.esporte} | ${r.market} | ${r.apostas} | ${r.resolvidas} | ${fmt(r.winRate)}% | ${fmt(r.stakeTotal, 2)} | ${fmt(r.lucro, 2)} | ${r.roi === null ? '—' : fmt(r.roi) + '%'} | ${clvCell} | ${r.semLedger} |`);
  }
  if (!realBets.rows.length) lines.push('| _sem apostas rastreadas ainda_ | | | | | | | | | |');

  if (!fs.existsSync(ledger.HISTORY_DIR)) fs.mkdirSync(ledger.HISTORY_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, lines.join('\n') + '\n');
  fs.writeFileSync(OUT_JSON, JSON.stringify({ generatedAt, rows, realBets }, null, 2));
  console.log(`Relatório salvo em ${OUT_FILE} e ${OUT_JSON} — ${rows.length} grupo(s) esporte+mercado+faixa de edge.`);
}

main().catch(e => { console.error('Erro fatal em generate_report.js:', e); process.exit(1); });
