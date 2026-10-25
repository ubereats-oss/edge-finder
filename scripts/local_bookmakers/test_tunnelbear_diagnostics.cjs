const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const fixture = require('./fixtures/tunnelbear_20261024_25.json');
const { parseNative, collectDiagnostic, startMetadata } = require('./tunnelbear_diagnostics.cjs');
const { tunnelBearAlerts } = require('../../functions/tunnelbear_alerts');
const { budgetAlerts, deliverOnce } = require('../../functions/budget_alerts');
const { compactCycle, flushCycleQueue } = require('./cloud_cycle_queue.cjs');
const failureTime = new Date(2026, 9, 25, 8, 3, 40, 412).getTime();
const failureCycle = () => ({ startedAt: new Date(failureTime - 12000).toISOString(),
  finishedAt: new Date(failureTime + 62000).toISOString(), runtimeSha: 'a'.repeat(40),
  tunnelBearVersion: '4.17.1.0', stages: { vpnConnect: { error: 'VPN Down' } },
  tunnelBearEvents: [] });
function temporary(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tb-diagnostics-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
function fakeDatabase() {
  const rows = new Map();
  const db = { collection: name => ({ doc: id => ({
    set: async data => rows.set(`${name}/${id}`, { ...rows.get(`${name}/${id}`), ...data }),
    key: `${name}/${id}`,
  }) }), runTransaction: async work => work({
    get: async ref => ({ data: () => rows.get(ref.key) }),
    set: (ref, data) => rows.set(ref.key, { ...rows.get(ref.key), ...data }),
  }) };
  return { db, rows };
}

test('registro real DataLimitReached, origem e intervalo; cancelamento nao substitui motivo', t => {
  const dir = temporary(t), cycle = failureCycle();
  fs.writeFileSync(path.join(dir, 'trace_maintenance.1.log'), fixture.failure + '\n' +
    '2026-10-25 08:03:43,862 [23] INFO - status:Disconnected, responseResult:VpnConnectionFailed, message:VPN Connection canceled');
  const diagnostic = collectDiagnostic(cycle, dir, [dir]);
  assert.equal(diagnostic.failure.code, 'DataLimitReached');
  assert.equal(diagnostic.failure.message, 'Data limit reached.');
  assert.match(diagnostic.failure.source, /trace_maintenance/);
  assert.equal(parseNative(fixture.failure, new Date(failureTime + 1).toISOString(), cycle.finishedAt).failures.length, 0);
});

test('um envio por motivo; novo motivo e sucesso comprovado permitem novo aviso', async t => {
  const dir = temporary(t), cycle = failureCycle();
  fs.writeFileSync(path.join(dir, 'trace_maintenance.log'), fixture.failure);
  const diagnostic = collectDiagnostic(cycle, dir, [dir]);
  const { db, rows } = fakeDatabase(); let sends = 0;
  const send = async () => ++sends;
  const issue = tunnelBearAlerts(diagnostic)[0];
  await deliverOnce(db, issue, send, async () => {});
  await deliverOnce(db, issue, send, async () => {});
  assert.equal(sends, 1);
  const next = { ...diagnostic, failure: { code: 'Other', message: 'Outro motivo' } };
  await deliverOnce(db, tunnelBearAlerts(next)[0], send, async () => {});
  assert.equal(sends, 2);
  collectDiagnostic({ ...cycle, vpnConnectedAt: cycle.finishedAt, stages: {} }, dir, [dir]);
  const afterSuccess = collectDiagnostic(cycle, dir, [dir]);
  assert.notEqual(tunnelBearAlerts(afterSuccess)[0].id, issue.id);
  await deliverOnce(db, tunnelBearAlerts(afterSuccess)[0], send, async () => {});
  assert.equal(sends, 3); assert.equal(rows.size, 3);
});

test('faixa real de 24/10: ignorada, um aviso por versao, sem reset apos conexao', async t => {
  const dir = temporary(t), cycle = { ...failureCycle(),
    startedAt: new Date(2026, 9, 24, 12, 0).toISOString(),
    finishedAt: new Date(2026, 9, 24, 12, 3).toISOString(),
    stages: {}, tunnelBearEvents: [fixture.banner] };
  fs.writeFileSync(path.join(dir, 'trace.1.log'), fixture.update);
  const diagnostic = collectDiagnostic(cycle, dir, [dir]);
  assert.equal(diagnostic.failure, null);
  assert.equal(diagnostic.requestedUpdateVersion, '4.17.4.0');
  assert.equal(diagnostic.updateObserved, true);
  const alert = budgetAlerts('2026-10', { vpn: { tunnelBear: diagnostic } })[0];
  assert.match(alert.text, /^TunnelBear pede atualização — atualize manualmente/);
  const { db } = fakeDatabase(); let sent = 0;
  for (const value of [diagnostic, diagnostic, { ...diagnostic, lastSuccessfulConnectionAt: cycle.finishedAt }])
    await deliverOnce(db, tunnelBearAlerts(value)[0], async () => ++sent, async () => {});
  assert.equal(sent, 1);
  assert.notEqual(tunnelBearAlerts({ ...diagnostic, requestedUpdateVersion: '4.18.0.0' })[0].id, alert.id);
});

test('falha Telegram fica registrada e nao impede sincronizar ciclo e metadados', async t => {
  const { db, rows } = fakeDatabase(); let enqueued = 0;
  const alert = tunnelBearAlerts({ failure: { code: 'DataLimitReached', message: 'Data limit reached.' } })[0];
  const delivered = await deliverOnce(db, alert, async () => { throw Error('Telegram indisponível'); }, async () => { enqueued++; });
  assert.equal(delivered, false); assert.equal(enqueued, 1);
  assert.equal(rows.get(`_edge_budget_alerts/${alert.id}`).status, 'send_failed');
  assert.equal(rows.get(`_edge_budget_alerts/${alert.id}`).error, 'Telegram indisponível');
  const cycle = { ...failureCycle(), tunnelBear: { failure: { code: 'DataLimitReached', message: 'Data limit reached.' } } };
  const result = await flushCycleQueue(db, cycle, temporary(t));
  assert.equal(result.sent, 1); assert.equal(result.pending, 0);
  const row = compactCycle(cycle);
  assert.equal(row.runtimeSha, cycle.runtimeSha); assert.equal(row.tunnelBearVersion, '4.17.1.0');
  assert.equal(row.tunnelBear.failure.code, 'DataLimitReached');
});

test('versoes reais do Git e executavel sao legiveis sem manipular TunnelBear', () => {
  const metadata = startMetadata(path.resolve(__dirname, '../..'));
  assert.match(metadata.runtimeSha, /^[a-f0-9]{40}$/);
  assert.match(metadata.tunnelBearVersion, /^\d+(?:\.\d+){2,3}$/);
});
