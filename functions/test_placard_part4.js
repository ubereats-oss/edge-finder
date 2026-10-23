const test = require('node:test');
const assert = require('node:assert/strict');
const { telegramMessage, revalidate, fetchPinnacleEvent } = require('./placard_part4');
const budget = require('./odds_api_monthly_budget');

const now = Date.parse('2026-10-23T16:00:00Z');
const event = { id: 'event-1', sport_key: 'basketball_nba', home_team: 'Team A', away_team: 'Team B',
  commence_time: '2026-10-23T18:00:00Z', bookmakers: [{ key: 'pinnacle',
    markets: [{ key: 'h2h', last_update: '2026-10-23T15:59:30Z', outcomes: [
      { name: 'Team A', price: 2 }, { name: 'Team B', price: 2 },
    ] }] }] };
const row = { id: 'opp-1', apiSport: 'basketball_nba', eventId: 'event-1', bookmaker: 'Placard',
  game: 'Team A x Team B', market: 'h2h', line: null, selection: 'Team A',
  commenceTime: event.commence_time, placardObservedAt: '2026-10-23T15:40:00Z',
  placardOdds: 2.2, probability: 0.5, minValueOdds: 2.02 };
const read = { apiSport: 'basketball_nba', observedAt: '2026-10-23T15:50:00Z',
  pinnacle: JSON.stringify([event]), games: [{
  teams: ['Team A', 'Team B'], apiSport: 'basketball_nba', commenceTime: event.commence_time,
  observedAt: '2026-10-23T15:50:00Z', markets: [{ type: 'H2HT', selections: [
    { price: 2.3, line: null }, { price: 1.6, line: null },
  ] }],
}] };

function fakeDb(reads = [read]) {
  return { collection(name) {
    if (name === '_placard_reads') return { orderBy() { return this; }, limit() { return this; },
      async get() { return { docs: reads.map(data => ({ data: () => data })) }; } };
    if (name === '_placard_revalidation_cache') return { doc() { return { async get() {
      return { data: () => ({ event, fetchedAt: '2026-10-23T15:59:40Z' }) };
    } }; } };
    throw Error(`Unexpected collection ${name}`);
  } };
}

test('aviso contém casa, jogo, mercado, seleção, odds e início', () => {
  const message = telegramMessage(row);
  for (const text of ['Placard', 'Team A x Team B', 'h2h', 'Team A', '2.20', '2.020', '23/10/2026']) {
    assert.match(message, new RegExp(text.replace('.', '\\.')));
  }
});

test('reconferência usa leitura Placard mais recente e cache Pinnacle abaixo de dois minutos', async () => {
  const output = await revalidate(fakeDb(), [row], [], () => { throw Error('consulta indevida'); }, now);
  assert.equal(output[0].status, 'ainda vale');
  assert.equal(output[0].placardOdds, 2.3);
  assert.equal(output[0].observedAt, '2026-10-23T15:50:00Z');
});

test('odd abaixo da mínima expira; casa local só mostra última leitura', async () => {
  const weaker = structuredClone(read);
  weaker.games[0].markets[0].selections[0].price = 2.0;
  const local = { ...row, id: 'local', bookmaker: 'Bwin', lastObservedAt: '2026-10-23T15:51:00Z' };
  const output = await revalidate(fakeDb([weaker]), [row, local], [], () => { throw Error('consulta indevida'); }, now);
  assert.equal(output[0].status, 'expirou');
  assert.equal(output[1].status, 'não reconferível agora');
  assert.equal(output[1].observedAt, local.lastObservedAt);
});

test('não reutiliza jogo de leitura anterior quando a leitura mais recente não o contém', async () => {
  const latest = { ...read, games: [] };
  const output = await revalidate(fakeDb([latest, read]), [row], [],
    () => { throw Error('consulta indevida'); }, now);
  assert.equal(output[0].status, 'expirou');
  assert.equal(output[0].placardOdds, null);
});

test('cache vencido consulta The Odds API e reconcilia o saldo', async () => {
  const originalReserve = budget.reserve, originalReconcile = budget.reconcile;
  const stored = [];
  budget.reserve = async () => ({ keyIndex: 0, cost: 1 });
  budget.reconcile = async (_reservation, headers) => {
    assert.equal(headers['x-requests-remaining'], '299');
  };
  const db = { collection(name) { return { doc() { return {
    async get() { return { data: () => name === '_placard_revalidation_cache'
      ? { event, fetchedAt: '2026-10-23T15:50:00Z' } : {} }; },
    async set(value) { stored.push(value); },
  }; } }; } };
  try {
    const result = await fetchPinnacleEvent(db, 'basketball_nba', 'event-1', new Set(['h2h']),
      ['dummy-key'], async url => {
        assert.match(url, /apiKey=dummy-key/);
        return { ok: true, headers: { get: name => ({ 'x-requests-remaining': '299',
          'x-requests-used': '201', 'x-requests-last': '1' })[name] }, json: async () => ({ ...event }) };
      }, now);
    assert.equal(result.id, 'event-1');
    assert.equal(stored.length, 1);
  } finally {
    budget.reserve = originalReserve;
    budget.reconcile = originalReconcile;
  }
});
