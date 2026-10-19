// pipeline/generate_pt_value_report.js
// Relatório "Valor real nas casas que posso usar" — por casa PT, esporte e
// mercado: % de conferências com odd igual ou acima da mínima de valor, CLV
// médio (contra o fechamento da Pinnacle) com IC95%, e nº de amostras.
//
// Fonte: TODAS as conferências gravadas pela tela "Conferir odds" (coleção
// Firestore odds_checks — inclui as que nunca viraram aposta, necessárias
// pra medir a % acima da mínima) + o histórico central de indicações, só as
// entradas com source:'pt_odds_check' (apostas de fato marcadas como feitas
// e já sincronizadas — único jeito de ter CLV real, que depende da odd de
// fechamento capturada pelo mecanismo existente).
//
// Uso: node pipeline/generate_pt_value_report.js
// Grava odds_history/relatorio_valor_pt.md e .json.

const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');
const ledger = require('./model_ledger');

const OUT_FILE = path.join(ledger.HISTORY_DIR, 'relatorio_valor_pt.md');
const OUT_JSON = path.join(ledger.HISTORY_DIR, 'relatorio_valor_pt.json');
const IC95_Z = 1.96;
// Única conta autorizada a usar o app (login Google) — ver lib/auth_config.dart.
const OWNER_EMAIL = 'sallesconsultant@gmail.com';

function mean(values) { return values.reduce((s, v) => s + v, 0) / values.length; }

function ci95(values) {
  const n = values.length;
  if (n < 2) return { lower: null, upper: null };
  const m = mean(values);
  const variancia = values.reduce((s, v) => s + (v - m) ** 2, 0) / (n - 1);
  const erroPadrao = Math.sqrt(variancia) / Math.sqrt(n);
  return { lower: m - IC95_Z * erroPadrao, upper: m + IC95_Z * erroPadrao };
}

async function loadChecks() {
  if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
    console.log('FIREBASE_SERVICE_ACCOUNT ausente — relatório de valor PT ficará vazio.');
    return [];
  }
  if (!admin.apps.length) {
    admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
  }
  const db = admin.firestore();
  const snap = await db.collection('odds_checks').get();
  return snap.docs.map(d => d.data());
}

function loadPtLedgerEntries() {
  const entries = [];
  for (const file of ledger.listAllPartitions()) {
    for (const e of ledger.loadPartitionFile(file)) {
      if (e.source === 'pt_odds_check') entries.push(e);
    }
  }
  return entries;
}

// Pura (sem I/O) — por isso testável sem Firebase nem histórico central
// reais: dado o array de conferências (odds_checks) e de entradas do ledger
// já filtradas por source:'pt_odds_check', devolve as linhas do relatório.
function computeRows(checks, ledgerEntries) {
  // indicationId -> entrada do ledger (pra achar CLV de uma conferência marcada como feita)
  const byIndicationId = new Map();
  for (const e of ledgerEntries) {
    const id = e.indicationId ?? e._key;
    if (id) byIndicationId.set(id, e);
  }

  const groups = new Map(); // `${bookmaker}|${esporte}|${market}` -> checks[]
  for (const c of checks) {
    if (!c.bookmaker || !c.esporte || !c.market) continue;
    const key = `${c.bookmaker}|${c.esporte}|${c.market}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(c);
  }

  const rows = [];
  for (const [key, groupChecks] of groups) {
    const [bookmaker, esporte, market] = key.split('|');
    const nConferencias = groupChecks.length;
    const acimaMinimo = groupChecks.filter(c =>
      typeof c.oddDigitada === 'number' && typeof c.minValueOdds === 'number' && c.oddDigitada >= c.minValueOdds
    );

    const clvValues = [];
    for (const c of groupChecks) {
      if (!c.apostaFeita) continue;
      const id = ledger.indicationId({ eventId: c.eventId, player: c.player, market: c.market, line: c.line, side: c.side });
      const entry = byIndicationId.get(id);
      if (entry && typeof entry.clv === 'number') clvValues.push(entry.clv);
    }
    const { lower, upper } = ci95(clvValues);

    rows.push({
      bookmaker, esporte, market,
      nConferencias,
      nAcimaMinimo: acimaMinimo.length,
      pctAcimaMinimo: nConferencias ? parseFloat((acimaMinimo.length / nConferencias * 100).toFixed(1)) : null,
      clvMedio: clvValues.length ? parseFloat(mean(clvValues).toFixed(2)) : null,
      clvIc95Lower: lower === null ? null : parseFloat(lower.toFixed(2)),
      clvIc95Upper: upper === null ? null : parseFloat(upper.toFixed(2)),
      nAmostrasClv: clvValues.length,
    });
  }

  rows.sort((a, b) => a.bookmaker.localeCompare(b.bookmaker) || a.esporte.localeCompare(b.esporte) || a.market.localeCompare(b.market));
  return rows;
}

function renderMarkdown(rows, generatedAt) {
  const fmt = (n, d = 1) => n === null || n === undefined ? '—' : n.toFixed(d);
  const lines = [];
  lines.push('# Valor real nas casas que posso usar');
  lines.push('');
  lines.push(`Gerado em: ${generatedAt}`);
  lines.push('');
  lines.push('Por casa portuguesa + esporte + mercado, a partir de toda conferência feita na tela "Conferir odds". CLV só existe pra conferências marcadas como aposta feita, sincronizadas e com odd de fechamento da Pinnacle já capturada.');
  lines.push('');
  lines.push('| Casa | Esporte | Mercado | Conferências | % ≥ odd mínima | CLV médio | IC95% | N (CLV) |');
  lines.push('|---|---|---|---|---|---|---|---|');
  for (const r of rows) {
    const clvCell = r.clvMedio === null ? '—' : `${fmt(r.clvMedio, 2)}%`;
    const icCell = (r.clvIc95Lower === null) ? '—' : `${fmt(r.clvIc95Lower, 2)}% a ${fmt(r.clvIc95Upper, 2)}%`;
    lines.push(`| ${r.bookmaker} | ${r.esporte} | ${r.market} | ${r.nConferencias} | ${r.pctAcimaMinimo === null ? '—' : fmt(r.pctAcimaMinimo) + '%'} | ${clvCell} | ${icCell} | ${r.nAmostrasClv} |`);
  }
  if (!rows.length) lines.push('| _sem conferências ainda_ | | | | | | | |');
  return lines.join('\n') + '\n';
}

async function main() {
  const allChecks = await loadChecks();
  const checks = allChecks.filter(c => c.ownerEmail === OWNER_EMAIL);
  const descartadas = allChecks.length - checks.length;
  if (descartadas > 0) {
    console.log(`${descartadas} conferência(s) de outro dono (ownerEmail != ${OWNER_EMAIL}) descartada(s) do relatório.`);
  }
  const ledgerEntries = loadPtLedgerEntries();
  const rows = computeRows(checks, ledgerEntries);
  const generatedAt = new Date().toISOString();

  if (!fs.existsSync(ledger.HISTORY_DIR)) fs.mkdirSync(ledger.HISTORY_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, renderMarkdown(rows, generatedAt));
  fs.writeFileSync(OUT_JSON, JSON.stringify({ generatedAt, rows }, null, 2));
  console.log(`Relatório de valor PT salvo — ${rows.length} grupo(s) casa+esporte+mercado.`);
}

module.exports = { computeRows, renderMarkdown, ci95, mean };

if (require.main === module) {
  main().catch(e => { console.error('ERRO FATAL:', e.message); process.exit(1); });
}
