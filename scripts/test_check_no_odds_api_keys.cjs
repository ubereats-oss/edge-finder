const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { configuredKeys, findFindings, confirmedPinnacleEventId: eventId,
  confirmedBenficaEventId: benficaId, confirmedFixtureLines, realFixturePath } = require('./check_no_odds_api_keys');
const unknownKey = ['01234567', '89abcdef', '01234567', '89abcdef'].join('');
const fixture = value => `pipeline/test_market_integrity.cjs:78:  const event = { id: '${value}', sport_key: 'soccer_efl_champ',`;
const log = value => `LOG_ATIVIDADES.md:542:Pinnacle Over 1,92 e Under 1,97, updatedAt 01:52:19, evento ${value}. São dados salvos.`;
const historicalSource = fs.readFileSync(realFixturePath, 'utf8');
const historicalLines = source => source.split(/\r?\n/)
  .map((text, index) => `${realFixturePath}:${index + 1}:${text}`);
const benficaLog = value => `LOG_ATIVIDADES.md:1452:- Registro principal: _bookmaker_reads/local-betano-1793616667401-859, comparação 02/11 07:52:00.106 Brasília; Benfica sourceEventId94732376, Pinnacle ${value}; horário de início das duas fontes coincide em2026-11-02T20:15:00Z.`;

test('os três falsos positivos reais são aceitos apenas nos contextos históricos', () => {
  const contexts = confirmedFixtureLines(historicalSource);
  assert.equal(contexts.size, 2);
  assert.deepEqual(findFindings([...historicalLines(historicalSource), benficaLog(benficaId)], new Set(), contexts), []);
  const actualLog = fs.readFileSync('LOG_ATIVIDADES.md', 'utf8').split(/\r?\n/)
    .find(text => text.startsWith('- Registro principal:') && text.includes(benficaId));
  assert.ok(actualLog);
  assert.deepEqual(findFindings([`LOG_ATIVIDADES.md:1452:${actualLog}`], new Set()), []);
});
test('JSON inválido, identidade alterada e ocorrência duplicada não recebem exceção', () => {
  assert.equal(confirmedFixtureLines('{').size, 0);
  const changed = JSON.parse(historicalSource);
  changed.benfica.event.home_team = 'Outro clube';
  const modified = JSON.stringify(changed, null, 2);
  assert.equal(findFindings(historicalLines(modified), new Set(), confirmedFixtureLines(modified)).length, 1);
  changed.benfica.event.home_team = 'Benfica';
  changed.apiKey = benficaId;
  const duplicate = JSON.stringify(changed, null, 2);
  assert.equal(findFindings(historicalLines(duplicate), new Set(), confirmedFixtureLines(duplicate)).length, 2);
});
test('um ID desconhecido na fixture real continua bloqueado', () => {
  const source = historicalSource.replace(benficaId, unknownKey);
  assert.equal(findFindings(historicalLines(source), new Set(), confirmedFixtureLines(source)).length, 1);
});
test('IDs históricos em credenciais, outra linha ou outro arquivo continuam bloqueados', () => {
  const context = confirmedFixtureLines(historicalSource);
  const number = [...context.keys()][0];
  const lines = [`${realFixturePath}:${number}:  "apiKey": "${benficaId}",`,
    `${realFixturePath}:99999:      "id": "${benficaId}",`,
    `other.json:${number}:${context.get(number)}`, `LOG_ATIVIDADES.md:1:apiKey=${benficaId}`,
    benficaLog(unknownKey), benficaLog(benficaId) + ` api_key=${unknownKey}`];
  assert.equal(findFindings(lines, new Set(), context).length, lines.length);
});
test('credencial configurada prevalece sobre todos os novos contextos de evento', () => {
  const context = confirmedFixtureLines(historicalSource);
  const found = findFindings([...historicalLines(historicalSource), benficaLog(benficaId)],
    new Set([eventId, benficaId]), context);
  assert.equal(found.length, 3);
});

test('os dois contextos do ID Pinnacle confirmado não são chaves', () => {
  assert.deepEqual(findFindings([fixture(eventId), log(eventId)], new Set()), []);
});
test('IDs desconhecidos seguem suspeitos, inclusive em campos id e no log', () => {
  assert.equal(findFindings([fixture(unknownKey), log(unknownKey)], new Set()).length, 2);
});
test('o mesmo ID confirmado em contexto de credencial ou outro arquivo é detectado', () => {
  const lines = [`config.js:1:const apiKey = '${eventId}';`, `LOG_ATIVIDADES.md:1:chave=${eventId}`,
    `pipeline/test_market_integrity.cjs:1:const token = '${eventId}';`, `outro.js:1:const event = { id: '${eventId}' };`];
  assert.equal(findFindings(lines, new Set()).length, lines.length);
});
test('ID e chave na mesma linha não liberam o arquivo nem a outra ocorrência', () => {
  const result = findFindings([log(eventId) + ` api_key=${unknownKey}`], new Set());
  assert.equal(result.length, 1);
  assert.equal(result[0].last4, unknownKey.slice(-4));
});
test('credencial configurada nunca recebe exceção, mesmo se coincidir com ID confirmado', () => {
  assert.equal(findFindings([fixture(eventId), log(eventId)], new Set([eventId])).length, 2);
});
test('chaves em caixa alta também são detectadas; diagnóstico não imprime a chave', () => {
  const result = findFindings([`example.js:3:key=${unknownKey.toUpperCase()}`], new Set());
  assert.equal(result.length, 1);
  assert.ok(!JSON.stringify(result).includes(unknownKey.toUpperCase()));
});
test('chaves reais configuradas são detectadas em memória, sem API ou gravação de credenciais', t => {
  const env = { ...process.env };
  if (fs.existsSync('.env')) for (const line of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const index = line.indexOf('=');
    if (index > 0) env[line.slice(0, index).trim()] = line.slice(index + 1).trim();
  }
  const keys = configuredKeys(env);
  assert.ok(keys.size > 0, 'O aceite exige pelo menos uma chave real configurada no ambiente.');
  for (const key of keys) {
    for (const line of [`file.js:1:apiKey=${key}`, fixture(key), log(key), benficaLog(key)])
      assert.equal(findFindings([line], keys).length, 1);
  }
  t.diagnostic(`Credenciais configuradas verificadas em memória: ${keys.size}; valores não registrados.`);
});
test('CLI mantém exit code de bloqueio e não imprime credencial completa', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-key-detector-'));
  const script = path.resolve(__dirname, 'check_no_odds_api_keys.js');
  try {
    assert.equal(spawnSync('git', ['init', '-q'], { cwd: directory }).status, 0);
    fs.writeFileSync(path.join(directory, 'example.js'), `const apiKey = '${unknownKey}';\n`);
    assert.equal(spawnSync('git', ['add', 'example.js'], { cwd: directory }).status, 0);
    const result = spawnSync(process.execPath, [script], { cwd: directory, encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.ok(result.stderr.includes('example.js:1'));
    assert.ok(!result.stderr.includes(unknownKey));
  } finally {
    assert.equal(path.dirname(fs.realpathSync(directory)), fs.realpathSync(os.tmpdir()));
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
