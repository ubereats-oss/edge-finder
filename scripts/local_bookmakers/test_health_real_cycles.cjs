const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const real = require('./fixtures/health_real_cycles_20261029.json');
const native = require('./fixtures/tunnelbear_failures_20261025_26.json');
const { classifyCycle, captureVpnFailure, sanitizeReason, groupedIssues } = require('../../functions/local_cycle_health');
const { composeHealth, sendHealthReport, splitHealthMessages } = require('../../functions/edge_health');
const { compactCycle } = require('./cloud_cycle_queue.cjs');
const { collectDiagnostic } = require('./tunnelbear_diagnostics.cjs');
const [empty, disconnect, missingOriginal, success] = real.acceptance;
const end = cycle => Date.parse(cycle.finishedAt) + 1000;

function privateFree(value) {
  const text = JSON.stringify(value);
  assert.doesNotMatch(text, /\b(?:\d{1,3}\.){3}\d{1,3}\b|[\w.+-]+@[\w.-]+|\b[\da-f]{8}-[\da-f-]{27,}\b|Bearer\s+|token\s*[:=]|\blocal-\w+-\d{6,}/i);
}

test('27/10 19:50 real: sem elegíveis é linha própria e não falha, inclusive no formato da nuvem', () => {
  for (const cycle of [empty, compactCycle(empty)]) {
    const report = composeHealth({ cycles: [cycle] }, end(empty));
    assert.equal(report.counts.failed, 0);
    assert.equal(report.counts.noEligible, 1);
    assert.match(report.text, /Sem jogo elegível na Betano: 1/);
    privateFree(report);
  }
});

test('27/10 14:50 real: rodado com aviso de desconexão e motivo', () => {
  const report = composeHealth({ cycles: [compactCycle(disconnect)] }, end(disconnect));
  assert.equal(report.counts.run, 1);
  assert.equal(report.counts.failed, 0);
  assert.equal(report.counts.disconnectWarnings, 1);
  assert.match(report.text, /1× erro na desconexão/);
  assert.ok(report.text.includes(sanitizeReason(disconnect.disconnectError)));
  privateFree(report);
});

test('27/10 15:50 real: categoria mantida, original perdido explicitamente indisponível, sem reconstrução', () => {
  const value = classifyCycle(missingOriginal);
  assert.equal(value.kind, 'vpn_failed');
  assert.equal(value.category, 'TunnelBear sem registro no intervalo');
  assert.equal(value.originalError, null);
  assert.equal(value.originalErrorUnavailable, true);
});

test('motivo real preservado de 26/10: capturado antes da troca pela categoria, até 300 caracteres', t => {
  const cycle = structuredClone(real.originalPreserved);
  const original = cycle.stages.vpnConnect.error;
  captureVpnFailure(cycle, 'vpnConnect', new Error(original));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-health-real-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const source = native.find(row => row.startedAt === cycle.startedAt);
  fs.writeFileSync(path.join(dir, 'trace.log'), source.lines.join('\n'));
  cycle.tunnelBear = collectDiagnostic(cycle, dir, [dir]);
  cycle.stages.vpnConnect.error = `VPN não confirmado — ${cycle.tunnelBear.failure.category}`;
  cycle.error = cycle.stages.vpnConnect.error;
  const row = compactCycle(cycle);
  assert.equal(row.healthCause.originalError, sanitizeReason(original));
  assert.equal(row.tunnelBear.failure.originalError, sanitizeReason(original));
  assert.ok(row.healthCause.originalError.length <= 300);
  assert.equal(row.healthCause.originalErrorUnavailable, false);
  privateFree(row);
});

test('28/10 05:50 real: rodado com jogos, sem aviso', () => {
  const report = composeHealth({ cycles: [compactCycle(success)] }, end(success));
  assert.equal(report.counts.run, 1);
  assert.equal(report.counts.failed, 0);
  assert.equal(report.warnings.length, 0);
  assert.equal(report.errors.length, 0);
});

test('categoria inexistente usa outra falha e mantém o motivo real', () => {
  const cycle = { ...disconnect, healthCause: { kind: 'inexistente', category: 'inexistente',
    originalError: disconnect.disconnectError } };
  const result = classifyCycle(cycle);
  assert.equal(result.kind, 'other_failed');
  assert.equal(result.category, 'outra falha');
  assert.equal(result.originalError, sanitizeReason(disconnect.disconnectError));
});

