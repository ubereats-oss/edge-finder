const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const defaultDataRoot = () => process.env.EDGE_DATA_ROOT || path.join(require('node:os').homedir(), 'Apps - desenvolvimento', 'odds_app');
const { spawn } = require('node:child_process');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const alive = pid => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
const ownerAlive = owner => alive(owner.pid) || (owner.children || []).some(alive);
function inherited(file) {
  try { const owner = JSON.parse(fs.readFileSync(file, 'utf8'));
    return owner.token === process.env.EDGE_CYCLE_LOCK_TOKEN && ownerAlive(owner); } catch { return false; }
}
function trackChild(dataRoot, pid) {
  const file = path.join(dataRoot, '.local_logs', 'local-cycle.lock');
  const owner = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (owner.token !== process.env.EDGE_CYCLE_LOCK_TOKEN) throw new Error('Trava de recursos não pertence ao executor.');
  owner.children = [...new Set([...(owner.children || []), pid])];
  fs.writeFileSync(file, JSON.stringify(owner));
}
async function acquire(dataRoot, timeout = 300000) {
  const dir = path.join(dataRoot, '.local_logs'); fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'local-cycle.lock');
  if (inherited(file)) return () => {};
  const end = Date.now() + timeout;
  for (;;) {
    const token = crypto.randomUUID();
    try {
      const fd = fs.openSync(file, 'wx');
      fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, token, at: new Date().toISOString() })); fs.closeSync(fd);
      const oldToken = process.env.EDGE_CYCLE_LOCK_TOKEN;
      process.env.EDGE_CYCLE_LOCK_TOKEN = token;
      return () => { try { const row = JSON.parse(fs.readFileSync(file, 'utf8')); if (row.token === token) fs.unlinkSync(file); }
        finally { if (oldToken) process.env.EDGE_CYCLE_LOCK_TOKEN = oldToken; else delete process.env.EDGE_CYCLE_LOCK_TOKEN; } };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      // Serialize stale-owner recovery; never remove a live owner's lock.
      const guard = file + '.recovery';
      let guarding = false;
      try {
        fs.mkdirSync(guard); guarding = true;
        const owner = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (!ownerAlive(owner)) { fs.unlinkSync(file); continue; }
      } catch { /* initializing/live/unknown lock: wait safely */ }
      finally { if (guarding) fs.rmdirSync(guard); }
      if (Date.now() >= end) return null;
      await sleep(Math.min(250, Math.max(1, end - Date.now())));
    }
  }
}
async function run(dataRoot, command, args) {
  const release = await acquire(dataRoot);
  if (!release) return 75;
  try { return await new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', windowsHide: true });
    if (child.pid) trackChild(dataRoot, child.pid);
    child.on('error', reject); child.on('exit', code => resolve(code ?? 1));
  }); } finally { release(); }
}
module.exports = { acquire, inherited, run, trackChild, defaultDataRoot };
if (require.main === module) {
  const at = process.argv.indexOf('--');
  const root = defaultDataRoot();
  process.env.EDGE_DATA_ROOT = root;
  if (at < 0) throw new Error('Use resource_lock.cjs -- comando argumentos');
  run(root, process.argv[at + 1], process.argv.slice(at + 2)).then(code => process.exitCode = code)
    .catch(error => { console.error(error.message); process.exitCode = 1; });
}
