const fs = require('fs');
const path = require('path');

const admin = require('firebase-admin');
const ledger = require('./model_ledger');

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

const db = admin.firestore();

const ROOT = path.join(__dirname, '..');

const DOC_SPORT = {
  nba_h2h: 'basketball/nba',
  nba_props: 'basketball/nba',
  nba_props_br: 'basketball/nba',
  mlb_props: 'baseball/mlb',
  nhl_props: 'icehockey/nhl',
  nfl_props: 'americanfootball/nfl',
  tennis: 'tennis',
  tennis_props: 'tennis',
};

const SYNC_MAP = [
  { file: 'model_results.json',        col: 'results', doc: 'tennis' },
  { file: 'nba_results.json',          col: 'results', doc: 'nba_h2h' },
  { file: 'nba_props_results.json',    col: 'results', doc: 'nba_props' },
  { file: 'nba_props_br_results.json', col: 'results', doc: 'nba_props_br' },
  { file: 'mlb_props_results.json',    col: 'results', doc: 'mlb_props' },
  { file: 'nhl_props_results.json',    col: 'results', doc: 'nhl_props' },
  { file: 'nfl_props_results.json',    col: 'results', doc: 'nfl_props' },
  { file: 'tennis_props_results.json', col: 'results', doc: 'tennis_props' },
];

function loadPublishedFutureLedgerIndex(now = Date.now()) {
  const index = new Map();
  for (const file of ledger.listAllPartitions()) {
    for (const entry of ledger.loadPartitionFile(file)) {
      if (!entry.published) continue;
      if (entry.replacedBy || entry.unpublishedBySync) continue;
      const commence = new Date(entry.commenceTime).getTime();
      if (!Number.isFinite(commence) || commence <= now) continue;
      const id = entry.indicationId ?? entry._key ?? ledger.indicationId(entry);
      index.set(id, entry);
    }
  }
  return index;
}

function enrichFromLedger(item, docSport, ledgerIndex) {
  const id = ledger.indicationId({
    eventId: item.eventId ?? item.gameId ?? item.pinnacleId ?? `${item.game}|${item.commence_time}`,
    player: item.player ?? '',
    market: item.market ?? item.prop ?? (docSport === 'tennis' ? 'h2h' : ''),
    line: item.line ?? '',
    side: item.side ?? '',
  });
  const entry = ledgerIndex.get(id);
  if (!entry) return null;
  return {
    ...item,
    indicationId: id,
    ledgerKey: entry._key ?? id,
    sourceLedgerMonth: ledger.monthOf(entry.commenceTime),
    bookmaker: item.bookmaker ?? entry.bookmaker ?? '',
  };
}

function filterDisplayableResults(doc, data, ledgerIndex) {
  const sport = DOC_SPORT[doc];
  if (!sport) return data;
  return data.map(item => enrichFromLedger(item, sport, ledgerIndex)).filter(Boolean);
}

