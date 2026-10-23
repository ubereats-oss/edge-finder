const { test } = require('node:test');
const assert = require('node:assert/strict');
const { competition, localClock, ordered } = require('./local_competitions.cjs');
const { parseBwinFeed, parseLebullHtml, retabetLeague } = require('./fast_readers.cjs');

test('liga e horário vêm da própria casa, com prioridade fixa', () => {
  assert.equal(competition('UEFA Europa League').apiSport, 'soccer_uefa_europa_league');
  assert.equal(competition('França - Ligue 1').apiSport, 'soccer_france_ligue_one');
  assert.equal(competition('Liga Conferência Europa da UEFA'), null);
  assert.equal(localClock('Hoje 13:45', 'America/Sao_Paulo',
    new Date('2026-10-23T12:00:00Z')), '2026-10-23T16:45:00.000Z');
  assert.equal(localClock('MarítimoHoje - 13:45Vitória', 'America/Sao_Paulo',
    new Date('2026-10-23T12:00:00Z')), '2026-10-23T16:45:00.000Z');
  assert.deepEqual(ordered([{ apiSport: 'basketball_nba', commenceTime: '2026-10-24T00:00:00Z' },
    { apiSport: 'soccer_uefa_europa_league', commenceTime: '2026-10-24T01:00:00Z' }])
    .map(game => game.apiSport), ['soccer_uefa_europa_league', 'basketball_nba']);
});

test('Retabet só abre eventos das ligas configuradas, sem confundir nomes semelhantes', () => {
  const base = 'https://www.retabet.pt/desportos/futebol/';
  assert.equal(retabetLeague(`${base}paises-baixos/eredivisie/a-b/38617901`).apiSport,
    'soccer_netherlands_eredivisie');
  assert.equal(retabetLeague(`${base}espanha/laliga/a-b/38617902`).apiSport,
    'soccer_spain_la_liga');
  assert.equal(retabetLeague(`${base}inglaterra/inglaterra-premier-league-2/a-b/38617903`), null);
  assert.equal(retabetLeague(`${base}peru/liga-1/a-b/38617904`), null);
});

test('Bwin lê jogo, liga, horário e total do próprio feed', () => {
  const line = { key: 'DecimalValue', value: '2.5' };
  const market = { status: 'Visible', name: { value: 'Total golos' },
    parameters: [line, { key: 'Happening', value: 'Goal' },
      { key: 'MarketType', value: 'Over/Under' }, { key: 'Period', value: 'RegularTime' }],
    options: ['Mais 2.5', 'Menos 2.5'].map((name, index) => ({
      name: { value: name }, status: 'Visible', price: { odds: index ? 1.9 : 1.8 },
    })) };
  const data = parseBwinFeed({ fixtures: [{ id: 1, name: { value: 'Porto - Benfica' },
    competition: { name: { value: 'Liga Europa' } }, isOpenForBetting: true,
    startDate: new Date(Date.now() + 3600000).toISOString(), optionMarkets: [market] }] });
  assert.equal(data.games.length, 1);
  assert.equal(data.games[0].apiSport, 'soccer_uefa_europa_league');
  assert.deepEqual(data.games[0].teams, ['Porto', 'Benfica']);
  assert.equal(data.games[0].markets[0].selections.length, 2);
});

test('LeBull lê competição e odds da sua listagem sem lista de outra casa', () => {
  const zoned = date => new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Sao_Paulo',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    hourCycle: 'h23' }).format(date);
  const next = zoned(new Date(Date.now() + 3600000));
  const today = zoned(new Date());
  const clock = next.slice(12, 17);
  const day = next.slice(0, 10) === today.slice(0, 10) ? 'Hoje' : 'Amanhã';
  const cell = (label, price) => `<span class="odd-cell"><span class="odd-cell-label">${label}</span><span class="odd-cell-value"><span class="rank-arrow">${price}</span></span></span>`;
  const html = `<div class="game-row-wrapper"><span>Liga Europa</span><div class="game-row">
    <span class="team-column-name" title="Porto"></span><span class="team-column-name" title="Benfica"></span>
    <span class="betting-table-link">${day} ${clock}</span>
    <div class="game-row-odds-item"><span class="market-name">1X2</span>${cell('1', '2.1')}${cell('X', '3.2')}${cell('2', '3.4')}</div>
    <div class="game-row-odds-item"><span class="market-name">Total de Golos Mais/Menos</span>${cell('O (2.5)', '1.9')}${cell('U (2.5)', '1.9')}</div>
    </div></div>`;
  const result = parseLebullHtml(html);
  assert.equal(result.games.length, 1);
  assert.equal(result.games[0].apiSport, 'soccer_uefa_europa_league');
  assert.deepEqual(result.games[0].teams, ['Porto', 'Benfica']);
  assert.equal(result.games[0].markets.length, 2);
});
