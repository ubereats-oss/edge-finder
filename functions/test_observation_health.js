const { test } = require('node:test');
const assert = require('node:assert/strict');
const { nflHealth, closingState, sampleHealth } = require('./observation_health');
const { report } = require('./placard_value');
const { composeHealth } = require('./edge_health');
const nfl = require('./fixtures/health_nfl_20261116.cjs');
const sample = require('./fixtures/health_nba_20261116.cjs');
const now = Date.parse('2026-11-16T14:49:43Z');

test('registros reais: onze indicações, oito capturas, uma pendente e duas perdas por linha', () => {
  const result = nflHealth(nfl, now);
  assert.equal(result.recent, 11);
  assert.deepEqual(result.closing, { capturado: 8, pendente: 1, perdido: 2 });
  const lost = nfl.filter(e => e.firstEvaluatedAt >= '2026-11-15'
    && closingState(e, now) === 'perdido');
  assert.deepEqual(lost.map(e => e.player).sort(), ['Emmett Johnson', 'Kaleb Johnson']);
  assert.ok(lost.every(e => e.closingOddsMissingReason === 'linha_mudou_ate_fechamento'));
  assert.ok(lost.every(e => e.closingOddsStatus === 'pendente'), 'classificação não altera o ledger');
});

test('placar NFL real usa exatamente o bootstrap oficial, sem multiplicar CLV por cem', () => {
  const result = nflHealth(nfl, now);
  const expected = report(nfl.map(e => ({ ...e, apiSport: e.esporte, clvPct: e.clv })));
  for (const key of ['n', 'nEvents', 'mean', 'lower', 'upper', 'ciMethod'])
    assert.equal(result.score[key], expected[key], key);
  assert.equal(result.score.n, 110);
  assert.ok(Math.abs(result.score.mean - 0.6477272727272734) < 1e-12);
});

test('noite real sem execução é falha de registro, nunca conclusão inventada', () => {
  assert.equal(sampleHealth(sample, now),
    'Amostra props NBA: noite 1 falhou: sem registro de execução ou resultado.');
  assert.equal(sampleHealth({ ...sample, completedNights: ['2026-11-15'] }, now),
    'Amostra props NBA: noite 1 de 5 concluída.');
  assert.equal(sampleHealth({ ...sample, exists: false }, now), null);
});

test('as novas linhas são apenas acrescentadas; todo texto e contagens anteriores ficam idênticos', () => {
  const base = { cycles: [], runs: [], opportunities: [], budget: {} };
  const original = composeHealth(base, now);
  const extended = composeHealth({ ...base, nflEntries: nfl, nbaSample: sample }, now);
  assert.ok(extended.text.startsWith(original.text + '\nNFL (observação):'));
  assert.deepEqual(extended.counts, original.counts);
  assert.deepEqual(extended.errors, original.errors);
  assert.equal(extended.text.split('\n').length, original.text.split('\n').length + 2);
});
