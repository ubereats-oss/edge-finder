const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const budget = require('./odds_api_monthly_budget');
const now = Date.parse('2026-11-15T16:00:00Z');
const entry = extra => ({ esporte: 'americanfootball/nfl', eventId: 'real-event',
  commenceTime: '2026-11-15T18:00:00Z', market: 'receptions',
  hasModelProb: true, validForCalibration: true, resolutionStatus: 'pendente',
  closingOddsStatus: 'pendente', published: true, ...extra });

test('NFL reserva compartilha mercados e protege duas tentativas', () => {
  const r = budget.nflClosingReserve([entry({}), entry({}), entry({ market: 'rushYards' }),
    entry({ eventId: 'second' })], now);
  assert.deepEqual([r.openCount, r.eventCount, r.marketCount, r.amount], [4, 2, 3, 6]);
});
test('NFL reserva acompanha exatamente as avaliações elegíveis à captura', () => {
  const rows = [entry({ published: false }), entry({ esporte: 'basketball/nba' }),
    entry({ hasModelProb: false }), entry({ validForCalibration: false }),
    entry({ closingOddsStatus: 'capturada' }), entry({ closingOddsStatus: 'expirada' }),
    entry({ resolutionStatus: 'resolvido' }), entry({ market: 'unknown' }),
    entry({ commenceTime: '2026-11-15T15:49:59Z' })];
  assert.equal(budget.nflClosingReserve(rows, now).amount, 2);
});
test('NFL reserva aceita o limite posterior de dez minutos e elimina o vencido', () => {
  assert.equal(budget.nflClosingReserve([entry({ commenceTime: '2026-11-15T15:50:00Z' })], now).amount, 2);
  assert.equal(budget.nflClosingReserve([], now).amount, 0);
});
test('componente Placard preservado, soma NFL e não restaura teto mensal', () => {
  const base = { mode: 'variable', openCount: 2, maxClosingCost: 3 };
  assert.equal(budget.closingReserve(base).amount, 18);
  const r = budget.closingReserve({ ...base, nflReserve: { amount: 10 } });
  assert.equal(r.amount, 28);
  const state = { syncComplete: true, dynamicReserve: r, keyBalances: { a: { remaining: 99 } } };
  assert.equal(budget.summarize(state).readingAvailable, 71);
});
test('falha do espelho NFL usa fallback e não considera a reserva zero', async () => {
  const opportunities = { docs: [] }, costs = { docs: [{ data: () => ({ budget: { lastClosingCredits: 1 } }) }] };
  let n = 0;
  const reader = { get: async () => [opportunities, costs, { exists: false, data: () => undefined }][n++] };
  const query = { select() { return this; }, doc() { return this; }, collection() { return this; },
    where() { return this; }, orderBy() { return this; }, limit() { return this; } };
  const r = await budget.readReserveEvidence(query, reader);
  assert.equal(r.mode, 'fallback');
  assert.equal(r.amount, 1000);
});
test('workflows só executam NFL, sem bets, com agendamentos originais', () => {
  const read = name => fs.readFileSync(path.join(__dirname, '../.github/workflows', name), 'utf8');
  const generate = read('update_all.yml');
  for (const sport of ['nba', 'mlb', 'nhl', 'tennis'])
    assert.match(generate, new RegExp(`  ${sport}:\\r?\\n    if: false`));
  assert.match(generate, /  nfl:\r?\n    if: true/);
  assert.ok(!generate.includes('node pipeline/firebase_sync.js bets'));
  assert.match(generate, /cron: '9 18 \* \* \*'/);
  const capture = read('capture_closing_odds.yml'), settle = read('settle_model_ledger.yml');
  assert.match(capture, /node pipeline\/capture_closing_odds.js nfl/);
  assert.match(capture, /cron: '23 5 \* \* \*'/);
  assert.match(settle, /node pipeline\/settle_model_ledger.js nfl/);
  assert.match(settle, /node pipeline\/reprocess_ledger_history.js nfl/);
  assert.match(settle, /cron: '20 10 \* \* \*'/);
  for (const s of [generate, capture, settle]) assert.match(s, /group: nfl-observation-ledger/);
});
test('espelhos de orçamento idênticos', () => {
  const read = f => fs.readFileSync(path.join(__dirname, f), 'utf8').replace(/\r\n/g, '\n');
  assert.equal(read('odds_api_monthly_budget.js'), read('../functions/odds_api_monthly_budget.js'));
});
