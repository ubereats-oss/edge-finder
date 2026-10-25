const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { performance } = require('node:perf_hooks');
const filename = path.resolve(__dirname, '../../pipeline/local_bookmaker_cycle_fast.cjs');

// Run the production orchestration with every external boundary replaced: no
// process, browser, database, VPN or collector is invoked by these tests.
async function simulate({ owned = false, connectionError, readError = false, authError = false } = {}) {
  const calls = [], written = new Map();
  let reads = 0;
  const reference = { set: async () => {}, get: async () => ({ data: () => ({
    updatedAt: new Date().toISOString(), events: [], status: 'processed', comparedSelections: 1,
  }) }), collection: () => ({ doc: () => reference }) };
  const database = { collection: () => ({ doc: () => reference }) };
  const core = {
    database: () => database,
    authenticate: async () => { if (authError) throw Error('Firebase authentication rejected'); return { authenticated: true }; },
    ensureEdge: async () => ({ browser: { close: async () => {} }, context: {} }),
    physicalNetworkBytes: () => ({ receivedBytes: 100, sentBytes: 100 }),
    vpnNetworkBytes: () => ({ receivedBytes: 100, sentBytes: 100 }),
    tunnel: action => {
      calls.push(action);
      if (action === 'connect' && connectionError) throw new Error(connectionError);
      return { connectedByCycle: owned, vpnStartedAt: new Date().toISOString(), vpnDisconnectedAt: new Date().toISOString() };
    },
    recordTunnelUsage: () => ({ cycles: [{ measuredMB: 0 }], totalMB: 0 }),
    updateFailure: async () => {},
  };
  const reader = async () => {
    reads++;
    if (readError) throw new Error('simulated read failure');
    return { games: [{ teams: ['A', 'B'], apiSport: 'football', commenceTime: new Date().toISOString() }] };
  };
  const modules = {
    '../scripts/local_bookmakers/safe_files.cjs': { mkdirSync() {}, existsSync: () => false,
      readBudget: () => null, saveBudget: (file, value) => written.set(file, JSON.stringify(value)),
      writeFileSync: (file, value) => written.set(file, value), appendFileSync() {} },
    'node:path': path, 'node:perf_hooks': { performance },
    'node:child_process': { spawnSync: () => ({ status: 0, stdout: '{"minimized":true}', stderr: '' }),
      execFile: (...args) => args.at(-1)(null, '[]') },
    './odds_api_client': { loadEnvFileIfPresent() {} }, './local_betano_reader.js': core,
    '../scripts/local_bookmakers/fast_readers.cjs': {
      betano: reader, bwin: reader, lebull: reader, escOnline: reader,
      goldenpark: reader, retabet: reader, betclic: reader, count: () => 1,
    },
    '../scripts/local_bookmakers/daily_summary.cjs': { failureReasons: () => [] },
    '../scripts/local_bookmakers/local_competitions.cjs': { PRIORITY: [['football', 'Football']] },
    '../scripts/local_bookmakers/daily_budget.cjs': {
      vpnBudgetForDay: () => ({ run: true, month: '2026-10', limitMB: 2700 }),
      shouldRunForPinnacleWindow: () => ({ run: true }),
    },
    '../scripts/local_bookmakers/cloud_cycle_queue.cjs': { flushCycleQueue: async () => ({}) },
    '../functions/placard_value.js': { matchingEvents: () => [], namesEqual: (a, b) => a === b },
    '../scripts/local_bookmakers/tunnelbear_diagnostics.cjs': {
      startMetadata: () => ({ runtimeSha: 'a'.repeat(40), tunnelBearVersion: '4.17.4.0' }),
      collectDiagnostic: () => ({ failure: null }),
    },
  };
  const context = { require: name => {
    assert.ok(Object.hasOwn(modules, name), `Unmocked dependency: ${name}`);
    return modules[name];
  }, module: { exports: {} }, __dirname: path.dirname(filename), process: { env: {}, execPath: process.execPath },
  performance, setTimeout, clearTimeout, setInterval, clearInterval, Buffer, console: { log() {}, error() {} } };
  vm.runInNewContext(fs.readFileSync(process.env.EDGE_TEST_CYCLE_SOURCE || filename, 'utf8'), context, { filename });
  let error;
  try { await context.module.exports.main(); } catch (failure) { error = failure; }
  const cycle = [...written.entries()].find(([file]) => /cycle-.*\.json$/.test(file));
  return { calls, reads, error, cycle: cycle && JSON.parse(cycle[1]) };
}

for (const readError of [false, true]) {
  test(`VPN do Alex permanece ligada ao terminar; falha de leitura=${readError}`, async () => {
    const result = await simulate({ owned: false, readError });
    assert.deepEqual(result.calls, ['connect', 'minimize']);
    assert.equal(result.cycle.vpnPreservedForUser, true);
    assert.equal(Boolean(result.error), readError);
  });
  test(`VPN ligada pelo ciclo é desligada ao terminar; falha de leitura=${readError}`, async () => {
    const result = await simulate({ owned: true, readError });
    assert.deepEqual(result.calls, ['connect', 'disconnect', 'minimize']);
    assert.equal(Boolean(result.error), readError);
  });
}
test('Firebase sem autenticação: não liga VPN nem lê casas', async () => {
  const result = await simulate({ authError: true });
  assert.deepEqual(result.calls, []); assert.equal(result.reads, 0);
  assert.match(result.cycle.error, /authentication rejected/);
  assert.equal(result.cycle.runtimeSha, 'a'.repeat(40));
  assert.equal(result.cycle.tunnelBearVersion, '4.17.4.0');
});
for (const connectionError of ['TunnelBear não abriu', 'Janela inesperada do TunnelBear; captura=simulated.png']) {
  test(`${connectionError}: nenhuma leitura, nenhuma repetição, 0 MB`, async () => {
    const result = await simulate({ connectionError });
    assert.deepEqual(result.calls, ['connect', 'minimize']);
    assert.equal(result.reads, 0);
    assert.equal(result.cycle.status, 'ciclo sem conexão');
    assert.equal(result.cycle.consumedMB, 0);
    assert.equal(result.cycle.vpnAdapterBytes, 0);
    assert.equal(result.cycle.runtimeSha, 'a'.repeat(40));
    assert.equal(result.cycle.tunnelBearVersion, '4.17.4.0');
  });
}
