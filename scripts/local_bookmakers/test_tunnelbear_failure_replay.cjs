const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const real = require('./fixtures/tunnelbear_failures_20261025_26.json');
const { collectDiagnostic, parseNative, pruneLocalStateLines } = require('./tunnelbear_diagnostics.cjs');
const { CATEGORIES, safeStateLines } = require('../../functions/tunnelbear_states');
const { tunnelBearAlerts } = require('../../functions/tunnelbear_alerts');
const { deliverOnce } = require('../../functions/budget_alerts');
const { composeHealth } = require('../../functions/edge_health');
const { pruneCloudStateLines } = require('../../functions/tunnelbear_retention');

function temporary(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tb-real-replay-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
function replay(t, row, changes = {}) {
  const dir = temporary(t);
  fs.writeFileSync(path.join(dir, 'trace.log'), row.lines.join('\n'));
  const cycle = { startedAt: row.startedAt, finishedAt: row.finishedAt,
    stages: { vpnConnect: { startedAt: row.attemptStart, finishedAt: row.attemptEnd, error: 'VPN não confirmado' } }, ...changes };
  return { dir, cycle, diagnostic: collectDiagnostic(cycle, dir, [dir]) };
}
function database() {
  const rows = new Map();
  return { rows, db: { collection: name => ({ doc: id => ({ key: name + '/' + id,
    set: async value => rows.set(name + '/' + id, { ...rows.get(name + '/' + id), ...value }),
  }) }), runTransaction: async work => work({
    get: async ref => ({ data: () => rows.get(ref.key) }),
    set: (ref, value) => rows.set(ref.key, { ...rows.get(ref.key), ...value }),
  }) } };
}
function privateFree(value) {
  const text = JSON.stringify(value);
  assert.equal(/\b(?:\d{1,3}\.){3}\d{1,3}\b|\b[\da-f]{8}-[\da-f-]{27,}\b|[\w.+-]+@[\w.-]+|Bearer\s+|token\s*[:=]|countryCode:|captchaHtml:/i.test(text), false);
}
for (const row of real) test(`registro real ${row.startedAt}: categoria, aviso e até 20 estados seguros`, async t => {
  const { diagnostic, cycle } = replay(t, row);
  assert.equal(diagnostic.failure.code, row.expected);
  assert.equal(diagnostic.failure.category, CATEGORIES[row.expected]);
  assert.ok(diagnostic.stateLines.length > 0 && diagnostic.stateLines.length <= 20);
  assert.deepEqual(safeStateLines(diagnostic.stateLines), diagnostic.stateLines);
  const alerts = tunnelBearAlerts(diagnostic);
  assert.equal(alerts.length, 1);
  const { db, rows } = database(); let sent = 0;
  await deliverOnce(db, alerts[0], async () => ++sent, async () => {});
  assert.equal(sent, 1);
  const health = composeHealth({ cycles: [{ startedAt: cycle.startedAt, status: 'ciclo sem conexão',
    tunnelBear: diagnostic, errors: ['VPN sem confirmação pela placa e IP português: adaptador=Down, país=, erro=.'] }] }, Date.parse(cycle.finishedAt) + 1000);
  assert.ok(health.text.includes(CATEGORIES[row.expected]));
  assert.equal(health.text.includes('erro='), false);
  privateFree({ diagnostic, alerts, persisted: [...rows.values()], health });
});

test('mesma categoria ignora texto; sucesso real rearma e sucesso não avisa', async t => {
  const { diagnostic, dir, cycle } = replay(t, real[1]);
  const { db } = database(); let sent = 0;
  for (const value of [diagnostic, { ...diagnostic, failure: { ...diagnostic.failure, message: 'outra mensagem' } }, replay(t, real[2]).diagnostic])
    await deliverOnce(db, tunnelBearAlerts(value)[0], async () => ++sent, async () => {});
  assert.equal(sent, 1);
  const successReal = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/tunnelbear_success_20261025.json'), 'utf8'));
  const success = collectDiagnostic(successReal, dir, [dir]);
  assert.equal(tunnelBearAlerts(success).length, 0);
  const again = collectDiagnostic(cycle, dir, [dir]);
  await deliverOnce(db, tunnelBearAlerts(again)[0], async () => ++sent, async () => {});
  assert.equal(sent, 2);
});

test('estado fictício desconhecido e intervalo sem linhas têm categoria e aviso', t => {
  for (const [lines, expected] of [[['2026-10-25 08:03:40,412 status:EstadoFicticio'], 'Unknown'], [[], 'NoRecords']]) {
    const { diagnostic } = replay(t, { ...real[0], lines });
    assert.equal(diagnostic.failure.category, CATEGORIES[expected]);
    assert.equal(tunnelBearAlerts(diagnostic).length, 1);
    privateFree({ diagnostic, alerts: tunnelBearAlerts(diagnostic) });
  }
});

test('campos privados anexados às linhas reais nunca são copiados', t => {
  const suffix = ' email=conta@example.invalid token=segredo identificador=00000000-0000-4000-8000-000000000000 IP=192.0.2.10';
  const { diagnostic } = replay(t, { ...real[0], lines: real[0].lines.map(line => line + suffix) });
  privateFree({ diagnostic, alerts: tunnelBearAlerts(diagnostic) });
  assert.equal(JSON.stringify(diagnostic).includes('segredo'), false);
});

test('horários reais antes/depois da mudança de Portugal independem do TZ do processo', () => {
  const before = require('./fixtures/tunnelbear_20261024_25.json').update;
  const samples = [{ text: before, since: '2026-10-24T15:00:00Z', until: '2026-10-24T15:03:00Z' },
    ...real.map(row => ({ text: row.lines.join('\n'), since: row.attemptStart, until: row.attemptEnd }))];
  const expected = samples.map(row => parseNative(row.text, row.since, row.until));
  for (const zone of ['Europe/Lisbon', 'America/Sao_Paulo', 'UTC']) {
    const source = `const p=require(${JSON.stringify(path.join(__dirname, 'tunnelbear_diagnostics.cjs'))}).parseNative; process.stdout.write(JSON.stringify(${JSON.stringify(samples)}.map(r=>p(r.text,r.since,r.until))))`;
    assert.deepEqual(JSON.parse(execFileSync(process.execPath, ['-e', source], { env: { ...process.env, TZ: zone }, timeout: 15000 })), expected);
  }
  assert.equal(expected[0].requestedUpdateVersion, '4.17.4.0');
  assert.equal(expected[1].stateLines[0].slice(0, 24), '2026-10-25T11:03:40.412Z');
});

test('retenção local remove estados reais com mais de 30 dias e preserva recentes e categorias', t => {
  const dir = temporary(t), old = replay(t, real[0]).diagnostic, recent = replay(t, real[3]).diagnostic;
  const rows = [{ startedAt: real[0].startedAt, tunnelBear: old }, { startedAt: real[3].startedAt, tunnelBear: recent }];
  const now = Date.parse('2026-11-25T08:00:00Z');
  for (let i = 0; i < rows.length; i++) fs.writeFileSync(path.join(dir, `cycle-${i}.json`), JSON.stringify(rows[i]));
  fs.writeFileSync(path.join(dir, 'hourly-cycles.jsonl'), rows.map(JSON.stringify).join('\n') + '\n');
  fs.writeFileSync(path.join(dir, 'cloud-cycle-pending.json'), JSON.stringify(rows));
  pruneLocalStateLines(dir, now);
  for (const name of ['cloud-cycle-pending.json', 'hourly-cycles.jsonl']) {
    const text = fs.readFileSync(path.join(dir, name), 'utf8');
    const saved = name.endsWith('.jsonl') ? text.trim().split('\n').map(JSON.parse) : JSON.parse(text);
    assert.equal(saved[0].tunnelBear.stateLines.length, 0);
    assert.deepEqual(saved[1].tunnelBear.stateLines, recent.stateLines);
    assert.equal(saved[0].tunnelBear.failure.category, old.failure.category);
  }
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'cycle-0.json'))).tunnelBear.stateLines.length, 0);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'cycle-1.json'))).tunnelBear.stateLines, recent.stateLines);
});

