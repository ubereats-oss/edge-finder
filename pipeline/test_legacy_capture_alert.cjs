const { test } = require('node:test');
const assert = require('node:assert/strict');
const { legacyWorkflowDisabled, shouldAlert } = require('./check_closing_odds_staleness');
test('estado real disabled_manually do legado não dispara mais e-mail sozinho', () => {
  assert.equal(legacyWorkflowDisabled('disabled_manually'), false);
  assert.equal(shouldAlert({ estadoWorkflow: 'disabled_manually' }), false);
});
test('desativação do aviso legado preserva alerta de atraso local', () => {
  assert.equal(shouldAlert({ estadoWorkflow: 'disabled_manually', betanoStale: true }), true);
});
test('desativação do aviso legado preserva alerta de indicação sem tentativa', () => {
  assert.equal(shouldAlert({ estadoWorkflow: 'disabled_manually', semTentativa: [{}] }), true);
});
