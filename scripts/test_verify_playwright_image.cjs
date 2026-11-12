const { test } = require('node:test');
const assert = require('node:assert/strict');
const { verifyVersions } = require('./verify_playwright_image.cjs');
const image = { driverVersion: '1.59.1', dockerImageName: 'mcr.microsoft.com/playwright:v1.59.1-noble' };
test('versão real do lock coincide com pacotes e imagem oficial', () => {
  const version = require('../package-lock.json').packages['node_modules/playwright'].version;
  assert.equal(verifyVersions(version, version, version, image), version);
});
test('imagem divergente falha com orientação de versão e digest', () => {
  assert.throws(() => verifyVersions('1.59.1', '1.59.1', '1.59.1', { ...image, driverVersion: '1.60.0' }), /Versões divergentes.*imagem=1.60.0.*digest/);
});
test('pacote, core ou lock divergente não passa', () => {
  assert.throws(() => verifyVersions('1.59.1', '1.60.0', '1.59.1', image), /pacote=1.60.0/);
  assert.throws(() => verifyVersions('1.59.1', '1.59.1', '1.60.0', image), /core=1.60.0/);
  assert.throws(() => verifyVersions(undefined, '1.59.1', '1.59.1', image), /projeto\/lock=undefined/);
});
test('imagem ausente ou não oficial não passa', () => {
  assert.throws(() => verifyVersions('1.59.1', '1.59.1', '1.59.1', null), /não identificada/);
  assert.throws(() => verifyVersions('1.59.1', '1.59.1', '1.59.1', { ...image, dockerImageName: 'outra/imagem' }), /não identificada/);
});
