const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const real = require('./fixtures/native_vpn_real_20261102.json');
const old = require('./fixtures/tunnelbear_failures_20261025_26.json');
const { parseConnectionLines, connectionState, readConnection } = require('./tunnelbear_native.cjs');
const { parseNative } = require('./tunnelbear_diagnostics.cjs');
const { failureCodeFor } = require('../../functions/tunnelbear_states');
const { classifyCycle } = require('../../functions/local_cycle_health');
const parsed = cycle => cycle.lines.flatMap(row => parseConnectionLines(row.text, row.source));
for (const cycle of real.cycles) test(`snapshot nativo real ${cycle.startedAt}`, () => {
  assert.deepEqual(connectionState(parsed(cycle), Date.parse(cycle.proofAt)), cycle.snapshot);
  assert.notEqual(connectionState(parsed(cycle), Date.parse(cycle.finishedAt)).Status, 'Connected');
});
test('Connected/PT real prevalece sobre erros externos, com timestamps Windows convertidos para UTC', () => {
  for (const cycle of real.cycles.filter(row => row.snapshot.Status === 'Connected')) {
    assert.equal(cycle.snapshot.Country, 'PT');
    assert.ok(cycle.lines.some(row => /countryCode:PT|Connecting Portugal/.test(row.text)));
  }
});
test('26/10 02:50 e 06:50 reais continuam falhas; DataLimitReached tem precedência sobre Down', () => {
  for (const row of old) {
    const lines = parseNative(row.lines.join('\n'), row.attemptStart, row.attemptEnd).stateLines;
    assert.equal(failureCodeFor(lines, 'VPN sem confirmação: adaptador=Down'), row.expected);
    assert.notEqual(connectionState(parseConnectionLines(row.lines.join('\n')), Date.parse(row.attemptEnd)).Status, 'Connected');
  }
});
test('saúde real separa erro externo e Down, preservando quota nativa mesmo com original Down', () => {
  const saved = require('./fixtures/operational_real_20261031.json').cycles;
  assert.equal(classifyCycle(saved[1]).category, 'falha na verificação externa de IP');
  assert.equal(classifyCycle(saved[2]).category, 'adaptador não subiu');
  const quota = old[0];
  const lines = parseNative(quota.lines.join('\n'), quota.attemptStart, quota.attemptEnd).stateLines;
  const cycle = { status: 'ciclo sem conexão', tunnelBear: { failure: { code: 'DataLimitReached',
    originalError: saved[2].vpnFailures[0].originalError }, stateLines: lines } };
  assert.equal(classifyCycle(cycle).category, 'franquia recusada pelo TunnelBear');
});
test('arquivo nativo só retorna estado/país, nunca dados privados', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tb-native-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const cycle = real.cycles.find(row => row.startedAt.startsWith('2026-11-01T22:50'));
  fs.writeFileSync(path.join(dir, 'trace.log'), cycle.lines.map(row => row.text).join('\n'));
  assert.equal(readConnection([dir], Date.parse(cycle.proofAt)).Country, 'PT');
  assert.equal(readConnection([dir], Date.parse(cycle.finishedAt)).Status, 'Disconnected');
  assert.equal(readConnection([path.join(dir, 'missing')]).Status, 'Unavailable');
  assert.doesNotMatch(JSON.stringify({ real, parsed: parsed(cycle) }), /\b(?:\d{1,3}\.){3}\d{1,3}\b|[\w.+-]+@[\w.-]+|token[=:]|publicIp/i);
});