async function syncAll() {
  let synced = 0;
  let skipped = 0;
  const ledgerIndex = loadPublishedFutureLedgerIndex();

  for (const { file, col, doc } of SYNC_MAP) {
    const filePath = path.join(ROOT, file);
    if (!fs.existsSync(filePath)) {
      console.log(`  Pulando ${file} — não encontrado`);
      skipped++;
      continue;
    }

    try {
      const raw = JSON.parse(fs.readFileSync(filePath));
      const sourceData = Array.isArray(raw) ? raw : (raw.data || []);
      const data = filterDisplayableResults(doc, sourceData, ledgerIndex);
      const stat = fs.statSync(filePath);

      await db.collection(col).doc(doc).set({
        data,
        lastUpdated: stat.mtime.toISOString(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      console.log(`  ✅ ${file} → ${col}/${doc} (${data.length}/${sourceData.length} itens futuros rastreados)`);
      synced++;
    } catch (e) {
      console.error(`  ❌ Erro ao sincronizar ${file}:`, e.message);
    }
  }

  console.log(`\nSync concluído: ${synced} arquivos sincronizados, ${skipped} pulados.`);
}

async function syncBets() {
  const filePath = path.join(ROOT, 'bets.json');
  if (!fs.existsSync(filePath)) {
    console.log('  Pulando bets.json — não encontrado');
    return;
  }

  try {
    const bets = JSON.parse(fs.readFileSync(filePath));
    const batch = db.batch();

    for (const bet of bets) {
      const ref = db.collection('bets').doc(bet.id);
      batch.set(ref, bet);
    }

    await batch.commit();
    console.log(`  ✅ bets.json → bets (${bets.length} apostas)`);
  } catch (e) {
    console.error('  ❌ Erro ao sincronizar bets.json:', e.message);
  }
}

async function syncOddsHistory() {
  const histDir = path.join(ROOT, 'odds_snapshots');
  if (!fs.existsSync(histDir)) {
    console.log('  Pulando odds_snapshots — pasta não encontrada');
    return;
  }

  const files = fs.readdirSync(histDir).filter(f => f.endsWith('.json') && !f.startsWith('_'));
  let synced = 0;

  for (const file of files) {
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(histDir, file)));
      const baseId = file.replace('.json', '');

      const CHUNK = 300;
      if (raw.length <= CHUNK) {
        await db.collection('odds_history').doc(baseId).set({
          data: raw,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        synced++;
      } else {
        for (let i = 0; i * CHUNK < raw.length; i++) {
          const chunk = raw.slice(i * CHUNK, (i + 1) * CHUNK);
          const docId = `${baseId}_p${i}`;
          await db.collection('odds_history').doc(docId).set({
            data: chunk,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
          synced++;
        }
      }
    } catch (e) {
      console.error(`  ❌ Erro ao sincronizar odds_snapshots/${file}:`, e.message);
    }
  }

  console.log(`  ✅ odds_snapshots → Firestore/odds_history (${synced} documentos)`);
}

// Relatório de desempenho do modelo (odds_history/relatorio_desempenho.json)
// → coleção model_report, doc 'summary' (+ 'summary_p1', 'summary_p2'... se
// não couber num documento só). Cada execução SUBSTITUI a anterior por
// inteiro — sem acumular histórico de relatórios — e remove chunks extras
// que sobraram de uma execução anterior com mais linhas que a atual.
async function syncReport() {
  const filePath = path.join(ROOT, 'odds_history', 'relatorio_desempenho.json');
  if (!fs.existsSync(filePath)) {
    console.log('  Pulando relatório de desempenho — relatorio_desempenho.json não encontrado (rode generate_report.js primeiro)');
    return;
  }

  const CHUNK = 200;
  const MAX_CHUNKS_TO_CHECK = 20; // generoso o bastante pra nunca faltar limpeza

  try {
    const { generatedAt, rows } = JSON.parse(fs.readFileSync(filePath));
    const chunks = [];
    for (let i = 0; i < rows.length; i += CHUNK) chunks.push(rows.slice(i, i + CHUNK));
    if (!chunks.length) chunks.push([]); // sem linhas ainda — grava o doc mesmo assim, com data:[]

    for (let i = 0; i < chunks.length; i++) {
      const docId = i === 0 ? 'summary' : `summary_p${i}`;
      await db.collection('model_report').doc(docId).set({
        data: chunks[i],
        generatedAt,
        lastUpdated: generatedAt,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }

    // Remove chunks de uma execução anterior que não existem mais nesta.
    for (let i = chunks.length; i < MAX_CHUNKS_TO_CHECK; i++) {
      await db.collection('model_report').doc(`summary_p${i}`).delete().catch(() => {});
    }

    console.log(`  ✅ relatorio_desempenho.json → model_report (${rows.length} linha(s) em ${chunks.length} documento(s))`);
  } catch (e) {
    console.error('  ❌ Erro ao sincronizar relatório de desempenho:', e.message);
  }
}

async function main() {
  console.log('Iniciando sincronização com Firestore...\n');

  const args = process.argv.slice(2);
  const syncType = args[0] || 'all';

  if (syncType === 'all' || syncType === 'results') await syncAll();
  if (syncType === 'all' || syncType === 'bets') await syncBets();
  if (syncType === 'all' || syncType === 'history') await syncOddsHistory();
  if (syncType === 'all' || syncType === 'report') await syncReport();

  if (['nhl', 'nfl', 'tennis_props'].includes(syncType)) {
    const fileMap = {
      nhl:          { file: 'nhl_props_results.json',    col: 'results', doc: 'nhl_props' },
      nfl:          { file: 'nfl_props_results.json',    col: 'results', doc: 'nfl_props' },
      tennis_props: { file: 'tennis_props_results.json', col: 'results', doc: 'tennis_props' },
    };
    const entry = fileMap[syncType];
    const filePath = path.join(ROOT, entry.file);
    if (fs.existsSync(filePath)) {
      const raw = JSON.parse(fs.readFileSync(filePath));
      const data = Array.isArray(raw) ? raw : (raw.data || []);
      const stat = fs.statSync(filePath);
      await db.collection(entry.col).doc(entry.doc).set({
        data,
        lastUpdated: stat.mtime.toISOString(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      console.log(`  ✅ ${entry.file} → ${entry.col}/${entry.doc} (${data.length} itens)`);
    } else {
      console.log(`  Pulando ${entry.file} — não encontrado`);
    }
  }

  console.log('\nSincronização concluída.');
  process.exit(0);
}

main().catch(e => {
  console.error('Erro fatal:', e);
  process.exit(1);
});