test('retenção da nuvem remove somente linhas antigas de ciclos e avisos', async t => {
  const old = replay(t, real[0]).diagnostic, recent = replay(t, real[3]).diagnostic;
  const stores = { _local_cycle_health: [{ startedAt: real[0].startedAt, tunnelBear: old },
    { startedAt: real[3].startedAt, tunnelBear: recent }], _edge_budget_alerts: [tunnelBearAlerts(old)[0], tunnelBearAlerts(recent)[0]] };
  const db = { collection: name => ({ where: (field, op, cutoff) => ({ orderBy() { return this; }, limit() { return this; },
    get: async () => ({ docs: (stores[name] || []).filter(row => row[field] < cutoff).map(row => ({ data: () => row,
      ref: { update: async patch => { for (const [key, value] of Object.entries(patch)) {
        if (key.startsWith('tunnelBear.')) row.tunnelBear[key.split('.')[1]] = value; else row[key] = value;
      } } } })) }) }) }) };
  const recentLines = [...recent.stateLines], recentText = stores._edge_budget_alerts[1].text;
  await pruneCloudStateLines(db, Date.parse('2026-11-25T08:00:00Z'));
  assert.equal(old.stateLines.length, 0);
  assert.deepEqual(recent.stateLines, recentLines);
  assert.equal(stores._edge_budget_alerts[0].text.includes('\n'), false);
  assert.equal(stores._edge_budget_alerts[1].text, recentText);
});
