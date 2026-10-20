// Sem rede, chaves, Firebase ou alterações em parâmetros de risco.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { compare, comparedSelectionCount, fairProbabilities, references, report, namesEqual } = require('./placard_value');
const { estimateCost, readingAllowance } = require('./odds_api_monthly_budget');
const { kickoff } = require('./get_placard_odds');
const { captureClosing, exactTotals, exactSpreads, competitionUrl } = require('./run_placard_value');
const now = Date.parse('2026-10-20T12:00:00Z');
function fixture() {
  const game = { teams: ['FC Porto', 'SL Benfica'], apiSport: 'soccer_portugal_primeira_liga',
    competition: 'Portugal - Primeira Liga', commenceTime: '2026-10-20T14:00:00Z',
    observedAt: new Date(now).toISOString(), sourceUrl: 'https://www.placard.pt/apostas',
    markets: [{ type: 'MRES', selections: [2.20, 3.30, 3.30].map(price => ({ price: String(price), line: null, unavailable: false })) }] };
  const event = { id: 'fixture', sport_key: game.apiSport, home_team: 'Porto', away_team: 'Benfica', commence_time: game.commenceTime,
    bookmakers: [{ key: 'pinnacle', last_update: new Date(now).toISOString(), markets: [{ key: 'h2h',
      outcomes: [{ name: 'Porto', price: 2 }, { name: 'Draw', price: 4 }, { name: 'Benfica', price: 4 }] }] }] };
  return { game, event };
}
test('remove margem dos três resultados e preserva probabilidade total', () => {
  const p = fairProbabilities([1.9, 3.8, 3.8]);
  assert.ok(Math.abs(p.reduce((s, v) => s + v, 0) - 1) < 1e-12);
  assert.equal(p[1], p[2]);
  assert.equal(fairProbabilities([1, 2]), null);
});
test('apelidos, empate e Kelly central de 25%', () => {
  const { game, event } = fixture();
  const rows = compare(game, [event], now).rows;
  const home = rows.find(r => r.selection === 'Porto');
  assert.ok(home);
  assert.ok(Math.abs(home.edgePct - 10) < 1e-8);
  assert.ok(Math.abs(home.kellyPct - 2.083333333333333) < 1e-8);
  assert.equal(rows.length, 1);
  assert.ok(namesEqual('Borussia M`gladbach', 'Borussia Monchengladbach'));
  assert.ok(namesEqual('Slavia Praga', 'Slavia Praha'));
  assert.ok(namesEqual('Sabah', 'Sabah FK'));
  assert.ok(namesEqual('Slovan Bratislava', 'ŠK Slovan Bratislava'));
  assert.ok(namesEqual('PSG', 'Paris Saint Germain'));
  assert.ok(namesEqual('NY Knicks', 'New York Knicks'));
});
test('não casa evento ambíguo ou horário diferente', () => {
  const { game, event } = fixture();
  assert.equal(compare(game, [event, { ...event, id: 'other' }], now).reason, 'evento_ambiguo');
  assert.equal(compare(game, [{ ...event, commence_time: '2026-10-21T14:00:00Z' }], now).rows.length, 0);
});
test('conta comparação com o último preço conhecido, sem registrar oportunidade antes da confirmação recente', () => {
  const { game, event } = fixture();
  event.bookmakers[0].last_update = '2026-10-20T10:00:00Z';
  assert.equal(comparedSelectionCount(game, event, now), 3);
  assert.equal(compare(game, [event], now).rows.length, 0);
});
test('descarta preços antigos, futuros e jogo iniciado', () => {
  const { game, event } = fixture();
  assert.equal(compare({ ...game, observedAt: '2026-10-20T11:57:00Z' }, [event], now).rows.length, 0);
  assert.equal(compare({ ...game, observedAt: '2026-10-20T12:01:00Z' }, [event], now).rows.length, 0);
  event.bookmakers[0].last_update = '2026-10-20T11:57:00Z';
  assert.equal(compare(game, [event], now).rows.length, 0);
  assert.equal(compare(game, [event], Date.parse(game.commenceTime)).rows.length, 0);
});
test('totais: exige mesma linha; inteira é condicional a não haver devolução', () => {
  const { game, event } = fixture();
  game.markets = [{ type: 'HCTG', selections: [{ price: '2.2', line: '2.5' }, { price: '1.8', line: '2.5' }] }];
  event.bookmakers[0].markets = [{ key: 'totals', outcomes: [{ name: 'Over', point: 2.5, price: 1.91 }, { name: 'Under', point: 2.5, price: 1.91 }] }];
  assert.equal(compare(game, [event], now).rows.length, 1);
  game.markets[0].selections.forEach(s => { s.line = '3.5'; });
  assert.equal(compare(game, [event], now).rows.length, 0);
  event.bookmakers[0].markets[0].outcomes.forEach(o => { o.point = 3; });
  assert.equal(references(event, now)[0].probabilityBasis, 'condicional_sem_devolucao');
  game.markets[0].selections.forEach(s => { s.line = '3'; });
  assert.equal(compare(game, [event], now).rows.length, 1);
  event.bookmakers[0].markets[0].outcomes.forEach(o => { o.point = 3.25; });
  assert.equal(references(event, now).length, 0);
});
test('handicap exige mesma seleção e linha Pinnacle, preservando linhas assinadas', () => {
  const { game, event } = fixture();
  game.markets = [{ type: 'HAND', title: 'Handicap', selections: [
    { price: '2.2', line: '-1.5' }, { price: '1.8', line: '1.5' },
  ] }];
  event.bookmakers[0].markets = [{ key: 'spreads', outcomes: [
    { name: 'Porto', point: -1.5, price: 1.91 }, { name: 'Benfica', point: 1.5, price: 1.91 },
  ] }];
  const result = compare(game, [event], now);
  assert.equal(result.comparedSelections, 2);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].market, 'spreads');
  assert.equal(result.rows[0].selection, 'Porto');
  game.markets[0].selections[0].line = '-1.25';
  assert.equal(compare(game, [event], now).comparedSelections, 1);
});
test('reserva é 2 créditos por competição, não por partida; histórico custa 10x', () => {
  const options = { bookmakers: 'pinnacle', markets: 'h2h,totals' };
  assert.equal(estimateCost('https://api.the-odds-api.com/v4/sports/basketball_nba/odds', options), 2);
  assert.equal(estimateCost('https://api.the-odds-api.com/v4/historical/sports/basketball_nba/odds', options), 20);
  assert.equal(estimateCost('https://api.the-odds-api.com/v4/sports/basketball_nba/events'), 0);
  assert.equal(readingAllowance(0), 1736);
  assert.equal(readingAllowance(3051), 411);
  assert.equal(readingAllowance(5000), 0);
  assert.equal(estimateCost('https://api.the-odds-api.com/v4/sports/americanfootball_nfl/odds',
    { bookmakers: 'pinnacle', markets: 'h2h,totals,spreads' }), 3);
});
test('busca handicap alternativo exato uma vez por evento', async t => {
  t.mock.method(Date, 'now', () => now);
  const { event } = fixture();
  event.bookmakers[0].markets = [{ key: 'spreads', outcomes: [
    { name: 'Porto', point: -1, price: 1.9 }, { name: 'Benfica', point: 1, price: 1.9 },
  ] }];
  let calls = 0;
  const api = { get: async (url, options) => {
    calls++;
    assert.equal(options.params.markets, 'alternate_spreads');
    return { data: { ...event, bookmakers: [{ key: 'pinnacle', markets: [{ key: 'alternate_spreads',
      outcomes: [{ name: 'Porto', point: -1.5, price: 2 }, { name: 'Benfica', point: 1.5, price: 2 }] }] }] } };
  } };
  const attempted = new Set();
  await exactSpreads(api, event.sport_key, event, [{ selection: 'Porto', line: -1.5 }], attempted);
  assert.equal(references(event, now).filter(r => r.market === 'spreads' && r.line === -1.5).length, 1);
  await exactSpreads(api, event.sport_key, event, [{ selection: 'Porto', line: -1.5 }], attempted);
  assert.equal(calls, 1);
});
test('seleciona o nome exato da competição e não mistura categorias parecidas', () => {
  assert.equal(competitionUrl([
    { text: 'Premier League', href: 'https://placard/england/premier/matches' },
    { text: 'Inglaterra - Premier League', href: 'https://placard/other/premier/matches' },
  ], { label: 'Premier League', aliases: [], sport: 'soccer' }), 'https://placard/england/premier/matches');
  assert.equal(competitionUrl([
    { text: 'Ningbo - Individual', href: 'https://placard/ningbo/singles/matches' },
    { text: 'Ningbo - Pares', href: 'https://placard/ningbo/doubles/matches' },
  ], { key: 'tennis_wta_ningbo_open', label: 'Ningbo - Individual', aliases: ['Ningbo'], sport: 'tennis' }),
  'https://placard/ningbo/singles/matches');
});
test('reconcilia partidas de ténis pelo par de jogadores quando o horário estimado varia', () => {
  const start = '2026-10-20T14:05:00.000Z';
  const game = { apiSport: 'tennis_wta_ningbo_open', teams: ['Marie Bouzkova', 'Anastasia Zakharova'],
    competition: 'Ningbo - Individual', commenceTime: start, observedAt: new Date(now).toISOString(),
    markets: [{ type: 'H2HT', selections: [{ price: '2.2', line: null }, { price: '2.2', line: null }] }] };
  const event = { id: 'wta', sport_key: game.apiSport, home_team: game.teams[0], away_team: game.teams[1],
    commence_time: '2026-10-20T14:00:00Z', bookmakers: [{ key: 'pinnacle', last_update: new Date(now).toISOString(),
      markets: [{ key: 'h2h', outcomes: [{ name: game.teams[0], price: 2 }, { name: game.teams[1], price: 2 }] }] }] };
  const result = compare(game, [event], now);
  assert.equal(result.rows.length, 2);
  assert.equal(result.rows[0].commenceTime, start);
  assert.equal(result.rows[0].apiCommenceTime, event.commence_time);
});
test('veredito respeita n≥100 e IC positivo; correlação não cria novas amostras independentes', () => {
  const entries = Array.from({ length: 100 }, (_, i) => ({ eventId: String(i), apiSport: 'nba', clvPct: 2, closingStatus: 'capturada' }));
  assert.equal(report(entries).verdict, 'confirmado');
  assert.equal(report(entries.slice(1)).verdict, 'não confirmado');
  assert.equal(report(entries.map(e => ({ ...e, clvPct: -2 }))).verdict, 'não confirmado');
  assert.equal(report(entries.map(e => ({ ...e, eventId: 'same-event' }))).lower, null);
});
test('data relativa do Placard usa UTC explícito e vira o ano corretamente', () => {
  assert.equal(kickoff('Hoje, 19:00', now), '2026-10-20T19:00:00.000Z');
  assert.equal(kickoff('Amanhã, 19:00', now), '2026-10-21T19:00:00.000Z');
  assert.equal(kickoff('1 de jan., 19:00', Date.parse('2026-12-31T12:00:00Z')), '2027-01-01T19:00:00.000Z');
});
test('fechamento nunca aceita preço observado após início', async t => {
  t.mock.method(Date, 'now', () => now);
  const updates = [];
  const db = { collection: () => ({ doc: () => ({ update: async data => updates.push(data) }) }) };
  await captureClosing(db, [{ id: 'a', closingStatus: 'pendente', commenceTime: '2026-10-20T11:59:00Z',
    placardOdds: 2.2, closingCandidate: { probability: 0.5, updatedAt: '2026-10-20T11:58:00Z', capturedAt: '2026-10-20T12:00:00Z' } }]);
  assert.equal(updates[0].closingStatus, 'indisponivel');
  assert.equal(updates[0].clvPct, undefined);
});
test('busca total alternativo exato uma vez, sem aproximar o total principal', async t => {
  t.mock.method(Date, 'now', () => now);
  const { event } = fixture();
  event.bookmakers[0].markets.push({ key: 'totals', last_update: new Date(now).toISOString(),
    outcomes: [{ name: 'Over', price: 1.9, point: 3.25 }, { name: 'Under', price: 1.9, point: 3.25 }] });
  let calls = 0;
  const api = { get: async (url, options) => {
    calls++;
    assert.ok(url.includes('/events/fixture/odds'));
    assert.equal(options.params.markets, 'alternate_totals');
    return { data: { ...event, bookmakers: [{ key: 'pinnacle', markets: [{ key: 'alternate_totals',
      last_update: new Date(now).toISOString(), outcomes: [{ name: 'Over', price: 2, point: 3.5 }, { name: 'Under', price: 2, point: 3.5 }] }] }] } };
  } };
  const attempted = new Set();
  await exactTotals(api, event.sport_key, event, [3.5], attempted);
  assert.equal(references(event, now).filter(r => r.market === 'totals' && r.line === 3.5).length, 2);
  await exactTotals(api, event.sport_key, event, [3.5], attempted);
  assert.equal(calls, 1);
});
