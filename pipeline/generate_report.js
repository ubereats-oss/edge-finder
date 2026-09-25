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
const FIRST_CLOSING_ODDS_CAPTURE_AT = '2026-09-06T20:22:20.000Z'; // f99781d
const JIT_CLOSING_ODDS_CAPTURE_AT = '2026-09-14T09:44:01.000Z'; // 374a2db
const SHARED_CLOSING_ODDS_STATUS_AT = '2026-09-24T17:27:34.000Z'; // 26a2385
const DATA_SAVE_DEPENDENCY_FIX_AT = '2026-09-25T01:42:16.000Z'; // be2ab14

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
    return { available: true, source: 'firestore', bets };
  }

  const file = path.join(__dirname, '..', 'bets.json');
  if (!fs.existsSync(file)) {
    return {
      available: false,
      source: null,
      bets: [],
      reason: 'FIREBASE_SERVICE_ACCOUNT ausente e bets.json não encontrado.',
    };
  }
  const raw = fs.readFileSync(file, 'utf8').trim();
  if (!raw) return { available: true, source: 'bets.json', bets: [] };
  try {
    const parsed = JSON.parse(raw);
    return { available: true, source: 'bets.json', bets: Array.isArray(parsed) ? parsed : [] };
  } catch (e) {
    console.warn(`Aviso: bets.json inválido — visão de apostas reais ignorada. ${e.message}`);
    return { available: false, source: 'bets.json', bets: [], reason: `bets.json inválido: ${e.message}` };
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

function missingClvReason(e) {
  if (typeof e.closingOdds === 'number') return null;
  if (!e.published) return 'indicacao_rejeitada_nao_publicada';

  const commence = new Date(e.commenceTime);
  const commenceIso = isNaN(commence.getTime()) ? null : commence.toISOString();
  if (!commenceIso) return 'evento_nao_encontrado';

  if (commenceIso >= '2026-09-24T23:30:00.000Z' && commenceIso < '2026-09-25T01:00:00.000Z') {
    return 'execucao_falha';
  }
  if (
    (commenceIso >= '2026-09-21T00:15:00.000Z' && commenceIso < '2026-09-21T00:25:00.000Z') ||
    (commenceIso >= '2026-09-22T00:10:00.000Z' && commenceIso < '2026-09-22T00:20:00.000Z')
  ) {
    return 'cota_api_esgotada_na_captura_pre_fix';
  }
  if (e.closingOddsMissingReason) return e.closingOddsMissingReason;
  if (e.closingOddsStatus === ledger.CLOSING_ODDS_STATUS.EXPIRADA) {
    return 'captura_expirada_sem_odd_gravada';
  }
  if (e.closingOddsStatus === ledger.CLOSING_ODDS_STATUS.PENDENTE) return 'captura_nao_disparou_na_janela';

  const created = new Date(e.runId ?? e.createdAt);
  const createdIso = isNaN(created.getTime()) ? null : created.toISOString();
  if (createdIso && createdIso < FIRST_CLOSING_ODDS_CAPTURE_AT) return 'registrada_antes_da_captura_existir';
  if (createdIso && createdIso < SHARED_CLOSING_ODDS_STATUS_AT) return 'registrada_antes_do_controle_de_status_da_captura';
  if (createdIso && createdIso < DATA_SAVE_DEPENDENCY_FIX_AT) return 'execucao_falha';

  return 'outro';
}

function missingClvReasons(entries) {
  const reasons = {};
  for (const e of entries) {
    const reason = missingClvReason(e);
    if (reason) reasons[reason] = (reasons[reason] ?? 0) + 1;
  }
  return reasons;
}

function clvCoverageCohort(e) {
  const created = new Date(e.runId ?? e.createdAt);
  const createdIso = isNaN(created.getTime()) ? null : created.toISOString();
  if (!createdIso) return 'sem_data_criacao';
  if (createdIso < FIRST_CLOSING_ODDS_CAPTURE_AT) return 'antes_primeira_captura';
  if (createdIso < JIT_CLOSING_ODDS_CAPTURE_AT) return 'captura_inicial_pre_jit';
  if (createdIso < SHARED_CLOSING_ODDS_STATUS_AT) return 'jit_pre_controle_status';
  if (createdIso < DATA_SAVE_DEPENDENCY_FIX_AT) return 'controle_status_pre_fix_dependencia';
  return 'apos_fix_dependencia_be2ab14';
}

function clvCoverageRows(entries) {
  const groups = new Map();
  for (const e of entries) {
    const cohort = clvCoverageCohort(e);
    if (!groups.has(cohort)) {
      groups.set(cohort, {
        cohort,
        nPublicadasResolvidas: 0,
        clvExato: 0,
        clvAjustado: 0,
        clvTotal: 0,
        semClv: 0,
        clvCoveragePct: null,
        semClvMotivos: {},
      });
    }
    const row = groups.get(cohort);
    row.nPublicadasResolvidas++;
    if (typeof e.clv === 'number') {
      row.clvExato++;
      row.clvTotal++;
    } else if (typeof e.lineAdjustedClv === 'number') {
      row.clvAjustado++;
      row.clvTotal++;
    } else {
      row.semClv++;
      const reason = missingClvReason(e);
      if (reason) row.semClvMotivos[reason] = (row.semClvMotivos[reason] ?? 0) + 1;
    }
  }
  for (const row of groups.values()) {
    row.clvCoveragePct = row.nPublicadasResolvidas
      ? parseFloat((row.clvTotal / row.nPublicadasResolvidas * 100).toFixed(1))
      : null;
  }
  return [...groups.values()];
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
  const betsLoad = await loadBets();
  const countable = all.filter(isCountable);
  const clvCoverage = clvCoverageRows(countable);
  const realBets = betsLoad.available
    ? realBetRows(betsLoad.bets, all)
    : { rows: [], manualWithoutIndication: 0, unresolvedLinked: 0, linked: 0, unavailable: true, reason: betsLoad.reason };

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
    const withRawProb = entries.filter(e => typeof e.rawProb === 'number');
    const winRateModeloBruto = withRawProb.length ? withRawProb.reduce((s, e) => s + e.rawProb, 0) / withRawProb.length : null;
    const lucro = entries.reduce((s, e) => s + profitUnits(e), 0);
    const stakeTotal = entries.reduce((s, e) => s + (typeof e.kelly === 'number' ? e.kelly : 0), 0);
    const roi = stakeTotal > 0 ? (lucro / stakeTotal) * 100 : null;
    const comClv = entries.filter(e => typeof e.clv === 'number');
    const comClvAjustado = entries.filter(e => typeof e.lineAdjustedClv === 'number');
    const comClvTotal = entries.filter(e => typeof e.clv === 'number' || typeof e.lineAdjustedClv === 'number');
    const movimentosComLinha = entries.filter(e => e.closingLineMovement);
    const movimentosFavor = movimentosComLinha.filter(e => e.closingLineMovement === 'a_favor');
    const clvMedio = comClv.length ? comClv.reduce((s, e) => s + e.clv, 0) / comClv.length : null;
    const clvAjustadoMedio = comClvAjustado.length ? comClvAjustado.reduce((s, e) => s + e.lineAdjustedClv, 0) / comClvAjustado.length : null;
    const semClv = entries.length - comClvTotal.length;

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
      winRateModeloBruto: winRateModeloBruto === null ? null : parseFloat(winRateModeloBruto.toFixed(1)),
      roi: roi === null ? null : parseFloat(roi.toFixed(1)),
      clvMedio: clvMedio === null ? null : parseFloat(clvMedio.toFixed(2)),
      clvComOdd: comClv.length,
      clvAjustadoMedio: clvAjustadoMedio === null ? null : parseFloat(clvAjustadoMedio.toFixed(2)),
      clvComLinhaAjustada: comClvAjustado.length,
      clvCoberturaTotal: comClvTotal.length,
      movimentoLinhaTotal: movimentosComLinha.length,
      movimentoLinhaFavor: movimentosFavor.length,
      movimentoLinhaFavorPct: movimentosComLinha.length ? parseFloat((movimentosFavor.length / movimentosComLinha.length * 100).toFixed(1)) : null,
      semClv,
      clvCoveragePct: entries.length ? parseFloat((comClvTotal.length / entries.length * 100).toFixed(1)) : null,
      clvExactCoveragePct: entries.length ? parseFloat((comClv.length / entries.length * 100).toFixed(1)) : null,
      clvAdjustedCoveragePct: entries.length ? parseFloat((comClvAjustado.length / entries.length * 100).toFixed(1)) : null,
      semClvMotivos: missingClvReasons(entries),
      minSampleToCalibrate: riskConfig.MIN_SAMPLE_TO_CALIBRATE,
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
  lines.push('| Esporte | Mercado | Faixa de edge | Nº resolvidas válidas | Taxa de acerto real | Taxa prevista calibrada | ROI | CLV médio | Estado do segmento | Faltam p/ calibrar |');
  lines.push('|---|---|---|---|---|---|---|---|---|---|');
  for (const r of rows) {
    const clvCell = r.clvMedio === null ? '—' : `${fmt(r.clvMedio)}% (${r.clvComOdd}/${r.nResolvidasValidas} exata)`;
    const clvAdjustedCell = r.clvAjustadoMedio === null ? '—' : `${fmt(r.clvAjustadoMedio)}% (${r.clvComLinhaAjustada}/${r.nResolvidasValidas} ajustada)`;
    const movementCell = r.movimentoLinhaFavorPct === null ? '—' : `${fmt(r.movimentoLinhaFavorPct)}% (${r.movimentoLinhaFavor}/${r.movimentoLinhaTotal})`;
    const modelCell = r.winRateModeloBruto === null ? `${fmt(r.winRateModelo)}%` : `${fmt(r.winRateModelo)}% (bruta ${fmt(r.winRateModeloBruto)}%)`;
    lines.push(`| ${r.esporte} | ${r.market} | ${r.edgeBucket} | ${r.nResolvidasValidas} | ${fmt(r.winRateReal)}% (${r.nBinarias} decididas) | ${modelCell} | ${r.roi === null ? '—' : fmt(r.roi) + '%'} | ${clvCell}; ajustado ${clvAdjustedCell}; mov. favor ${movementCell} | ${r.segmentState} | ${r.faltamParaCalibrar} |`);
  }
  if (!rows.length) lines.push('| _sem dados ainda_ | | | | | | | | | |');
  lines.push('');
  lines.push('## Cobertura de CLV por coorte');
  lines.push('');
  lines.push('| Coorte de criação | Publicadas resolvidas | CLV exato | CLV ajustado | Cobertura total | Sem CLV por motivo |');
  lines.push('|---|---|---|---|---|---|');
  for (const r of clvCoverage) {
    const reasons = Object.entries(r.semClvMotivos).map(([k, v]) => `${k}: ${v}`).join('; ') || '—';
    lines.push(`| ${r.cohort} | ${r.nPublicadasResolvidas} | ${r.clvExato} | ${r.clvAjustado} | ${fmt(r.clvCoveragePct)}% | ${reasons} |`);
  }
  if (!clvCoverage.length) lines.push('| _sem dados ainda_ | | | | |');
  lines.push('');
  lines.push('## Apostas reais');
  lines.push('');
  lines.push('Inclui só apostas registradas com identificador de indicação. Apostas manuais sem indicação de origem ficam fora desta visão e são sinalizadas abaixo.');
  lines.push('');
  if (realBets.unavailable) {
    lines.push(`Visão indisponível: ${realBets.reason}`);
  } else {
    lines.push(`Fonte: ${betsLoad.source}`);
    lines.push(`Apostas sem indicação de origem: ${realBets.manualWithoutIndication}`);
  }
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
  fs.writeFileSync(OUT_JSON, JSON.stringify({ generatedAt, rows, clvCoverage, realBets }, null, 2));
  console.log(`Relatório salvo em ${OUT_FILE} e ${OUT_JSON} — ${rows.length} grupo(s) esporte+mercado+faixa de edge.`);
}

main().catch(e => { console.error('Erro fatal em generate_report.js:', e); process.exit(1); });
