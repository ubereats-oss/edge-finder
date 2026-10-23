// Sem rede, chaves, Firebase ou alterações em parâmetros de risco.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { compare, compareBookmaker, comparedSelectionCount, fairProbabilities, references, report, betClvReport, namesEqual, matchingEvents } = require('./placard_value');
const { estimateCost, summarize, planReservation, keyFingerprint, parseHeaders,
  refreshBalances, CLOSING_RESERVE, READING_MARGIN, SCHEMA_VERSION,
  MONTHLY_SPEND_CAP, MONTHLY_READ_CAP, trackUsage } = require('./odds_api_monthly_budget');
const { kickoff } = require('./get_placard_odds');
const { captureClosing, exactTotals, exactSpreads, closingStartTolerance, competitionUrl, forEachCompetitionIsolated, pinnacleRefreshDue } = require('./run_placard_value');
const { readSelections, adaptTotalsAndHandicaps, tunnelCycleAffordable, monthKey, MAX_MEASURED_CYCLE_MB } = require('./local_betano_reader');
const { parseMarkets, matchLink, eventTimeMatches } = require('../scripts/local_bookmakers/retabet_reader.cjs');
const { isBetanoHeartbeatStale, isBetanoScheduledHeartbeatStale } = require('./check_closing_odds_staleness');
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
  assert.ok(namesEqual('Virtus Bologna', 'Virtus Segafredo Bologna'));
});

