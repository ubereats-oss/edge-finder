const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const safe = require('./safe_files.cjs');
const { acquire } = require('./resource_lock.cjs');
const { authenticate } = require('../../pipeline/local_betano_reader.js');
const { runTunnel } = require('./tunnel_runner.cjs');
const { operatorIssue, actions } = require('../../functions/local_operator_alerts.js');
const { budgetAlerts } = require('../../functions/budget_alerts.js');
const { compactCycle } = require('./cloud_cycle_queue.cjs');
const { update } = require('./runtime_manager.cjs');
const directory = () => fs.mkdtempSync(path.join(os.tmpdir(), 'edge-resilience-'));

test('trava comum: concorrente espera e pula; processo morto é recuperado', async () => {
  const root = directory(); const release = await acquire(root, 0);
  const code = 'require(process.argv[1]).acquire(process.argv[2],100).then(r=>{if(r){r();process.exit(1)}else process.exit(0)})';
  const env = { ...process.env }; delete env.EDGE_CYCLE_LOCK_TOKEN;
  const child = spawnSync(process.execPath, ['-e', code, path.join(__dirname, 'resource_lock.cjs'), root], { env });
  assert.equal(child.status, 0); release();
  fs.writeFileSync(path.join(root, '.local_logs/local-cycle.lock'), JSON.stringify({ pid: 2147483647, token: 'dead' }));
  const again = await acquire(root, 100); assert.equal(typeof again, 'function'); again();
});
test('backup validado restaura orçamento corrompido e não aceita backup corrupto', () => {
  const file = path.join(directory(), 'vpn-budget.json');
  const budget = { carriedForwardMB: 818, measuredMB: 1, adapterCycles: [{ bytes: 1000000 }] };
  safe.saveBudget(file, budget); fs.writeFileSync(file, '{broken');
  let notice; assert.deepEqual(safe.readBudget(file, value => notice = value), budget);
  assert.match(notice, /restaurado/); assert.deepEqual(JSON.parse(fs.readFileSync(file)), budget);
  fs.writeFileSync(file, '{broken'); fs.writeFileSync(file + '.backup', '{}');
  assert.throws(() => safe.readBudget(file), /backup indisponíveis/);
});
test('log bloqueado usa alternativo sem derrubar; temporariamente bloqueado é repetido', async () => {
  const root = directory(), file = path.join(root, 'resumo.txt'), ready = path.join(root, 'ready');
  fs.writeFileSync(file, 'original');
  const code = "$h=[IO.File]::Open($args[0],[IO.FileMode]::Open,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None);[IO.File]::WriteAllText($args[1],'ready');try{Start-Sleep -Seconds 5}finally{$h.Dispose()}";
  const script = path.join(root, 'hold.ps1'); fs.writeFileSync(script, code);
  const child = spawn('powershell.exe', ['-NoProfile', '-File', script, file, ready], { windowsHide: true, stdio: 'ignore' });
  try {
    const deadline = Date.now() + 5000;
    while (!fs.existsSync(ready) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 50));
    assert.ok(fs.existsSync(ready));
    const alternate = safe.writeFileSync(file, 'new summary');
    assert.match(alternate, /alternate/); assert.equal(fs.readFileSync(alternate, 'utf8'), 'new summary');
    assert.ok(fs.existsSync(alternate + '.notice.json'));
  } finally { child.kill(); }
  let calls = 0;
  assert.equal(safe.retry(() => { if (calls++ < 2) { const error = Error(); error.code = 'EBUSY'; throw error; } return 7; }), 7);
  assert.equal(calls, 3);
});
test('Firebase rejeitado/timeout impede confirmação; sucesso exige leitura autenticada', async () => {
  const fake = operation => ({ collection: () => ({ limit: () => ({ get: operation }) }) });
  await assert.rejects(authenticate(fake(async () => { throw Error('UNAUTHENTICATED'); })), /antes do VPN/);
  await assert.rejects(authenticate(fake(() => new Promise(() => {})), 20), /autenticação/);
  assert.equal((await authenticate(fake(async () => ({ docs: [] })))).authenticated, true);
});
test('TunnelBear travado: reinicia uma vez somente sem conexão preexistente', () => {
  const timeout = { error: { code: 'ETIMEDOUT' }, status: null };
  for (const status of ['Down', 'Up']) {
    const calls = []; let reads = 0;
    const invoke = action => { calls.push(action); return action === 'state' ? { status: 0, stdout: JSON.stringify({ status }) }
      : action === 'recover' ? { status: 0 } : reads++ === 0 ? timeout : { status: 0, stdout: '{}' }; };
    if (status === 'Up') { assert.throws(() => runTunnel('connect', invoke), /Alex preservado/); assert.ok(!calls.includes('recover')); }
    else { assert.equal(runTunnel('connect', invoke).status, 0); assert.deepEqual(calls, ['state', 'connect', 'recover', 'connect']); }
  }
  assert.throws(() => runTunnel('connect', action => action === 'state' ? { status: 0, stdout: '{"status":"Down"}' } : timeout, () => true), /segunda reabertura/);
});
test('quatro avisos levam a ação específica no Telegram pela fila existente', () => {
  for (const [error, kind] of [['TUNNELBEAR_LOGIN_REQUIRED', 'login'], ['TUNNELBEAR_SUBSCRIPTION_REQUIRED', 'subscription'],
    ['TUNNELBEAR_DATA_EXHAUSTED', 'data'], ['TUNNELBEAR_UPDATE_REQUIRED', 'update']]) {
    assert.equal(operatorIssue(error), kind);
    const row = compactCycle({ error, budget: { limitMB: 2700 } });
    const alerts = budgetAlerts('2026-10', { vpn: { operatorIssue: row.vpnOperatorIssue, providerExhausted: row.vpnProviderExhausted } });
    assert.equal(alerts.length, 1); assert.ok(alerts[0].text.includes(actions[kind]));
  }
});
test('atualização falha preserva release anterior e registra; sem anterior bloqueia', () => {
  const root = directory(), release = path.join(root, 'previous'); fs.mkdirSync(release); fs.writeFileSync(path.join(release, '.ready'), 'ok');
  fs.writeFileSync(path.join(root, 'current.json'), JSON.stringify({ sha: 'previous', release, dependencies: 'simulated-dependencies' }));
  const old = process.env.GITHUB_TOKEN; process.env.GITHUB_TOKEN = 'simulated';
  try {
    const events = []; const run = () => { throw Error('simulated fetch/install failed'); };
    assert.equal(update(root, row => events.push(row), run).release, release);
    assert.equal(events[0].status, 'update_failed');
    assert.throws(() => update(directory(), () => {}, run), /simulated/);
  } finally { if (old) process.env.GITHUB_TOKEN = old; else delete process.env.GITHUB_TOKEN; }
});
test('falha npm preserva release anterior sem ativar instalação parcial', () => {
  const root = directory(), release = path.join(root, 'previous'); fs.mkdirSync(release); fs.writeFileSync(path.join(release, '.ready'), 'ok');
  const previous = { sha: 'previous', release, dependencies: 'simulated-dependencies' };
  const pointer = path.join(root, 'current.json'); fs.writeFileSync(pointer, JSON.stringify(previous));
  const sha = 'a'.repeat(40), old = process.env.GITHUB_TOKEN; process.env.GITHUB_TOKEN = 'simulated';
  const execute = (exe, args) => {
    if (args.includes('rev-parse')) return sha;
    if (args.includes('archive')) fs.writeFileSync(args[args.indexOf('--output') + 1], 'archive');
    if (exe === 'tar') {
      const folder = args[args.indexOf('-C') + 1];
      fs.writeFileSync(path.join(folder, 'package.json'), '{"dependencies":{}}');
      fs.writeFileSync(path.join(folder, 'package-lock.json'), '{}');
    }
    if (exe === 'cmd.exe') throw Error('npm install simulated failure');
    return '';
  };
  try { assert.deepEqual(update(root, () => {}, execute), previous); assert.deepEqual(JSON.parse(fs.readFileSync(pointer)), previous); }
  finally { if (old) process.env.GITHUB_TOKEN = old; else delete process.env.GITHUB_TOKEN; }
});
test('trava padrão independe do checkout do executor', () => {
  const { defaultDataRoot } = require('./resource_lock.cjs');
  const old = process.env.EDGE_DATA_ROOT; delete process.env.EDGE_DATA_ROOT;
  try { assert.equal(defaultDataRoot(), path.join(os.homedir(), 'Apps - desenvolvimento', 'odds_app')); }
  finally { if (old) process.env.EDGE_DATA_ROOT = old; }
});
