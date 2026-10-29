const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { performance } = require('node:perf_hooks');
const filename = path.resolve(__dirname, '../../pipeline/local_bookmaker_cycle_fast.cjs');

// Run the production orchestration with every external boundary replaced: no
// process, browser, database, VPN or collector is invoked by these tests.
async function simulate({ owned = false, connectionError, readError = false, authError = false, budget = null, at } = {}) {
  const calls = [], written = new Map(), readHouses = [], statuses = [];
  let reads = 0;
  const reference = { set: async () => {}, get: async () => ({ data: () => ({
    updatedAt: new Date().toISOString(), events: [], status: 'processed', comparedSelections: 1,
  }) }), collection: () => ({ doc: () => reference }) };
  const database = { collection: name => ({ doc: key => name === 'local_bookmaker_status'
    ? { set: async values => statuses.push({ key, ...values }) } : reference }) };
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
      readBudget: () => budget && JSON.parse(JSON.stringify(budget)), saveBudget: (file, value) => written.set(file, JSON.stringify(value)),
      writeFileSync: (file, value) => written.set(file, value), appendFileSync() {} },
    'node:path': path, 'node:perf_hooks': { performance },
    'node:child_process': { spawnSync: () => ({ status: 0, stdout: '{"minimized":true}', stderr: '' }),
      execFile: (...args) => args.at(-1)(null, '[]') },
    './odds_api_client': { loadEnvFileIfPresent() {} }, './local_betano_reader.js': core,
    '../scripts/local_bookmakers/fast_readers.cjs': {
      ...Object.fromEntries(['betano', 'bwin', 'lebull', 'escOnline', 'goldenpark', 'retabet', 'betclic']
        .map(key => [key, async (...args) => { readHouses.push(key); return reader(...args); }])), count: () => 1,
    },
    '../scripts/local_bookmakers/house_policy.cjs': require('./house_policy.cjs'),
    '../scripts/local_bookmakers/daily_summary.cjs': { failureReasons: () => [] },
    '../scripts/local_bookmakers/local_competitions.cjs': { PRIORITY: [['football', 'Football']] },
    '../scripts/local_bookmakers/daily_budget.cjs': {
      vpnBudgetForDay: require('./daily_budget.cjs').vpnBudgetForDay,
      shouldRunForPinnacleWindow: () => ({ run: true }),
    },
    '../scripts/local_bookmakers/cloud_cycle_queue.cjs': { flushCycleQueue: async () => ({}) },
    '../functions/placard_value.js': { matchingEvents: () => [], namesEqual: (a, b) => a === b },
    '../functions/local_cycle_health.js': require('../../functions/local_cycle_health.js'),
    '../scripts/local_bookmakers/tunnelbear_diagnostics.cjs': {
      startMetadata: () => ({ runtimeSha: 'a'.repeat(40), tunnelBearVersion: '4.17.4.0' }),
      collectDiagnostic: () => ({ failure: null }),
    },
  };
  const context = { require: name => {
    assert.ok(Object.hasOwn(modules, name), `Unmocked dependency: ${name}`);
    return modules[name];
  }, module: { exports: {} }, __dirname: path.dirname(filename), process: { env: {}, execPath: process.execPath },
  Date: at ? class extends Date { constructor(...args) { super(...(args.length ? args : [at])); } static now() { return Date.parse(at); } } : Date,
  performance, setTimeout, clearTimeout, setInterval, clearInterval, Buffer, console: { log() {}, error() {} } };
  vm.runInNewContext(fs.readFileSync(process.env.EDGE_TEST_CYCLE_SOURCE || filename, 'utf8'), context, { filename });
  let error;
  try { await context.module.exports.main(); } catch (failure) { error = failure; }
  const cycle = [...written.entries()].find(([file]) => /cycle-.*\.json$/.test(file));
  return { calls, reads, readHouses, statuses, error, cycle: cycle && JSON.parse(cycle[1]) };
}

test('valor real acrescido: ciclo inicia acima de 2700 MB e em 01/11; só Betano', async () => {
  const actual = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../.local_logs/betano/vpn-budget.json'), 'utf8'));
  const baseline = actual.carriedForwardMB + actual.measuredMB;
  const extraBytes = Math.max(1000000000, Math.ceil((2701 - baseline) * 1000000));
  actual.adapterCycles.push({ startedAt: '2026-10-27T13:00:00Z', bytes: extraBytes });
  actual.measuredMB += extraBytes / 1000000;
  assert.ok(actual.carriedForwardMB + actual.measuredMB > 2700);
  for (const at of ['2026-10-27T13:00:00Z', '2026-11-01T13:00:00Z']) {
    const result = await simulate({ owned: true, budget: actual, at });
    assert.equal(result.error, undefined);
    assert.equal(result.cycle.status, 'complete');
    assert.deepEqual(result.calls, ['connect', 'disconnect', 'minimize']);
    assert.deepEqual(result.readHouses, ['betano']);
    assert.deepEqual(Object.keys(result.cycle.reads), ['betano']);
    assert.equal(result.cycle.suspendedHouses.length, 6);
    const inactive = result.statuses.filter(row => row.key !== 'betano');
    assert.equal(inactive.length, 6);
    assert.ok(inactive.every(row => row.enabled === false && row.suspended === true && !row.lastFailureAt && !row.lastFailure));
    assert.equal(result.cycle.dailyVpn.month, at.slice(0, 7));
    assert.equal(result.cycle.dailyVpn.spent, at.includes('11-01') ? 0 : baseline + extraBytes / 1000000);
    assert.equal(result.cycle.budget.limitMB, undefined);
    assert.equal(result.cycle.budget.expiresAt, undefined);
  }
  console.log(`Base real: ${baseline} MB; outubro simulado: ${baseline + extraBytes / 1000000} MB`);
});

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
