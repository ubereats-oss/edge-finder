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

const originDay = require('./fixtures/origin_real_20261101.json');
test('11 ciclos reais desde 31/10 21:50 são Agendador mesmo com marca unknown antiga', () => {
  const cycles = originDay.cycles.filter(row => row.startedAt >= '2026-11-01T00:50:00Z');
  assert.equal(cycles.length, 11);
  assert.ok(cycles.every(row => cycleOrigin(row) === 'scheduler'));
  const report = composeHealth({ cycles }, Date.parse(originDay.observedAt));
  for (let at = Date.parse('2026-11-01T00:50:00Z'); at <= Date.parse('2026-11-01T10:50:00Z'); at += 3600000)
    assert.ok(!report.missingSlots.includes(new Date(at).toISOString()));
  for (const cycle of cycles) {
    const unmarked = { ...cycle }; delete unmarked.executionOrigin;
    assert.equal(cycleOrigin(unmarked), 'scheduler');
  }
});

test('31/10 21:23 real continua manual; origens históricas de teste continuam separadas', () => {
  const cycle = originDay.cycles.find(row => row.startedAt === '2026-11-01T00:23:17.550Z');
  assert.equal(cycleOrigin(cycle), 'manual');
  assert.equal(cycleOrigin({ startedAt: real.cycles[0].startedAt }), 'test');
});

test('saúde real de 01/11 fecha 24 horários e inclui os originais das duas falhas', async () => {
  const report = composeHealth({ cycles: originDay.cycles, ...(originDay.healthData || {}) }, Date.parse(originDay.observedAt));
  assert.equal(report.counts.run, 19);
  assert.equal(report.counts.noEligible, 3);
  assert.equal(report.counts.skipped, 3);
  assert.equal(report.counts.failed, 2);
  assert.equal(report.counts.missing, 0);
  assert.equal(report.counts.manual, 1);
  assert.equal(report.counts.run + report.counts.skipped + report.counts.failed + report.counts.missing, 24);
  for (const at of ['2026-11-01T04:50:06.777Z', '2026-11-01T10:50:05.606Z']) {
    const row = originDay.cycles.find(cycle => cycle.startedAt === at);
    assert.equal(cycleOrigin(row), 'scheduler');
    assert.ok(report.errors.some(error => error.includes(row.vpnFailures[0].category)
      && error.includes(row.vpnFailures[0].originalError || 'motivo original não preservado')));
  }
  const sent = [];
  await require('../../functions/edge_health').sendHealthReport({ set: async () => {} }, report,
    async text => { sent.push(text); return sent.length; });
  assert.equal(sent.join('\n'), report.text);
});
