const { test } = require('node:test');
const assert = require('node:assert/strict');
const { compactCycle } = require('./cloud_cycle_queue.cjs');
const { budgetAlerts, deliverOnce } = require('../../functions/budget_alerts.js');
const { collectDiagnostic } = require('./tunnelbear_diagnostics.cjs');
const real = require('./fixtures/tunnelbear_failures_20261025_26.json');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('DataLimitReached real: um aviso por categoria, mesmo com flag antiga e consumo acima do limite antigo', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tb-quota-real-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const row = real.find(item => item.expected === 'DataLimitReached');
  assert.ok(row);
  fs.writeFileSync(path.join(dir, 'trace.log'), row.lines.join('\n'));
  const diagnostic = collectDiagnostic({ startedAt: row.startedAt, finishedAt: row.finishedAt,
    stages: { vpnConnect: { startedAt: row.attemptStart, finishedAt: row.attemptEnd, error: 'VPN não confirmado' } } }, dir, [dir]);
  const alerts = budgetAlerts('2026-10', { vpn: { spentMB: 3238.002617, remainingMB: 0,
    providerExhausted: true, tunnelBear: diagnostic } });
  assert.equal(alerts.length, 1);
  const state = {}; let sent = 0;
  const ref = { set: async value => Object.assign(state, value) };
  const db = { collection: () => ({ doc: () => ref }), runTransaction: work => work({
    get: async () => ({ data: () => state }), set: (r, value) => Object.assign(state, value) }) };
  for (let i = 0; i < 3; i++) await deliverOnce(db, alerts[0], async () => ++sent, async () => {});
  assert.equal(sent, 1);
  assert.equal(budgetAlerts('2026-10', { vpn: { spentMB: 3238.002617, remainingMB: 0,
    providerExhausted: true, tunnelBear: { ...diagnostic, failure: null, updateObserved: false } } }).length, 0);
});
test('franquia esgotada chega ao alerta imediato existente, sem inventar MB', async () => {
  const row = compactCycle({ startedAt: '2026-10-24T13:10:00Z', error: 'TUNNELBEAR_DATA_EXHAUSTED',
    accumulatedMB: 818, budget: { limitMB: 2700, month: '2026-10' } });
  assert.equal(row.vpnProviderExhausted, true);
  const alerts = budgetAlerts('2026-10', { vpn: { remainingMB: 1882, spentMB: 818, providerExhausted: row.vpnProviderExhausted } });
  assert.equal(alerts.length, 1);
  assert.match(alerts[0].text, /franquia de dados acabou/);
  const state = {}; let sent = 0;
  const ref = { set: async data => Object.assign(state, data) };
  const db = { collection: () => ({ doc: () => ref }), runTransaction: callback => callback({
    get: async () => ({ data: () => state }), set: (r, data) => Object.assign(state, data),
  }) };
  await deliverOnce(db, alerts[0], async () => { sent++; return 1; }, async () => {});
  await deliverOnce(db, alerts[0], async () => { sent++; return 1; }, async () => {});
  assert.equal(sent, 1);
});
test('propaganda e outros avisos não inventam esgotamento nem mensagem Telegram', () => {
  const row = compactCycle({ error: 'Janela inesperada', budget: { limitMB: 2700 } });
  assert.equal(row.vpnProviderExhausted, false);
  assert.deepEqual(budgetAlerts('2026-10', { vpn: { remainingMB: 1882 } }), []);
});
