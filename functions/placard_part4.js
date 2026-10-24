const budget = require('./odds_api_monthly_budget');
const { references, placardSelections, matchingEvents } = require('./placard_value');
const { isAnnulled } = require('./market_integrity');

const TWO_MINUTES = 120000;
const NEW_LOCAL_READERS_STARTED_AT = Date.parse('2026-10-23T22:08:00Z');
const NEW_LOCAL_READERS_WARNING_MS = 24 * 60 * 60 * 1000;

function telegramMessage(row, now = Date.now()) {
  const start = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo',
    dateStyle: 'short', timeStyle: 'short' }).format(new Date(row.commenceTime));
  const minimum = Number(row.minValueOdds || (1.01 / row.probability));
  return `${row.test ? 'Teste de indicação' : 'Nova indicação'} Edge Finder\nCasa: ${row.bookmaker || 'Placard'}\nJogo: ${row.game}\n`
    + `Mercado: ${row.market}${row.line === null || row.line === undefined ? '' : ` (${row.line})`}\n`
    + `Seleção: ${row.selection}\nOdd da casa: ${Number(row.sourceOdds || row.placardOdds).toFixed(2)}\n`
    + `Odd mínima com valor: ${minimum.toFixed(3)}\nInício: ${start}`
    + (['betano', 'bwin', 'betclic'].includes(String(row.bookmaker || '').toLowerCase())
      && now >= NEW_LOCAL_READERS_STARTED_AT
      && now < NEW_LOCAL_READERS_STARTED_AT + NEW_LOCAL_READERS_WARNING_MS
      ? '\nleitura nova — conferir a odd no site antes de apostar' : '');
}

async function sendTelegramText(text, token, chatId, fetchImpl = fetch) {
  if (!token || !chatId) throw new Error('Segredos Telegram indisponíveis');
  const response = await fetchImpl(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text }),
    signal: AbortSignal.timeout(15000),
  });
  const body = await response.json();
  if (!response.ok || !body.ok) throw new Error(`Telegram HTTP ${response.status}`);
  return body.result?.message_id || null;
}

async function sendTelegram(row, token, chatId, fetchImpl = fetch) {
  return sendTelegramText(telegramMessage(row), token, chatId, fetchImpl);
}

function keysFromSecret(secret) {
  return String(secret || '').split(/[\r\n,]+/).map(key => key.trim()).filter(Boolean);
}

async function fetchPinnacleEvent(db, sport, eventId, markets, keys, fetchImpl = fetch, now = Date.now()) {
  const ref = db.collection('_placard_revalidation_cache').doc(`${sport}_${eventId}`);
  const cached = (await ref.get()).data();
  if (cached?.event && now - Date.parse(cached.fetchedAt) >= 0
      && now - Date.parse(cached.fetchedAt) < TWO_MINUTES) return cached.event;

  const scanState = (await db.collection('_placard_refresh_state').doc(`${sport}_${eventId}`).get()).data();
  if (scanState?.lastPinnacleFetchAt && now - Date.parse(scanState.lastPinnacleFetchAt) >= 0
      && now - Date.parse(scanState.lastPinnacleFetchAt) < TWO_MINUTES) {
    const scanCache = (await db.collection('_placard_pinnacle_latest').doc(sport).get()).data();
    const event = scanCache?.events?.find(row => row.id === eventId);
    if (event) return event;
  }

  const url = `https://api.the-odds-api.com/v4/sports/${encodeURIComponent(sport)}/events/${encodeURIComponent(eventId)}/odds`;
  const params = { bookmakers: 'pinnacle', markets: [...markets].join(','), oddsFormat: 'decimal' };
  const reservation = await budget.reserve(url, params, 'placard-revalidate', keys);
  const query = new URLSearchParams({ ...params, apiKey: keys[reservation.keyIndex] });
  const response = await fetchImpl(`${url}?${query}`, { signal: AbortSignal.timeout(20000) });
  if (response.status === 429) await budget.releaseQuotaRejected(reservation);
  if (!response.ok) throw new Error(`The Odds API HTTP ${response.status}`);
  const headers = Object.fromEntries(['x-requests-remaining', 'x-requests-used', 'x-requests-last']
    .map(name => [name, response.headers.get(name)]));
  await budget.reconcile(reservation, headers);
  const event = await response.json();
  event.sport_key = sport;
  await ref.set({ event, fetchedAt: new Date(now).toISOString() });
  return event;
}