test('variações verificadas de clubes preservam os dois times e o horário do jogo', () => {
  const pairs = [
    ['Ferencvaros TC', 'Ferencváros TC'], ['SC União Torreense', 'Torreense'],
    ['Marselha', 'Marseille'], ['GNK Dinamo Zagreb', 'Dinamo Zagreb'],
    ['Juventus FC', 'Juventus'], ['OFI Creta', 'OFI Crete'],
    ['Besiktas', 'Besiktas JK'], ['FC Viktoria Plzen', 'Viktoria Plzeň'],
    ['Jagiellonia Bialystok', 'Jagiellonia Białystok'], ['Salzburgo', 'Salzburg'],
    ['Lillestrom SK', 'Lillestrom'], ['Hoffenheim', 'TSG Hoffenheim'],
    ['Olympiacos', 'Olympiakos Piraeus'], ['AC Omonia Nicosia', 'Omonoia FC'],
    ['AFC Bournemouth', 'Bournemouth'], ['AC Milão', 'AC Milan'],
  ];
  for (const [source, pinnacle] of pairs) assert.ok(namesEqual(source, pinnacle), `${source} / ${pinnacle}`);
  assert.equal(namesEqual('AC Milan', 'Inter Milan'), false);
  const game = { apiSport: 'soccer_uefa_europa_league', teams: ['AFC Bournemouth', 'AC Milão'],
    commenceTime: '2026-10-22T19:00:00Z' };
  const event = { home_team: 'Bournemouth', away_team: 'AC Milan', commence_time: game.commenceTime };
  assert.deepEqual(matchingEvents(game, [event]), [event]);
  assert.deepEqual(matchingEvents({ ...game, teams: ['AC Milan', 'AC Milão'] }, [event]), []);
  assert.deepEqual(matchingEvents(game, [{ ...event, commence_time: '2026-10-22T19:02:00Z' }]), []);
});
test('compara outra casa com identidade e IDs separados sem mudar preço mínimo ou Kelly', () => {
  const { game, event } = fixture();
  const placard = compare(game, [event], now).rows[0];
  const local = compareBookmaker('Betano', game, [event], now).rows[0];
  assert.equal(local.bookmaker, 'Betano');
  assert.equal(local.sourceOdds, local.placardOdds);
  assert.notEqual(local.id, placard.id);
  assert.equal(local.minValueOdds, placard.minValueOdds);
  assert.equal(local.kellyPct, placard.kellyPct);
  assert.throws(() => compareBookmaker('', game, [event], now), /bookmaker obrigatório/);
});
test('Betano aceita diferença de início de até 10 minutos só com partida única e preserva Kelly', () => {
  const { game, event } = fixture();
  event.commence_time = '2026-10-20T14:10:00Z';
  const result = compareBookmaker('Betano', game, [event], now, { startToleranceMs: 10 * 60000 });
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].commenceTime, game.commenceTime);
  assert.equal(result.rows[0].apiCommenceTime, event.commence_time);
  assert.equal(result.rows[0].sourceScheduleVerified, true);
  assert.equal(result.rows[0].scheduleDeltaMs, 10 * 60000);
  assert.equal(result.rows[0].kellyPct, compare(game, [{ ...event, commence_time: game.commenceTime }], now).rows[0].kellyPct);
  assert.equal(compareBookmaker('Betano', game, [event], now).rows.length, 0);
  assert.equal(compareBookmaker('Betano', game, [event, { ...event, id: 'duplicate' }], now,
    { startToleranceMs: 10 * 60000 }).reason, 'evento_ambiguo');
  assert.throws(() => compareBookmaker('Betano', game, [event], now, { startToleranceMs: 11 * 60000 }), /tolerância/);
});
test('qualidade barra margem, preço extremo, nomes, liga e horário com motivo por seleção', () => {
  const { game, event } = fixture();
  const check = (changedGame, changedEvent = event) => compareBookmaker('Betano', changedGame,
    [changedEvent], now, { startToleranceMs: 10 * 60000 });
  assert.equal(check(game).rows.length, 1);
  assert.ok(check({ ...game, markets: [{ type: 'MRES', selections: [
    { price: 5, line: null }, { price: 5, line: null }, { price: 5, line: null } ] }] })
    .blockedSelections.every(row => row.reason === 'margem_fora_0_25'));
  const extreme = { ...game, markets: [{ type: 'MRES', selections: [
    { price: 3, line: null }, { price: 2.4, line: null }, { price: 3.5, line: null } ] }] };
  assert.ok(check(extreme).blockedSelections.some(row => row.reason === 'diferenca_preco_acima_30'));
  assert.equal(check({ ...game, teams: ['Porto', 'Outra Equipa'] }).blockedSelections[0].reason,
    'evento_sem_correspondencia');
  assert.equal(check({ ...game, competition: 'Premier League' }).blockedSelections[0].reason,
    'liga_divergente_nome_variado');
  assert.equal(check(game, { ...event, commence_time: '2026-10-20T14:11:00Z' })
    .blockedSelections[0].reason, 'evento_sem_correspondencia');
});
test('qualidade exige linha idêntica e sinal correspondente em handicap e totais', () => {
  const { game, event } = fixture();
  game.markets = [{ type: 'HCOT', selections: [
    { price: 2.2, line: -1.5 }, { price: 1.8, line: 1.5 } ] }];
  event.bookmakers[0].markets = [{ key: 'spreads', outcomes: [
    { name: 'Porto', point: -2.5, price: 1.91 }, { name: 'Benfica', point: 2.5, price: 1.91 } ] }];
  assert.ok(compare(game, [event], now).blockedSelections.every(row => row.reason === 'linha_divergente'));
  event.bookmakers[0].markets[0].outcomes[0].point = 1.5;
  event.bookmakers[0].markets[0].outcomes[1].point = -1.5;
  assert.ok(compare(game, [event], now).blockedSelections.every(row => row.reason === 'sinal_handicap_divergente'));
  game.markets = [{ type: 'HCTG', selections: [
    { price: 2.2, line: 221.5 }, { price: 1.8, line: 221.5 } ] }];
  event.bookmakers[0].markets = [{ key: 'totals', outcomes: [
    { name: 'Over', point: 222.5, price: 1.91 }, { name: 'Under', point: 222.5, price: 1.91 } ] }];
  assert.ok(compare(game, [event], now).blockedSelections.every(row => row.reason === 'linha_divergente'));
});
test('leitor Betano transforma JSON de rede em vencedor, handicap e total sem ler texto da página', () => {
  const games = readSelections({ data: { events: [{ id: 7, sportId: 'BASK', startTime: Date.parse('2026-10-20T14:00:00Z'),
    shortName: 'Porto x Benfica', leagueName: 'NBA', url: '/odds/test', participants: [{ name: 'Porto' }, { name: 'Benfica' }],
    sixPackBlocks: [{ columns: [
      { type: 'H2HT', name: 'Vencedor', selections: [{ name: 'Porto', price: 2.2 }, { name: 'Benfica', price: 1.7 }] },
      { type: 'FHOT', name: 'Handicap', selections: [{ name: 'Porto -2.5', fullName: 'Porto', price: 1.9, handicap: -2.5 },
        { name: 'Benfica +2.5', fullName: 'Benfica', price: 1.9, handicap: 2.5 }] },
      { type: 'FTPO', name: 'Total de pontos', selections: [{ name: 'Mais de 2.5', price: 1.9, handicap: 2.5 },
        { name: 'Menos 2.5', price: 1.9, handicap: 2.5 }] },
    ] }] }] } });
  assert.equal(games.length, 1);
  const game = adaptTotalsAndHandicaps(games[0]);
  assert.deepEqual(game.markets.map(m => m.type), ['H2HT', 'HCOT', 'HCTG']);
  assert.deepEqual(game.markets[2].selections.map(s => s.name), ['Over', 'Under']);
  assert.deepEqual(game.markets[1].selections.map(s => s.line), [-2.5, 2.5]);
});
test('leitor Betano normaliza feed Futebol MRES e identifica Liga Europa', () => {
  const games = readSelections({ data: { events: [{ id: '91651566', sportId: 'FOOT', startTime: Date.parse('2026-10-22T00:30:00Z'),
    shortName: 'Ferencvaros TC - SC União Torreense', leagueName: 'Liga Europa', regionName: 'UEFA Liga Europa',
    url: '/odds/ferencvaros-tc-sc-uniao-torreense/91651566/',
    participants: [{ name: 'Ferencvaros TC' }, { name: 'SC União Torreense' }], markets: [
      { type: 'MRES', name: 'Resultado Final', selections: [
        { name: '1', fullName: 'Ferencvaros TC', price: 1.32 }, { name: 'X', fullName: 'Empate', price: 5 },
        { name: '2', fullName: 'SC União Torreense', price: 8 }] },
      { type: 'HCTG', name: 'Total de Golos Mais/Menos', selections: [
        { name: 'Mais de 2.5', price: 1.52, handicap: 2.5 }, { name: 'Menos 2.5', price: 2.1, handicap: 2.5 }] },
    ] }] } });
  assert.equal(games.length, 1);
  assert.equal(games[0].apiSport, 'soccer_uefa_europa_league');
  assert.deepEqual(games[0].markets.map(m => m.type), ['MRES', 'HCTG']);
  assert.deepEqual(adaptTotalsAndHandicaps(games[0]).markets[1].selections.map(s => s.name), ['Over', 'Under']);
});
test('Retabet confirma partida e converte HTML pré-jogo em 3 vencedores e 2 totais da mesma linha', () => {
  const game = { teams: ['FC Ararat-Armenia', 'AZ Alkmaar'] };
  const url = 'https://www.retabet.pt/desportos/futebol/europa/liga-europa/fc-ararat-armenia-az-alkmaar/38596110';
  assert.equal(matchLink(game, [url]), url);
  assert.equal(eventTimeMatches('FC Ararat-Armenia\nHoje\n17:45\nAZ Alkmaar',
    '2026-10-22T16:45:00.000Z', new Date('2026-10-22T12:00:00Z')), true);
  assert.equal(eventTimeMatches('FC Ararat-Armenia\nHoje\n18:45\nAZ Alkmaar',
    '2026-10-22T16:45:00.000Z', new Date('2026-10-22T12:00:00Z')), false);
  const markets = parseMarkets([
    { title: '1-X-2', options: [
      { label: '1', price: '6,95' }, { label: 'X', price: '4,98' }, { label: '2', price: '1,38' },
    ] },
    { title: 'Mais/menos golos', options: [
      { label: '+ de 2,5', price: '1,44' }, { label: '- de 2,5', price: '2,40' },
      { label: '+ de 3,5', price: '1,90', locked: true }, { label: '- de 3,5', price: '1,90' },
    ] },
  ]);
  assert.deepEqual(markets.map(market => market.type), ['MRES', 'HCTG']);
  assert.deepEqual(markets[0].selections.map(selection => selection.price), [6.95, 4.98, 1.38]);
  assert.deepEqual(markets[1].selections.map(selection => [selection.name, selection.line, selection.price]),
    [['Over', 2.5, 1.44], ['Under', 2.5, 2.4]]);
});
test('alerta Betano fica stale sem sucesso ou depois de 6h', () => {
  const instant = Date.parse('2026-10-21T12:00:00Z');
  assert.equal(isBetanoHeartbeatStale(null, instant), true);
  assert.equal(isBetanoHeartbeatStale(new Date(instant - 6 * 3600000 - 1).toISOString(), instant), true);
  assert.equal(isBetanoHeartbeatStale(new Date(instant - 5 * 3600000).toISOString(), instant), false);
  assert.equal(isBetanoHeartbeatStale(new Date(instant + 1).toISOString(), instant), true);
});
test('alerta local respeita a grade de Brasília e a tolerância de 45 minutos', () => {
  const previous = '2026-10-21T02:30:00Z'; // 20/10 23h30 em Brasília
  assert.equal(isBetanoScheduledHeartbeatStale(previous, Date.parse('2026-10-21T13:00:00Z')), false);
  assert.equal(isBetanoScheduledHeartbeatStale(previous, Date.parse('2026-10-21T14:46:00Z')), true);
  assert.equal(isBetanoScheduledHeartbeatStale('2026-10-21T14:15:00Z', Date.parse('2026-10-21T14:46:00Z')), false);
});
test('bloqueio conservador da franquia TunnelBear antes do ciclo seguinte', () => {
  assert.equal(MAX_MEASURED_CYCLE_MB, 18);
  assert.equal(tunnelCycleAffordable(3800), true);
  assert.equal(tunnelCycleAffordable(3801), false);
  assert.equal(tunnelCycleAffordable(Number.NaN), false);
  assert.equal(monthKey(Date.parse('2026-11-01T01:30:00Z')), '2026-10');
  assert.equal(monthKey(Date.parse('2026-11-01T03:00:00Z')), '2026-11');
});
test('tolerância de fechamento ampliada só para Betano verificada; demais casas continuam estritas', () => {
  assert.equal(closingStartTolerance({ bookmaker: 'Betano', sourceScheduleVerified: true }, 'basketball_nba'), 600000);
  assert.equal(closingStartTolerance({ bookmaker: 'Betano', sourceScheduleVerified: false }, 'basketball_nba'), 60000);
  assert.equal(closingStartTolerance({ bookmaker: 'Placard', sourceScheduleVerified: true }, 'basketball_nba'), 60000);
  assert.equal(closingStartTolerance({ bookmaker: 'Betano' }, 'tennis_wta_ningbo_open'), 3 * 60 * 60 * 1000);
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
test('códigos Placard HTOH, HCOT e TGHC cobrem vencedor e handicap', () => {
  const { game, event } = fixture();
  game.markets = [
    { type: 'HTOH', selections: [{ price: '2.8', line: null }, { price: '2.8', line: null }] },
    { type: 'HCOT', selections: [{ price: '2.2', line: '-1.5' }, { price: '1.8', line: '1.5' }] },
  ];
  event.bookmakers[0].markets = [
    { key: 'h2h', outcomes: [{ name: 'Porto', price: 2 }, { name: 'Draw', price: 4 }, { name: 'Benfica', price: 2 }] },
    { key: 'spreads', outcomes: [{ name: 'Porto', point: -1.5, price: 1.91 }, { name: 'Benfica', point: 1.5, price: 1.91 }] },
  ];
  assert.equal(compare(game, [event], now).rows.length, 1);
  assert.equal(compare(game, [event], now).blockedSelections.filter(row => row.reason === 'margem_fora_0_25').length, 2);
  game.markets[1].type = 'TGHC';
  assert.equal(compare(game, [event], now).rows.length, 1);
});
test('estima custo por mercado, incluindo histórico e linhas alternativas', () => {
  const options = { bookmakers: 'pinnacle', markets: 'h2h,totals' };
  assert.equal(estimateCost('https://api.the-odds-api.com/v4/sports/basketball_nba/odds', options), 2);
  assert.equal(estimateCost('https://api.the-odds-api.com/v4/historical/sports/basketball_nba/odds', options), 20);
  assert.equal(estimateCost('https://api.the-odds-api.com/v4/sports/basketball_nba/events'), 0);
  assert.equal(estimateCost('https://api.the-odds-api.com/v4/sports/americanfootball_nfl/odds',
    { bookmakers: 'pinnacle', markets: 'h2h,totals,spreads' }), 3);
});
test('ledger deriva saldo e preserva reserva de fechamento mais margem para leituras', () => {
  const a = keyFingerprint('key-a');
  const b = keyFingerprint('key-b');
  const state = { schemaVersion: SCHEMA_VERSION, syncComplete: true, closingReserve: CLOSING_RESERVE,
    keyFingerprints: [a, b], keyBalances: { [a]: { remaining: 4000 }, [b]: { remaining: 1925 } },
    pendingRequests: {} };
  assert.equal(summarize(state).totalRemaining, 5925);
  assert.equal(summarize(state).readingAvailable, 4925);
  assert.equal(planReservation(state, ['key-a', 'key-b'], 3, 'placard-scan').availableAfter, 5922);
  assert.throws(() => planReservation({ ...state, keyBalances: { [a]: { remaining: 500 }, [b]: { remaining: 300 } } },
    ['key-a', 'key-b'], 3, 'placard-scan'), /disponível_leituras=0/);
  assert.equal(planReservation({ ...state, keyBalances: { [a]: { remaining: 500 }, [b]: { remaining: 300 } } },
    ['key-a', 'key-b'], 3, 'placard-closing').remaining, 500);
});
test('ledger usa saldo mais recente e falha fechado sem o header de saldo real', () => {
  assert.deepEqual(parseHeaders({ 'x-requests-remaining': '5925', 'x-requests-used': '100', 'x-requests-last': '3' }),
    { remaining: 5925, used: 100, last: 3 });
  assert.throws(() => parseHeaders({ 'x-requests-used': '100' }), /x-requests-remaining/);
});
test('saldo real dispensa teto fixo; falha de leitura recorre ao limite antigo', () => {
  const key = keyFingerprint('key-a');
  const state = { schemaVersion: SCHEMA_VERSION, syncComplete: true, closingReserve: CLOSING_RESERVE,
    keyFingerprints: [key], keyBalances: { [key]: { remaining: 6000, used: MONTHLY_READ_CAP - 1 } }, pendingRequests: {} };
  assert.equal(MONTHLY_SPEND_CAP, 5000);
  assert.equal(MONTHLY_READ_CAP, 4200);
  assert.equal(READING_MARGIN, 200);
  assert.equal(planReservation(state, ['key-a'], 2, 'placard-scan').balanceMode, 'real');
  const fallback = { ...state, syncComplete: false };
  assert.equal(planReservation(fallback, ['key-a'], 1, 'placard-scan').balanceMode, 'limite_antigo');
  assert.throws(() => planReservation(fallback, ['key-a'], 2, 'placard-scan'), /Teto mensal de leituras/);
  const closingState = { ...fallback, keyBalances: { [key]: { remaining: 6000, used: 4999 } } };
  assert.equal(planReservation(closingState, ['key-a'], 1, 'placard-closing').balanceMode, 'limite_antigo');
  assert.throws(() => planReservation(closingState, ['key-a'], 2, 'placard-closing'), /Teto mensal de créditos totais/);
  const floorState = { ...state, keyBalances: { [key]: { remaining: 1000, used: 5000 } } };
  assert.throws(() => planReservation(floorState, ['key-a'], 1, 'placard-scan'), /Saldo real insuficiente/);
  assert.equal(planReservation(floorState, ['key-a'], 1, 'placard-closing').balanceMode, 'real');
});

test('uso externo é a diferença entre gasto da API desde a primeira leitura e gasto próprio', () => {
  const at = '2026-10-23T12:00:00Z';
  const first = trackUsage(null, { remaining: 4000, used: 10, last: 0 }, at);
  const own = trackUsage(first, { remaining: 3997, used: 13, last: 3 }, at, 3);
  assert.equal(own.suspiciousDifference, 0);
  const external = trackUsage(own, { remaining: 3995, used: 15, last: 0 }, at);
  assert.equal(external.suspiciousDifference, 2);
  assert.equal(external.systemUsed, 3);
});
test('Pinnacle atualiza em toda leitura até 2h e de hora em hora entre 2h e 6h', () => {
  const instant = Date.parse('2026-10-21T12:00:00Z');
  assert.equal(pinnacleRefreshDue(2 * 3600000, new Date(instant).toISOString(), null, instant), true);
  assert.equal(pinnacleRefreshDue(90 * 60000, new Date(instant - 10 * 60000).toISOString(), null, instant), true);
  assert.equal(pinnacleRefreshDue(3 * 3600000, new Date(instant - 59 * 60000).toISOString(), null, instant), false);
  assert.equal(pinnacleRefreshDue(3 * 3600000, new Date(instant - 60 * 60000).toISOString(), null, instant), true);
  assert.equal(pinnacleRefreshDue(7 * 3600000, null, null, instant), false);
});
test('reconcilia o ledger com os headers de saldo de cada chave sem persistir as chaves', async () => {
  let saved = null;
  const ref = {
    get: async () => ({ data: () => saved }),
  };
  const db = {
    collection: () => ({ doc: () => ref }),
    runTransaction: async fn => fn({
      get: async () => ({ data: () => saved }),
      set: (_ref, value) => { saved = value; },
    }),
  };
  const keys = ['key-a', 'key-b'];
  const first = await refreshBalances(keys, { db, now: Date.parse('2026-10-21T12:00:00Z'),
    httpGet: async (_url, { params }) => ({ headers: params.apiKey === 'key-a'
      ? { 'x-requests-remaining': '4000', 'x-requests-used': '10', 'x-requests-last': '0' }
      : { 'x-requests-remaining': '1925', 'x-requests-used': '20', 'x-requests-last': '0' } }) });
  assert.equal(first.totalRemaining, 5925);
  assert.equal(first.readingAvailable, 4925);
  assert.equal(saved.syncComplete, true);
  assert.equal(JSON.stringify(saved).includes('key-a'), false);
  const second = await refreshBalances(keys, { db, now: Date.parse('2026-10-21T12:01:00Z'),
    httpGet: async (_url, { params }) => ({ headers: params.apiKey === 'key-a'
      ? { 'x-requests-remaining': '3997', 'x-requests-used': '13', 'x-requests-last': '3' }
      : { 'x-requests-remaining': '1925', 'x-requests-used': '20', 'x-requests-last': '0' } }) });
  assert.equal(second.totalRemaining, 5922);
  assert.equal(second.keyStatuses[0].status, 'uso externo suspeito');
  assert.equal(second.keyStatuses[0].difference, 3);
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
test('erro numa competição é registado e as competições seguintes continuam', async () => {
  const processed = [];
  const failures = [];
  await forEachCompetitionIsolated(['NBA', 'La Liga', 'NHL'], async competition => {
    processed.push(competition);
    if (competition === 'La Liga') throw new Error('cota temporariamente indisponível');
  }, (competition, error) => failures.push({ competition, error: error.message }));
  assert.deepEqual(processed, ['NBA', 'La Liga', 'NHL']);
  assert.deepEqual(failures, [{ competition: 'La Liga', error: 'cota temporariamente indisponível' }]);
});
test('reconcilia partidas de ténis pelo par de jogadores quando o horário estimado varia', () => {
  const start = '2026-10-20T14:05:00.000Z';
  const game = { apiSport: 'tennis_wta_ningbo_open', teams: ['Marie Bouzkova', 'Anastasia Zakharova'],
    competition: 'Ningbo - Individual', commenceTime: start, observedAt: new Date(now).toISOString(),
    markets: [{ type: 'H2HT', selections: [{ price: '2.2', line: null }, { price: '1.6', line: null }] }] };
  const event = { id: 'wta', sport_key: game.apiSport, home_team: game.teams[0], away_team: game.teams[1],
    commence_time: '2026-10-20T14:00:00Z', bookmakers: [{ key: 'pinnacle', last_update: new Date(now).toISOString(),
      markets: [{ key: 'h2h', outcomes: [{ name: game.teams[0], price: 2 }, { name: game.teams[1], price: 2 }] }] }] };
  const result = compare(game, [event], now);
  assert.equal(result.rows.length, 1);
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

test('aposta vinculada mostra CLV da indicação e da odd apostada na mesma seleção e fechamento', () => {
  const entries = [{ id: 'indicacao-1', bookmaker: 'Placard', game: 'Porto x Benfica',
    market: 'totals', line: 2.5, selection: 'Over', sourceOdds: 2.1,
    closingStatus: 'capturada', closingFairOdds: 2 }];
  const bets = [{ id: 'aposta-1', indicationId: 'indicacao-1', odds: 2.2 },
    { id: 'aposta-sem-indicacao', odds: 3 }];
  const result = betClvReport(entries, bets);
  assert.equal(result.total, 1);
  assert.equal(result.withClosing, 1);
  assert.ok(Math.abs(result.indicationMean - 5) < 1e-10);
  assert.ok(Math.abs(result.placedMean - 10) < 1e-10);
  assert.equal(result.rows[0].line, 2.5);
  assert.equal(betClvReport([{ ...entries[0], closingStatus: 'indisponivel' }], bets).withClosing, 0);
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
