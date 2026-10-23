const { test } = require('node:test');
const assert = require('node:assert/strict');
const { composeHealth, scheduledSlots } = require('./edge_health');

const now = Date.parse('2026-10-24T11:00:00Z');
const realCycle = { startedAt: '2026-10-23T21:50:02Z', status: 'complete',
  spentMB: 31.5, vpnMonthlySpentMB: 703.6, vpnMonthlyRemainingMB: 1996.4,
  gamesByHouse: { bwin: 11, betclic: 9 } };
test('saúde inclui ciclo local real, ausências, workflow, indicações e saldos', () => {
  const report = composeHealth({ cycles: [realCycle,
    { startedAt: '2026-10-24T00:50:02Z', status: 'ciclo pulado', reason: 'parte diária esgotada' }],
  runs: [{ id: 1, created_at: '2026-10-24T01:00:00Z', status: 'completed', conclusion: 'success' },
    { id: 2, created_at: '2026-10-24T02:00:00Z', status: 'completed', conclusion: 'failure' }],
  opportunities: [{ telegramSentAt: '2026-10-24T01:30:00Z' }],
  budget: { keyBalances: { a: { remaining: 4500, used: 500 } } } }, now);
  assert.equal(report.counts.run, 1);
  assert.equal(report.counts.skipped, 1);
  assert.equal(report.counts.workflowFailed, 1);
  assert.equal(report.counts.sent, 1);
  assert.ok(report.counts.missing > 0);
  for (const phrase of ['Bwin', 'betclic', 'parte diária esgotada', '500,00 usados', '4500,00 restantes']) {
    assert.match(report.text.toLowerCase(), new RegExp(phrase.toLowerCase()));
  }
});
test('sem registro local destaca computador desligado ou coleta parada', () => {
  assert.equal(scheduledSlots(now).length, 24);
  assert.match(composeHealth({}, now).text, /computador desligado ou coleta parada/);
});
