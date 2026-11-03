const { test } = require('node:test');
const assert = require('node:assert/strict');
const real = require('./fixtures/disconnected_adapter_up_20261103.json');
const { runTunnel } = require('./tunnel_runner.cjs');
test('oito bloqueios reais: timeout com Up/Disconnected pode recuperar uma vez', () => {
  assert.equal(real.cycles.length, 8);
  for (const row of real.cycles) {
    assert.equal(row.adapter, 'Up'); assert.equal(row.native.Status, 'Disconnected');
    const calls = []; let attempts = 0;
    const result = runTunnel('connect', action => {
      calls.push(action);
      if (action === 'state') return { status: 0, stdout: JSON.stringify({ status: row.adapter, nativeStatus: row.native.Status }) };
      if (action === 'connect' && ++attempts === 1) return { error: { code: 'ETIMEDOUT' } };
      return { status: 0 };
    });
    assert.equal(result.status, 0);
    assert.deepEqual(calls, ['state', 'connect', 'recover', 'connect']);
  }
});
test('Connected PT real preexistente nunca autoriza recovery, mesmo se placa disser Down', () => {
  const pt = require('./fixtures/native_vpn_real_20261102.json').cycles.find(row => row.snapshot.Status === 'Connected');
  for (const status of ['Up', 'Down']) {
    const calls = [];
    assert.throws(() => runTunnel('connect', action => {
      calls.push(action);
      return action === 'state' ? { status: 0, stdout: JSON.stringify({ status, nativeStatus: pt.snapshot.Status, nativeCountry: pt.snapshot.Country }) }
        : { error: { code: 'ETIMEDOUT' } };
    }), /preservado/);
    assert.equal(calls.includes('recover'), false);
  }
});
