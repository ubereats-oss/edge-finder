const fs = require('fs');
const path = require('path');

const admin = require('firebase-admin');

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

const db = admin.firestore();

const ROOT = path.join(__dirname, '..');

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

async function syncAll() {
  let synced = 0;
  let skipped = 0;

  for (const { file, col, doc } of SYNC_MAP) {
    const filePath = path.join(ROOT, file);
    if (!fs.existsSync(filePath)) {
      console.log(`  Pulando ${file} — não encontrado`);
      skipped++;
      continue;
    }

    try {
      const raw = JSON.parse(fs.readFileSync(filePath));
      const data = Array.isArray(raw) ? raw : (raw.data || []);
      const stat = fs.statSync(filePath);

      await db.collection(col).doc(doc).set({
        data,
        lastUpdated: stat.mtime.toISOString(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      console.log(`  ✅ ${file} → ${col}/${doc} (${data.length} itens)`);
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
  const histDir = path.join(ROOT, 'odds_history');
  if (!fs.existsSync(histDir)) {
    console.log('  Pulando odds_history — pasta não encontrada');
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
      console.error(`  ❌ Erro ao sincronizar odds_history/${file}:`, e.message);
    }
  }

  console.log(`  ✅ odds_history → Firestore (${synced} documentos)`);
}

async function main() {
  console.log('Iniciando sincronização com Firestore...\n');

  const args = process.argv.slice(2);
  const syncType = args[0] || 'all';

  if (syncType === 'all' || syncType === 'results') await syncAll();
  if (syncType === 'all' || syncType === 'bets') await syncBets();
  if (syncType === 'all' || syncType === 'history') await syncOddsHistory();

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