function latestPlacardQuote(row, reads, event) {
  const read = reads.find(item => item.apiSport === row.apiSport);
  const game = event && (read?.games || []).find(item => matchingEvents(item, [event]).length === 1);
  const quote = game && placardSelections(game, event).find(selection => selection.market === row.market
    && selection.line === row.line && selection.selection === row.selection);
  if (quote) return { odds: quote.placardOdds, observedAt: game.observedAt || read.observedAt };
  return { odds: null, observedAt: row.lastObservedAt || row.placardObservedAt || null };
}

async function revalidate(db, rows, keys, fetchImpl = fetch, now = Date.now()) {
  const readSnap = await db.collection('_placard_reads').orderBy('observedAt', 'desc').limit(40).get();
  const reads = readSnap.docs.map(doc => doc.data());
  const eventPromises = new Map();
  const output = [];
  for (const row of rows) {
    if (isAnnulled(row)) {
      output.push({ id: row.id, bookmaker: row.bookmaker || 'Placard', status: 'anulada',
        reason: row.annulmentReason || 'possível jogo trocado' });
      continue;
    }
    if (row.bookmaker && row.bookmaker !== 'Placard') {
      output.push({ id: row.id, bookmaker: row.bookmaker, status: 'não reconferível agora',
        observedAt: row.lastObservedAt || row.placardObservedAt || null });
      continue;
    }
    const start = Date.parse(row.commenceTime || '');
    if (!Number.isFinite(start) || start <= now) {
      output.push({ id: row.id, bookmaker: 'Placard', status: 'expirou',
        observedAt: row.lastObservedAt || row.placardObservedAt || null, reason: 'jogo iniciado' });
      continue;
    }
    const latestRead = reads.find(item => item.apiSport === row.apiSport);
    let savedEvent;
    try { savedEvent = JSON.parse(latestRead?.pinnacle || '[]').find(item => item.id === row.eventId); }
    catch (_) { savedEvent = null; }
    const placard = latestPlacardQuote(row, reads, savedEvent);
    if (!Number.isFinite(placard.odds)) {
      output.push({ id: row.id, bookmaker: 'Placard', status: 'expirou',
        observedAt: placard.observedAt, placardOdds: null, reason: 'sem leitura atual do Placard' });
      continue;
    }
    const group = `${row.apiSport}_${row.eventId}`;
    if (!eventPromises.has(group)) {
      const groupRows = rows.filter(item => item.apiSport === row.apiSport && item.eventId === row.eventId);
      const markets = new Set(groupRows.map(item => item.market));
      eventPromises.set(group, fetchPinnacleEvent(db, row.apiSport, row.eventId, markets, keys, fetchImpl, now));
    }
    let event, error;
    try { event = await eventPromises.get(group); }
    catch (caught) { error = caught.message; }
    const reference = event && references(event, now).find(item => item.market === row.market
      && item.line === row.line && item.selection === row.selection);
    const minimum = reference ? 1.01 / reference.probability : null;
    const valid = Number.isFinite(placard.odds) && minimum !== null && placard.odds > minimum;
    output.push({ id: row.id, bookmaker: 'Placard', status: valid ? 'ainda vale' : 'expirou',
      observedAt: placard.observedAt, placardOdds: placard.odds, minValueOdds: minimum,
      pinnacleUpdatedAt: reference?.pinnacleUpdatedAt || null,
      ...(valid ? {} : { reason: error || (!placard.odds ? 'sem leitura atual do Placard'
        : !reference ? 'preço atual da Pinnacle indisponível' : 'odd abaixo da mínima') }),
    });
  }
  return output;
}

module.exports = { telegramMessage, sendTelegram, sendTelegramText, keysFromSecret,
  fetchPinnacleEvent, latestPlacardQuote, revalidate };