test('dados privados anexados ao motivo real são removidos antes de registrar ou montar saúde', () => {
  const original = real.originalPreserved.stages.vpnConnect.error;
  const sensitive = ' email=conta@example.invalid token=segredo123 id=00000000-0000-4000-8000-000000000000 IP=192.0.2.10 IPv6=2001:db8::1';
  const cycle = structuredClone(real.originalPreserved);
  captureVpnFailure(cycle, 'vpnConnect', new Error(original + sensitive));
  const row = compactCycle(cycle);
  privateFree(row);
  assert.doesNotMatch(JSON.stringify(row), /segredo123|2001:db8::1/);
  privateFree(composeHealth({ cycles: [row] }, end(cycle)));
});

test('últimas 24 h reais: seis rodados, treze falhos, quatro pulados, um ausente e todas as categorias', () => {
  const report = composeHealth({ cycles: real.recent.map(compactCycle) }, Date.parse(real.observedAt));
  assert.equal(report.counts.run, 6);
  assert.equal(report.counts.failed, 13);
  assert.equal(report.counts.skipped, 4);
  assert.equal(report.counts.missing, 1);
  assert.equal(report.counts.noEligible, 0);
  assert.equal(report.counts.disconnectWarnings, 1);
  for (const phrase of ['10× TunnelBear sem registro no intervalo', '1× estado não reconhecido',
    '2× erro na leitura da Betano', '1× erro na desconexão']) assert.ok(report.text.includes(phrase), phrase);
  privateFree({ fixture: real, report });
});

test('mais de cinco categorias reais são preservadas na agregação', t => {
  const cycles = [];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-health-categories-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const row of native) {
    fs.writeFileSync(path.join(dir, 'trace.log'), row.lines.join('\n'));
    const cycle = { startedAt: row.startedAt, finishedAt: row.finishedAt, status: 'ciclo sem conexão',
      stages: { vpnConnect: { startedAt: row.attemptStart, finishedAt: row.attemptEnd,
        error: real.originalPreserved.stages.vpnConnect.error } } };
    cycle.tunnelBear = collectDiagnostic(cycle, dir, [dir]);
    cycles.push(cycle);
  }
  const issues = groupedIssues([...cycles, ...real.recent, real.authenticationFailure]);
  assert.ok(issues.length >= 8);
  for (const category of ['franquia recusada pelo TunnelBear', 'adaptador não subiu', 'conexão interrompida',
    'TunnelBear sem registro no intervalo', 'estado não reconhecido', 'erro na leitura da Betano',
    'erro na desconexão', 'autenticação ou preparação']) assert.ok(issues.some(row => row.category === category), category);
});

test('paginação e retomada usam texto real, Telegram simulado, sem esconder conteúdo ou repetir página confirmada', async () => {
  const report = composeHealth({ cycles: real.recent }, Date.parse(real.observedAt));
  const text = Array(8).fill(report.text).join('\n');
  const messages = splitHealthMessages(text);
  assert.ok(messages.length > 1);
  assert.ok(messages.every(value => value.length <= 3900));
  assert.equal(messages.join('\n'), text);
  const stored = { text, messages }, sent = [];
  const ref = { set: async value => Object.assign(stored, value) };
  await assert.rejects(sendHealthReport(ref, stored, async value => {
    if (sent.length === 1) throw Error('sender simulado indisponível');
    sent.push(value); return sent.length;
  }), /sender simulado/);
  assert.equal(stored.nextMessageIndex, 1);
  await sendHealthReport(ref, stored, async value => { sent.push(value); return sent.length; });
  assert.deepEqual(sent, messages);
  assert.equal(stored.status, 'sent');
  privateFree(stored);
});

test('lista histórica inclui NBA realmente comparada em 21/10; não autoriza filtro que a exclua', () => {
  assert.ok(real.leagueEvidence.leagues.includes('basketball_nba'));
  assert.deepEqual(real.leagueEvidence.earlyNBA.map(row => row.comparedSelections), [38, 36, 36]);
  assert.ok(real.leagueEvidence.earlyNBA.every(row => row.comparedSelections === row.matchedSelections && row.games === 11));
});
