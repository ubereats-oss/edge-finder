const { test } = require('node:test');
const assert = require('node:assert/strict');
const { composeHealth, scheduledSlots, loadHealth } = require('./edge_health');
const { budgetAlerts, deliverOnce } = require('./budget_alerts');

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
test('ciclo antigo pausado é pulado e motivos repetidos são agrupados', () => {
  const result = composeHealth({ cycles: [
    { startedAt: '2026-10-23T21:50:00Z', status: 'paused', reason: 'sem saldo' },
    { startedAt: '2026-10-23T22:50:00Z', status: 'ciclo pulado', reason: 'sem saldo' },
  ] }, now);
  assert.equal(result.counts.skipped, 2);
  assert.match(result.text, /2× sem saldo/);
});
test('sem registro local destaca computador desligado ou coleta parada', () => {
  assert.equal(scheduledSlots(now).length, 24);
  assert.match(composeHealth({}, now).text, /computador desligado ou coleta parada/);
});

test('01/11 inclui outubro inteiro, por casa, CLV e IC95 sem misturar novembro', () => {
  const october = '2026-10-02T12:00:00Z';
  const november = '2026-11-01T03:00:00Z';
  const report = composeHealth({
    cycles: [
      { startedAt: october, status: 'complete', vpnMonthlySpentMB: 2700, gamesByHouse: { bwin: 2, esc_online: 1 } },
      { startedAt: '2026-10-31T22:50:00Z', status: 'ciclo pulado', vpnMonthlySpentMB: 2700 },
      { startedAt: '2026-10-15T10:50:00Z', status: 'failed', estimated: true },
      { startedAt: november, status: 'ciclo pulado', reason: 'aguardando orçamento de novembro', vpnMonthlySpentMB: 0 },
    ],
    opportunities: [
      { telegramSentAt: october, bookmaker: 'Bwin', apiSport: 'nba', eventId: 'a', clvPct: 2 },
      { telegramSentAt: october, bookmaker: 'Bwin', apiSport: 'nba', eventId: 'b', clvPct: 4 },
      { telegramSentAt: october, bookmaker: 'ESC Online', clvPct: null },
      { telegramSentAt: november, bookmaker: 'Bwin', clvPct: 100 },
    ],
    budget: { keyBalances: { a: { remaining: 9500, used: 0 } } },
    octoberBudget: { keyBalances: { a: { used: 4000 } } },
    priorErrors: ['Aviso Telegram: falha simulada'],
  }, Date.parse('2026-11-01T11:00:00Z'));
  for (const phrase of ['aguardando orçamento de novembro', 'Bwin: 2 indicações; CLV 3,00%; 1 ciclos',
    'ESC Online: 1 indicações; CLV não sei%; 1 ciclos', 'CLV médio: 3,00%; IC 95% [2,00%; 4,00%]',
    '2700,00 MB usados', 'créditos usados: 4000,00', '1 rodados; 1 pulados; 1 com falha',
    'falha simulada', '9500,00 restantes']) assert.ok(report.text.includes(phrase), phrase);
  assert.ok(report.text.length < 4000);
  assert.match(composeHealth({}, Date.parse('2026-11-02T11:00:00Z')).text, /aguardando orçamento de novembro/);
});

function fakeAlertDb() {
  const rows = new Map();
  const db = { collection: () => ({ doc: id => ({ id,
    get: async () => ({ data: () => rows.get(id) }),
    set: async value => rows.set(id, { ...rows.get(id), ...value }),
  }) }) };
  let serial = Promise.resolve();
  db.runTransaction = work => {
    const result = serial.then(() => work({ get: ref => ref.get(), set: (ref, data) => ref.set(data) }));
    serial = result.catch(() => {});
    return result;
  };
  return { db, rows };
}
test('avisos de VPN e créditos enviados uma única vez por mês mesmo concorrentes', async () => {
  const alerts = budgetAlerts('2026-10', { syncComplete: true, totalRemaining: 1000,
    vpn: { spentMB: 2700, remainingMB: 0 } });
  assert.equal(alerts.length, 2);
  assert.equal(budgetAlerts('2026-10', { syncComplete: true, totalRemaining: 1001,
    vpn: { remainingMB: 60 } }).length, 0);
  const { db } = fakeAlertDb();
  let sent = 0;
  for (const alert of alerts) {
    await Promise.all(Array.from({ length: 4 }, () => deliverOnce(db, alert, async () => ++sent, async () => {})));
    await deliverOnce(db, alert, async () => ++sent, async () => {});
  }
  assert.equal(sent, 2);
});
test('aviso falho persiste erro e só tenta de novo após uma hora, depois não repete', async () => {
  const { db, rows } = fakeAlertDb();
  const alert = { id: 'vpn-2026-10', text: 'VPN esgotado' };
  const queued = [];
  const enqueue = async data => queued.push(data);
  const at = Date.parse('2026-10-31T12:00:00Z');
  await deliverOnce(db, alert, async () => { throw Error('Telegram indisponível'); }, enqueue, at);
  assert.equal(rows.get(alert.id).error, 'Telegram indisponível');
  assert.deepEqual(queued, [{ alertId: alert.id }]);
  let sent = 0;
  assert.equal(await deliverOnce(db, alert, async () => ++sent, enqueue, at + 3599999), false);
  assert.equal(await deliverOnce(db, alert, async () => ++sent, enqueue, at + 3600000), true);
  await deliverOnce(db, alert, async () => ++sent, enqueue, at + 7200000);
  assert.equal(sent, 1);
});

test('consulta de 01/11 carrega outubro completo e saldo de outubro separado de novembro', async () => {
  const queries = [];
  const db = { collection: name => ({
    where: (field, op, value) => { queries.push([name, field, op, value]); return { get: async () => ({ docs: [] }) }; },
    orderBy: () => ({ limit: () => ({ get: async () => ({ docs: [] }) }) }),
    doc: id => { queries.push([name, id]); return { get: async () => ({ data: () => ({}) }) }; },
  }) };
  await loadHealth(db, 'simulado', Date.parse('2026-11-01T11:00:00Z'),
    async () => ({ ok: true, json: async () => ({ workflow_runs: [] }) }));
  assert.ok(queries.some(row => row[0] === '_local_cycle_health' && row[3] === '2026-10-01T03:00:00.000Z'));
  assert.ok(queries.some(row => row[0] === '_placard_opportunities' && row[3] === '2026-10-01T03:00:00.000Z'));
  for (const month of ['2026-10', '2026-11'])
    assert.ok(queries.some(row => row[0] === '_odds_api_budget' && row[1] === month));
});
