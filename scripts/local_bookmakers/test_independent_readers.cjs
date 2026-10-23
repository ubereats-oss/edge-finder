const { test } = require('node:test');
const assert = require('node:assert/strict');
const { competition, localClock, ordered } = require('./local_competitions.cjs');
const { parseBwinFeed, parseLebullHtml, retabetLeague, goldenparkClock,
  betclicClock } = require('./fast_readers.cjs');
const { classifyVpnCharge } = require('../../pipeline/local_bookmaker_cycle_fast.cjs');

test('GoldenPark interpreta a data curta da listagem na hora de Brasília', () => {
  assert.equal(goldenparkClock('Sex 23 out 17:00', new Date('2026-10-23T18:00:00Z')),
    '2026-10-23T20:00:00.000Z');
  assert.equal(goldenparkClock('Sáb 24 out 11:30', new Date('2026-10-23T18:00:00Z')),
    '2026-10-24T14:30:00.000Z');
});

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
    .map(game => game.apiSport), ['basketball_nba', 'soccer_uefa_europa_league']);
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

test('Bwin NBA lê Money Line, handicap com sinais opostos e totais do feed games', () => {
  const teams = ['New York Knicks', 'Boston Celtics'];
  const fixture = { id: 7, name: { value: `${teams[0]} em casa dos ${teams[1]}` },
    competition: { name: { value: 'NBA' } }, isOpenForBetting: true,
    startDate: new Date(Date.now() + 3600000).toISOString(),
    participants: teams.map((name, index) => ({ participantId: index + 1,
      name: { value: name, short: index ? 'BOS Celtics' : 'NY Knicks' } })),
    games: [
      { name: { value: 'Money Line (EUA)' }, results: teams.map((_, index) => ({
        sourceName: { value: String(index + 1) }, name: { value: index ? 'BOS Celtics' : 'NY Knicks' },
        odds: index ? 1.62 : 2.05, visibility: 'Visible' })) },
      { name: { value: 'Diferença de pontos' }, results: teams.map((name, index) => ({
        playerId: index + 1, name: { value: `${name} ${index ? '-3.5' : '+3.5'}` },
        attr: index ? '-3.5' : '+3.5', odds: index ? 1.85 : 1.72, visibility: 'Visible' })) },
      { name: { value: 'Totais' }, results: ['Mais de 220.5', 'Menos de 220.5'].map(name => ({
        name: { value: name }, odds: 1.78, visibility: 'Visible' })) },
    ] };
  const result = parseBwinFeed({ fixtures: [fixture] });
  assert.equal(result.games.length, 1);
  assert.deepEqual(result.games[0].teams, teams);
  assert.deepEqual(result.games[0].markets.map(market => market.type), ['H2HT', 'HCOT', 'TPOT']);
  assert.deepEqual(result.games[0].markets[1].selections.map(side => side.line), [3.5, -3.5]);
  assert.deepEqual(result.games[0].markets[2].selections.map(side => side.line), [220.5, 220.5]);
});

test('Betclic interpreta os nove jogos NBA descartados às 16:15 sem trocar o dia', () => {
  const now = new Date('2026-10-23T19:11:26Z');
  const games = [
    ['Boston Celtics x New York Knicks', 'Hoje', '00:00', '2026-10-23T23:10:00Z'],
    ['Charlotte Hornets x Atlanta Hawks', 'Hoje', '00:00', '2026-10-23T23:10:00Z'],
    ['Washington Wizards x Toronto Raptors', 'Hoje', '00:00', '2026-10-23T23:10:00Z'],
    ['Indiana Pacers x Dallas Mavericks', 'Hoje', '00:00', '2026-10-23T23:10:00Z'],
    ['Orlando Magic x Minnesota Timberwolves', 'Hoje', '00:00', '2026-10-23T23:10:00Z'],
    ['Miami Heat x Detroit Pistons', '24 out', '01:00', '2026-10-24T00:10:00Z'],
    ['San Antonio Spurs x Houston Rockets', '24 out', '02:30', '2026-10-24T01:40:00Z'],
    ['Utah Jazz x New Orleans Pelicans', '24 out', '02:30', '2026-10-24T01:40:00Z'],
    ['Sacramento Kings x Portland Trail Blazers', '24 out', '03:00', '2026-10-24T02:10:00Z'],
  ];
  for (const [game, day, clock, pinnacleStart] of games) {
    const observed = betclicClock(day, clock, now);
    assert.ok(observed, game);
    assert.ok(Math.abs(Date.parse(observed) - Date.parse(pinnacleStart)) <= 600000, game);
  }
});

test('ciclo sem conexão cobra 0 MB e falha de bytes conectado estima 60 MB sem bloquear', () => {
  assert.deepEqual(classifyVpnCharge(false, null, null),
    { bytes: 0, estimated: false, reason: 'ciclo sem conexão' });
  assert.deepEqual(classifyVpnCharge(true, null, null),
    { bytes: 60000000, estimated: true, reason: 'bytes da placa indisponíveis; estimativa conservadora' });
  assert.deepEqual(classifyVpnCharge(true, { receivedBytes: 10, sentBytes: 5 },
    { receivedBytes: 1010, sentBytes: 105 }), { bytes: 1100, estimated: false, reason: null });
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

test('LeBull mantém NBA na primeira prioridade e extrai vencedor e total de pontos', () => {
  const next = new Date(Date.now() + 3600000);
  const current = new Date();
  const date = value => new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Sao_Paulo',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    hourCycle: 'h23' }).format(value);
  const clock = date(next).slice(12, 17);
  const day = date(next).slice(0, 10) === date(current).slice(0, 10) ? 'Hoje' : 'Amanhã';
  const cell = (label, price) => `<span class="odd-cell"><span class="odd-cell-label">${label}</span><span class="odd-cell-value"><span class="rank-arrow">${price}</span></span></span>`;
  const html = `<div><span>NBA</span><div class="game-row">
    <span class="team-column-name" title="Chicago Bulls"></span><span class="team-column-name" title="Milwaukee Bucks"></span>
    <span class="betting-table-link">${day} ${clock}</span>
    <div class="game-row-odds-item"><span class="market-name">Vencedor</span>${cell('1', '1.86')}${cell('2', '1.74')}</div>
    <div class="game-row-odds-item"><span class="market-name">Total de Pontos Mais/Menos</span>${cell('O (240.5)', '1.79')}${cell('U (240.5)', '1.76')}</div>
  </div></div>`;
  const result = parseLebullHtml(html);
  assert.equal(result.games.length, 1);
  assert.deepEqual(result.games[0].markets.map(market => market.type), ['H2HT', 'TPOT']);
  assert.equal(result.audit[0].reason, 'aceito');
});
