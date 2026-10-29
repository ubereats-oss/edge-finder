// Keep the scheduled action, and collect from a published isolated release.
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { acquire, trackChild, defaultDataRoot } = require('./resource_lock.cjs');
const runtime = require('./runtime_manager.cjs');
async function waitForChildren(dataRoot) {
  const owner = JSON.parse(fs.readFileSync(path.join(dataRoot, '.local_logs', 'local-cycle.lock'), 'utf8'));
  if (owner.token !== process.env.EDGE_CYCLE_LOCK_TOKEN) throw new Error('Reserva da coleta divergente.');
  for (;;) {
    const live = (owner.children || []).some(pid => {
      try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; }
    });
    if (!live) return;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
}
async function main() {
  const dataRoot = defaultDataRoot();
  process.env.EDGE_DATA_ROOT = dataRoot;
  process.env.EDGE_ENV_FILE = path.join(dataRoot, '.env');
  for (const line of fs.readFileSync(process.env.EDGE_ENV_FILE, 'utf8').split(/\r?\n/)) {
    const at = line.indexOf('=');
    if (at > 0) process.env[line.slice(0, at).trim()] = line.slice(at + 1).trim();
  }
  process.env.EDGE_DATA_ROOT = dataRoot;
  process.env.EDGE_ENV_FILE = path.join(dataRoot, '.env');
  const release = await acquire(dataRoot);
  if (!release) throw new Error('Ciclo pulado: trava ocupada após 5 minutos.');
  try {
    const logDir = path.join(dataRoot, '.local_logs', 'betano');
    const log = row => fs.appendFileSync(path.join(logDir, 'runtime-updates.jsonl'), JSON.stringify({ at: new Date().toISOString(), ...row }) + '\n');
    const runtimeRoot = path.join(process.env.LOCALAPPDATA, 'EdgeFinder', 'local-runtime');
    const active = runtime.update(runtimeRoot, log,
      (exe, args, options = {}) => runtime.command(exe, args, { ...options, timeout: 240000 }));
    process.env.NODE_PATH = active.dependencies;
    process.env.EDGE_RUNTIME_SHA = active.sha;
    const code = await new Promise((resolve, reject) => {
      const child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
        path.join(__dirname, 'background_host.ps1'), '-ReleaseRoot', active.release],
      { windowsHide: true, stdio: 'inherit' });
      if (child.pid) trackChild(dataRoot, child.pid);
      child.on('error', reject); child.on('exit', value => resolve(value ?? 1));
    });
    if (code) throw new Error(`Coletor no desktop oculto terminou com exit=${code}.`);
  } finally { await waitForChildren(dataRoot); release(); }
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { main };
