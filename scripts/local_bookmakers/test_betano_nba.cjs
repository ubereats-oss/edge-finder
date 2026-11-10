const { test } = require('node:test');
const assert = require('node:assert/strict');
const fixture = require('./fixtures/betano_nba_real_20261110.json');
const { initialState, listingCard, parseNbaPage, readNbaPages } = require('./betano_nba.cjs');
const copy = value => structuredClone(value);
const now = fixture.listing.startTime - 5 * 3600000;
const html = data => `<html><script>window["initial_state"]=${JSON.stringify(data)};</script></html>`;
const card = listingCard(fixture.listing, now);

test('evidência real lê vencedor, handicap e total com6 seleções e identidade', () => {
  const game = parseNbaPage(html(fixture.page), card);
  assert.deepEqual(game.teams, ['New York Knicks', 'Milwaukee Bucks']);
  assert.equal(game.apiSport, 'basketball_nba');
  assert.equal(game.sourceIdentityVerified, true);
  assert.deepEqual(game.listingTeams, game.teams);
  assert.deepEqual(game.markets.map(m => m.type), ['H2HT', 'HCOT', 'HCTG']);
  assert.deepEqual(game.markets.map(m => m.selections.map(s => s.price)), [[1.07, 6.4], [1.8, 1.82], [1.78, 1.83]]);
  assert.deepEqual(game.markets[1].selections.map(s => s.line), [-15.5, 15.5]);
  assert.deepEqual(game.markets[2].selections.map(s => [s.name, s.line]), [['Over', 220.5], ['Under', 220.5]]);
});
test('contrafactual da evidência: identidade divergente ou ausente descarta com motivo', () => {
  const changed = copy(fixture.page);
  changed.data.event.participants[0].name = 'Outro time';
  assert.throws(() => parseNbaPage(html(changed), card), /identidade da página diverge/);
  delete changed.data.event.participants;
  assert.throws(() => parseNbaPage(html(changed), card), /identidade da página do jogo ausente/);
});
test('contrafactual da evidência: ID e horário divergentes não são aceitos', () => {
  const changed = copy(fixture.page);
  changed.data.event.id = 'outro-evento';
  assert.throws(() => parseNbaPage(html(changed), card), /identidade da página diverge/);
  changed.data.event.id = fixture.listing.id;
  changed.data.event.startTime += 60000;
  assert.throws(() => parseNbaPage(html(changed), card), /horário da página diverge/);
});
test('contrafactual da evidência: página sem mercado ou mercado incompleto descarta o jogo', () => {
  const changed = copy(fixture.page);
  delete changed.data.event.sixPackLayout;
  assert.throws(() => parseNbaPage(html(changed), card), /página sem mercados principais/);
  const partial = copy(fixture.page);
  partial.data.event.sixPackLayout.columns[1].selections.pop();
  assert.throws(() => parseNbaPage(html(partial), card), /mercado principal incompleto \(FHOT\)/);
});
test('contrafactual da evidência: linhas inválidas e seleção suspensa não passam', () => {
  const changed = copy(fixture.page);
  changed.data.event.sixPackLayout.columns[1].selections[1].handicap = -15.5;
  assert.throws(() => parseNbaPage(html(changed), card), /linhas do mercado principal incompletas/);
  const suspended = copy(fixture.page);
  suspended.data.event.sixPackLayout.columns[0].selections[0].isSuspended = true;
  assert.throws(() => parseNbaPage(html(suspended), card), /mercado principal incompleto/);
});
test('janela atual e URL são validadas antes de abrir a página', () => {
  assert.equal(listingCard(fixture.listing, now).reason, null);
  assert.equal(listingCard(fixture.listing, fixture.listing.startTime + 1).reason, 'fora da janela de 12 horas');
  assert.match(listingCard({ ...fixture.listing, url: 'https://outro.invalid/odds/x/94850663/' }, now).reason, /URL/);
  assert.match(listingCard({ ...fixture.listing, participants: [] }, now).reason, /identidade da listagem/);
});
test('estado inicial é JSON: não executa JavaScript da página', () => {
  assert.deepEqual(initialState(html(fixture.page) + '<script>throw Error("não executar")</script>'), fixture.page);
  assert.throws(() => initialState('<html></html>'), /estado inicial.*ausente/);
  assert.throws(() => initialState('<script>window["initial_state"]={bad};</script>'), /estado inicial.*inválido/);
});
test('falha de uma página é isolada; o jogo real seguinte continua e fecha ambas páginas', async () => {
  const reports = []; let opened = 0, closed = 0;
  const context = { report: row => reports.push(row), newPage: async () => {
    const index = opened++;
    return { goto: async () => ({ ok: () => index !== 0, status: () => index === 0 ? 503 : 200 }),
      content: async () => html(fixture.page), close: async () => { closed++; } };
  } };
  // Contrafactual de transporte: duas tentativas sobre o registro real, primeiraHTTP503.
  const result = await readNbaPages(context, [fixture.listing, fixture.listing], 'https://www.betano.pt/lista', 200, now);
  assert.equal(result.games.length, 1);
  assert.match(result.diagnostics[0].error, /HTTP 503/);
  assert.equal(closed, 2);
  assert.equal(reports.filter(r => r.reason === 'aceito').length, 1);
  assert.ok(reports.some(r => /HTTP 503/.test(r.reason || '')));
});
