const { test } = require('node:test');
const assert = require('node:assert/strict');
const { compactCycle } = require('./cloud_cycle_queue.cjs');
const { budgetAlerts, deliverOnce } = require('../../functions/budget_alerts.js');
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
