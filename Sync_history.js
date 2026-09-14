const fs     = require('fs');
const path   = require('path');
const { execSync } = require('child_process');

// Lê .env
for (const line of fs.readFileSync('.env', 'utf-8').split('\n')) {
  const [k, ...v] = line.split('=');
  if (k) process.env[k.trim()] = v.join('=').trim();
}

const GITHUB_REPO = process.env.GITHUB_REPO;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const HISTORY_DIR = path.join(__dirname, 'odds_snapshots');

if (!GITHUB_TOKEN || !GITHUB_REPO) {
  console.error('ERRO: GITHUB_TOKEN e GITHUB_REPO devem estar no .env');
  process.exit(1);
}

function readJson(filePath) {
  if (!fs.existsSync(filePath)) return [];
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch { return []; }
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function mergeDir(sourceDir) {
  const files = fs.readdirSync(sourceDir).filter(f => f.endsWith('.json') && !f.startsWith('_'));
  let totalAdded = 0;

  for (const f of files) {
    const newRecords = readJson(path.join(sourceDir, f));
    if (!newRecords.length) continue;

    const destFile = path.join(HISTORY_DIR, f);
    const existing = readJson(destFile);
    const existingKeys = new Set(existing.map(e => e._key));

    let added = 0;
    for (const r of newRecords) {
      if (!r._key || existingKeys.has(r._key)) continue;
      existing.push(r);
      existingKeys.add(r._key);
      added++;
    }

    if (added > 0) {
      writeJson(destFile, existing);
      console.log(`  ${f}: +${added} registros`);
      totalAdded += added;
    }
  }
  return totalAdded;
}

async function main() {
  console.log('\n[sync_history] Sincronizando histórico do GitHub...');

  const tmpDir = path.join(__dirname, '_sync_tmp');
  if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true });
  fs.mkdirSync(tmpDir);

  try {
    // Baixa o tar.gz da branch history
    const url = `https://raw.githubusercontent.com/${GITHUB_REPO}/history/odds_history.tar.gz`;
    execSync(
      `curl -sL -H "Authorization: Bearer ${GITHUB_TOKEN}" "${url}" -o "${path.join(tmpDir, 'odds_history.tar.gz')}"`,
      { stdio: 'pipe' }
    );

    const tarFile = path.join(tmpDir, 'odds_history.tar.gz');
    if (!fs.existsSync(tarFile) || fs.statSync(tarFile).size < 100) {
      console.log('Sem histórico na nuvem ainda ou branch history não existe.');
      return;
    }

    // Extrai
    const extractDir = path.join(tmpDir, 'extracted');
    fs.mkdirSync(extractDir);
    execSync(`tar -xzf "${tarFile}" -C "${extractDir}"`, { stdio: 'pipe' });

    const histDir = path.join(extractDir, 'odds_snapshots');
    if (!fs.existsSync(histDir)) {
      console.log('Pasta odds_snapshots não encontrada no arquivo.');
      return;
    }

    if (!fs.existsSync(HISTORY_DIR)) fs.mkdirSync(HISTORY_DIR);
    const total = mergeDir(histDir);
    console.log(`\nTotal adicionado ao histórico local: ${total} registros`);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

main().catch(e => { console.error('ERRO:', e.message); process.exit(1); });