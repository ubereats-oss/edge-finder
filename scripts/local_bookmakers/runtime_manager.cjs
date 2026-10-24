// Bootstrap uses only Node built-ins, so updates cannot break its dependencies.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync, spawn } = require('node:child_process');
const { acquire, trackChild } = require('./resource_lock.cjs');
const files = require('./safe_files.cjs');
function envFrom(file) {
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const at = line.indexOf('='); if (at > 0) process.env[line.slice(0, at).trim()] = line.slice(at + 1).trim();
  }
}
function command(exe, args, options = {}) {
  const result = spawnSync(exe, args, { encoding: 'utf8', windowsHide: true, timeout: 300000, ...options });
  if (result.error || result.status !== 0) throw new Error(`${path.basename(exe)}: ${result.error?.message || result.stderr || result.stdout}`);
  return result.stdout.trim();
}
function update(runtimeRoot, log, execute = command) {
  const pointer = path.join(runtimeRoot, 'current.json');
  const prior = fs.existsSync(pointer) ? JSON.parse(fs.readFileSync(pointer, 'utf8')) : null;
  try {
    if (!process.env.GITHUB_TOKEN) throw new Error('GITHUB_TOKEN ausente para atualizar a cópia.');
    const source = path.join(runtimeRoot, 'source.git');
    if (!fs.existsSync(source)) execute('git', ['init', '--bare', source]);
    const env = { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'http.https://github.com/.extraheader',
      GIT_CONFIG_VALUE_0: 'AUTHORIZATION: basic ' + Buffer.from('x-access-token:' + process.env.GITHUB_TOKEN).toString('base64') };
    execute('git', ['--git-dir', source, 'fetch', '--depth=1', 'https://github.com/ubereats-oss/edge-finder.git', 'main'], { env });
    const sha = execute('git', ['--git-dir', source, 'rev-parse', 'FETCH_HEAD']);
    if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error('SHA publicado inválido.');
    const release = path.join(runtimeRoot, 'releases', sha);
    if (!fs.existsSync(path.join(release, '.ready'))) {
      fs.mkdirSync(release, { recursive: true });
      const archive = path.join(runtimeRoot, `${sha}.tar`);
      execute('git', ['--git-dir', source, 'archive', '--format=tar', '--output', archive, sha]);
      execute('tar', ['-xf', archive, '-C', release]); fs.unlinkSync(archive);
      const signature = crypto.createHash('sha256').update(fs.readFileSync(path.join(release, 'package.json')))
        .update(fs.readFileSync(path.join(release, 'package-lock.json'))).digest('hex');
      const deps = path.join(runtimeRoot, 'dependencies', signature);
      if (!fs.existsSync(path.join(deps, '.ready'))) {
        fs.mkdirSync(deps, { recursive: true });
        for (const name of ['package.json', 'package-lock.json']) fs.copyFileSync(path.join(release, name), path.join(deps, name));
        execute('cmd.exe', ['/d', '/s', '/c', 'npm ci --omit=dev --ignore-scripts --no-audit --no-fund'], { cwd: deps });
        for (const module of ['firebase-admin', 'playwright', 'cheerio']) require.resolve(module, { paths: [deps] });
        fs.writeFileSync(path.join(deps, '.ready'), signature);
      }
      // Load from the isolated dependency cache directly. No Windows junction:
      // a junction can exist yet fail traversal in this host environment.
      const dependencies = path.join(deps, 'node_modules');
      execute(process.execPath, ['-e', 'require(process.argv[1]);', path.join(release, 'pipeline/local_betano_reader.js')],
        { cwd: release, env: { ...process.env, NODE_PATH: dependencies } });
      execute(process.execPath, ['--check', path.join(release, 'pipeline', 'local_bookmaker_cycle_fast.cjs')]);
      fs.writeFileSync(path.join(release, '.ready'), JSON.stringify({ sha, dependencies }));
    }
    const ready = JSON.parse(fs.readFileSync(path.join(release, '.ready'), 'utf8'));
    const active = { sha, release, dependencies: ready.dependencies };
    files.atomic(pointer, JSON.stringify(active)); log({ status: 'updated', ...active });
    return active;
  } catch (error) {
    log({ status: 'update_failed', error: error.message, fallback: prior?.sha || null });
    if (!prior?.dependencies || !fs.existsSync(path.join(prior.release, '.ready'))) throw error;
    return prior;
  }
}
async function main() {
  const args = process.argv.slice(2);
  const option = name => args[args.indexOf(name) + 1];
  const dataRoot = option('--data-root'), runtimeRoot = option('--runtime-root');
  if (!dataRoot || !runtimeRoot) throw new Error('Informe --data-root e --runtime-root.');
  process.env.EDGE_DATA_ROOT = path.resolve(dataRoot);
  process.env.EDGE_ENV_FILE = path.join(dataRoot, '.env');
  envFrom(process.env.EDGE_ENV_FILE);
  process.env.EDGE_DATA_ROOT = path.resolve(dataRoot);
  process.env.EDGE_ENV_FILE = path.join(dataRoot, '.env');
  fs.mkdirSync(runtimeRoot, { recursive: true });
  const logDir = path.join(dataRoot, '.local_logs', 'betano'); fs.mkdirSync(logDir, { recursive: true });
  const log = row => files.appendFileSync(path.join(logDir, 'runtime-updates.jsonl'), JSON.stringify({ at: new Date().toISOString(), ...row }) + '\n');
  const releaseLock = await acquire(dataRoot);
  if (!releaseLock) {
    const at = new Date().toISOString();
    const skipped = { at, status: 'ciclo pulado', reason: 'trava ocupada após esperar 5 minutos', houses: {}, totalDurationMs: 300000, vpnDurationMs: 0 };
    files.appendFileSync(path.join(logDir, 'hourly-cycles.jsonl'), JSON.stringify(skipped) + '\n');
    log(skipped); return;
  }
  try {
    const active = update(runtimeRoot, log);
    if (args.includes('--prepare-only')) { console.log(JSON.stringify(active)); return; }
    process.env.EDGE_RUNTIME_SHA = active.sha;
    process.env.NODE_PATH = active.dependencies;
    console.log(JSON.stringify({ runtime: active, dataRoot }));
    const code = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [path.join(active.release, 'pipeline', 'local_betano_reader.js')],
        { cwd: active.release, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
      if (child.pid) trackChild(dataRoot, child.pid);
      for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => {
        files.appendFileSync(path.join(logDir, 'task-output.log'), chunk.toString()); process.stdout.write(chunk);
      });
      child.on('error', reject); child.on('exit', value => resolve(value ?? 1));
    });
    if (code) throw new Error(`Ciclo da cópia terminou com exit=${code}.`);
  } finally { releaseLock(); }
}
module.exports = { update, command };
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
