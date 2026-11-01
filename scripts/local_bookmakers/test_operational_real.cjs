const { test } = require('node:test');
const assert = require('node:assert/strict');
const real = require('./fixtures/operational_real_20261031.json');
const credits = require('../../pipeline/fixtures/closing_reserve_real_20261031.json');
const { cycleOrigin } = require('../../functions/local_cycle_origin');
const { groupedIssues } = require('../../functions/local_cycle_health');
const { composeHealth } = require('../../functions/edge_health');
const { reserveFromRecords } = require('../../functions/odds_api_monthly_budget');
const { budgetAlerts, deliverOnce } = require('../../functions/budget_alerts');

test('29/10 13:39 real: manual/teste não preenche a ausência das 13:50', () => {
  const cycle = real.cycles[0];
  assert.equal(cycleOrigin(cycle), 'test');
  const report = composeHealth({ cycles: [cycle] }, Date.parse('2026-10-29T17:00:00Z'));
  assert.equal(report.counts.tests, 1);
  assert.equal(report.counts.failed, 0);
  assert.ok(report.missingSlots.includes('2026-10-29T16:50:00.000Z'));
  assert.match(report.text, /manual\/teste 29\/10.*13:39/);
});

test('29/10 14:32 e 15:50 reais: mesma categoria conserva os dois motivos distintos', () => {
  const cycles = real.cycles.slice(1);
  const issue = groupedIssues(cycles).find(row => row.category === 'conexão interrompida');
  assert.equal(issue.count, 2);
  assert.equal(issue.examples.length, 2);
  assert.ok(issue.examples.some(row => /adaptador=Up.*tempo limite/.test(row.reason)));
  assert.ok(issue.examples.some(row => /adaptador=Down/.test(row.reason)));
  const report = composeHealth({ cycles }, Date.parse('2026-10-29T19:00:00Z'));
  assert.match(report.text, /adaptador=Down/);
  assert.match(report.text, /adaptador=Up/);
  assert.equal(report.counts.failed, 1);
  assert.equal(report.counts.manual, 1);
});

test('aviso com reserva real variável, envio simulado e deduplicação mensal preservada', async () => {
  const evidence = reserveFromRecords(credits.opportunities, credits.closingCosts.map(row => row.cost));
  const remaining = credits.balances.reduce((sum, row) => sum + row.remaining, 0);
  const alert = budgetAlerts('2026-10', { syncComplete: true, totalRemaining: remaining,
    dynamicReserve: evidence })[0];
  assert.equal(alert.id, 'credits-2026-10');
  assert.match(alert.text, /Reserva variável atual.*2 créditos/);
  assert.doesNotMatch(alert.text, /800|200 de margem|Somente fechamentos/);
  let stored = {}, sent = 0;
  const ref = { get: async () => ({ data: () => stored }),
    set: async value => { stored = { ...stored, ...value }; } };
  const db = { collection: () => ({ doc: () => ref }), runTransaction: fn => fn({
    get: () => ref.get(), set: (_ref, value) => ref.set(value),
  }) };
  await deliverOnce(db, alert, async () => { sent++; }, async () => {});
  await deliverOnce(db, alert, async () => { sent++; }, async () => {});
  assert.equal(sent, 1);
});
