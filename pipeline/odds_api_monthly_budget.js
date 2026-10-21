// Usa os saldos reais por chave retornados pela The Odds API. Mantém 800
// créditos somados indisponíveis para leituras; apenas chamadas de fechamento
// podem consumir essa reserva.
const crypto = require('crypto');
const axios = require('axios');

const CLOSING_RESERVE = 800;
const SCHEMA_VERSION = 2;
const PENDING_TTL_MS = 2 * 60 * 1000;
const API_ROOT = 'https://api.the-odds-api.com/v4';

function database() {
  const admin = require('firebase-admin');
  if (!admin.apps.length) {
    if (!process.env.FIREBASE_SERVICE_ACCOUNT) throw new Error('Controle de saldo sem credencial Firebase; chamada bloqueada.');
    admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
  }
  return admin.firestore();
}

function estimateCost(url, params = {}) {
  const pathname = new URL(url).pathname;
  if (/\/sports\/?$/.test(pathname) || /\/events\/?$/.test(pathname)) return 0;
  if (/\/scores\/?$/.test(pathname)) return params.daysFrom ? 2 : 1;
  if (!/\/odds\/?$/.test(pathname)) throw new Error('Endpoint sem custo conhecido; chamada bloqueada.');
  const markets = new Set(String(params.markets || 'h2h').split(',').filter(Boolean)).size;
  const regions = params.bookmakers
    ? Math.ceil(new Set(String(params.bookmakers).split(',').filter(Boolean)).size / 10)
    : new Set(String(params.regions || 'us').split(',').filter(Boolean)).size;
  return markets * regions * (pathname.includes('/historical/') ? 10 : 1);
}

function keyFingerprint(key) {
  return crypto.createHash('sha256').update(key).digest('hex');
}

function parseHeaders(headers = {}) {
  const remaining = Number(headers['x-requests-remaining']);
  const used = Number(headers['x-requests-used']);
  const last = Number(headers['x-requests-last']);
  if (!Number.isFinite(remaining) || remaining < 0) throw new Error('The Odds API não informou x-requests-remaining; saldo indisponível e chamada bloqueada.');
  return {
    remaining,
    used: Number.isFinite(used) && used >= 0 ? used : null,
    last: Number.isFinite(last) && last >= 0 ? last : null,
  };
}

function safeError(error) {
  if (error.response?.status) return `HTTP ${error.response.status}`;
  if (error.code) return `rede ${String(error.code).slice(0, 40)}`;
  return 'falha sem resposta válida';
}

function monthId(now = new Date()) {
  return now.toISOString().slice(0, 7);
}

function monthRef(db, month = monthId()) {
  return db.collection('_odds_api_budget').doc(month);
}

function pendingCostForKey(pendingRequests, fingerprint) {
  return Object.values(pendingRequests || {}).reduce((sum, row) =>
    sum + (row.keyFingerprint === fingerprint ? Number(row.cost || 0) : 0), 0);
}

function summarize(state = {}) {
  const active = state.keyFingerprints?.length
    ? state.keyFingerprints.map(fingerprint => state.keyBalances?.[fingerprint]).filter(Boolean)
    : Object.values(state.keyBalances || {});
  const balances = active;
  const totalRemaining = balances.reduce((sum, row) => sum + Number(row.remaining || 0), 0);
  const pendingCredits = Object.values(state.pendingRequests || {}).reduce((sum, row) => sum + Number(row.cost || 0), 0);
  const available = Math.max(0, totalRemaining - pendingCredits);
  return {
    totalRemaining,
    pendingCredits,
    available,
    closingReserve: CLOSING_RESERVE,
    readingAvailable: Math.max(0, available - CLOSING_RESERVE),
    lastSyncedAt: state.lastSyncedAt || null,
    keyCount: balances.length,
    syncComplete: state.syncComplete === true,
    dailyUsage: state.dailyUsage || {},
  };
}

function removeExpiredPending(pendingRequests, now) {
  return Object.fromEntries(Object.entries(pendingRequests || {}).filter(([, row]) => {
    const created = Date.parse(row.createdAt || '');
    return Number.isFinite(created) && now - created <= PENDING_TTL_MS;
  }));
}

function updateObservation(previous, observation, observedAt) {
  if (!previous || observation.used === null || previous.used === null || previous.used === undefined) {
    return { ...observation, observedAt };
  }
  // x-requests-used é cumulativo até a virada mensal. Ignora respostas antigas
  // que terminem depois de uma resposta mais recente da mesma chave.
  if (observation.used < previous.used) return previous;
  return { ...observation, observedAt };
}

function planReservation(state, keys, cost, label, excludedIndexes = new Set()) {
  const fingerprints = keys.map(keyFingerprint);
  if (state.schemaVersion !== SCHEMA_VERSION || state.syncComplete !== true
    || fingerprints.some(fingerprint => !state.keyBalances?.[fingerprint])) {
    throw new Error('Saldos reais das chaves ainda não foram reconciliados; chamada paga bloqueada.');
  }
  const pendingRequests = removeExpiredPending(state.pendingRequests, Date.now());
  const candidates = keys.map((key, index) => {
    const fingerprint = fingerprints[index];
    const remaining = Number(state.keyBalances[fingerprint].remaining || 0)
      - pendingCostForKey(pendingRequests, fingerprint);
    return { key, index, fingerprint, remaining };
  }).filter(row => row.remaining >= cost && !excludedIndexes.has(row.index))
    .sort((a, b) => b.remaining - a.remaining);
  const available = Math.max(0, summarize({ ...state, pendingRequests }).totalRemaining
    - Object.values(pendingRequests).reduce((sum, row) => sum + Number(row.cost || 0), 0));
  const closing = /closing/i.test(label);
  const requiredFloor = closing ? 0 : CLOSING_RESERVE;
  if (available - cost < requiredFloor || !candidates.length) {
    throw new Error(`Saldo real insuficiente: total=${available}, reserva_fechamentos=${CLOSING_RESERVE}, disponível_leituras=${Math.max(0, available - CLOSING_RESERVE)}, custo=${cost} (${label}).`);
  }
  return { ...candidates[0], availableAfter: available - cost };
}

async function refreshBalances(keys, { httpGet = axios.get, db = database(), now = Date.now() } = {}) {
  if (!keys?.length) throw new Error('Sem chaves The Odds API para reconciliar os saldos.');
  const observations = [];
  const failures = [];
  for (let index = 0; index < keys.length; index++) {
    try {
      const response = await httpGet(`${API_ROOT}/sports`, {
        timeout: 15000,
        params: { apiKey: keys[index] },
      });
      observations.push({ fingerprint: keyFingerprint(keys[index]), index,
        ...parseHeaders(response.headers), });
    } catch (error) {
      const headers = error.response?.headers;
      if (headers?.['x-requests-remaining'] !== undefined) {
        try {
          observations.push({ fingerprint: keyFingerprint(keys[index]), index, ...parseHeaders(headers) });
        } catch (headerError) {
          failures.push(`chave ${index + 1}: ${safeError(headerError)}`);
        }
      } else failures.push(`chave ${index + 1}: ${safeError(error)}`);
    }
  }

  const ref = monthRef(db, monthId(new Date(now)));
  const observedAt = new Date(now).toISOString();
  const fingerprints = keys.map(keyFingerprint);
  await db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    const prior = snap.data() || {};
    const sameMonth = prior.schemaVersion === SCHEMA_VERSION && prior.month === monthId(new Date(now));
    const keyBalances = sameMonth
      ? Object.fromEntries(fingerprints.filter(fingerprint => prior.keyBalances?.[fingerprint])
        .map(fingerprint => [fingerprint, prior.keyBalances[fingerprint]]))
      : {};
    for (const observation of observations) {
      const priorBalance = keyBalances[observation.fingerprint];
      keyBalances[observation.fingerprint] = {
        ...updateObservation(priorBalance, observation, observedAt),
        index: observation.index,
      };
    }
    const pendingRequests = sameMonth
      ? Object.fromEntries(Object.entries(removeExpiredPending(prior.pendingRequests, now))
        .filter(([, row]) => fingerprints.includes(row.keyFingerprint)))
      : {};
    const doc = {
      schemaVersion: SCHEMA_VERSION,
      month: monthId(new Date(now)),
      closingReserve: CLOSING_RESERVE,
      keyFingerprints: fingerprints,
      keyBalances,
      pendingRequests,
      dailyUsage: sameMonth ? (prior.dailyUsage || {}) : {},
      lastSyncedAt: observedAt,
      syncComplete: failures.length === 0 && observations.length === fingerprints.length,
      syncFailureCount: failures.length,
      updatedAt: observedAt,
    };
    const totals = summarize(doc);
    doc.totalRemaining = totals.totalRemaining;
    doc.available = totals.available;
    doc.readingAvailable = totals.readingAvailable;
    tx.set(ref, doc);
  });

  if (failures.length) throw new Error(`Saldo real incompleto (${observations.length}/${keys.length} chaves): ${failures.join(' | ')}`);
  return summarize((await ref.get()).data() || {});
}

async function reserve(url, params, label, keys, excludedIndexes = new Set()) {
  const cost = estimateCost(url, params);
  if (!cost) return null;
  const db = database();
  const ref = monthRef(db);
  const reservationId = crypto.randomUUID();
  let selected;

  await db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    const state = snap.data() || {};
    const pendingRequests = removeExpiredPending(state.pendingRequests, Date.now());
    selected = planReservation({ ...state, pendingRequests }, keys, cost, label, excludedIndexes);
    pendingRequests[reservationId] = { keyFingerprint: selected.fingerprint, cost, label, createdAt: new Date().toISOString() };
    tx.set(ref, { pendingRequests, updatedAt: new Date().toISOString() }, { merge: true });
  });

  return { ref, cost, id: reservationId, keyIndex: selected.index,
    keyFingerprint: selected.fingerprint, label };
}

async function reconcile(reservation, headers) {
  if (!reservation) return null;
  const observation = parseHeaders(headers);
  const observedAt = new Date().toISOString();
  let result;
  await database().runTransaction(async tx => {
    const snap = await tx.get(reservation.ref);
    const state = snap.data() || {};
    const keyBalances = { ...(state.keyBalances || {}) };
    const previous = keyBalances[reservation.keyFingerprint] || {};
    keyBalances[reservation.keyFingerprint] = {
      ...updateObservation(previous, observation, observedAt), index: reservation.keyIndex,
    };
    const pendingRequests = { ...(state.pendingRequests || {}) };
    delete pendingRequests[reservation.id];
    const dailyUsage = { ...(state.dailyUsage || {}) };
    const day = observedAt.slice(0, 10);
    const entry = { ...(dailyUsage[day] || { total: 0, closing: 0, placardScan: 0, otherRead: 0, requests: 0 }) };
    const usedDelta = observation.used !== null && previous.used !== null && previous.used !== undefined
      ? Math.max(0, observation.used - previous.used) : null;
    const remainingDelta = Number.isFinite(previous.remaining)
      ? Math.max(0, previous.remaining - observation.remaining) : null;
    const actualCost = observation.last ?? usedDelta ?? remainingDelta ?? reservation.cost;
    entry.total += actualCost;
    entry.closing += /closing/i.test(reservation.label) ? actualCost : 0;
    entry.placardScan += reservation.label === 'placard-scan' ? actualCost : 0;
    entry.otherRead += /closing/i.test(reservation.label) || reservation.label === 'placard-scan' ? 0 : actualCost;
    entry.requests += 1;
    dailyUsage[day] = entry;
    const doc = { ...state, keyBalances, pendingRequests, dailyUsage, updatedAt: observedAt };
    result = summarize(doc);
    tx.set(reservation.ref, { keyBalances, pendingRequests, dailyUsage,
      totalRemaining: result.totalRemaining, available: result.available,
      readingAvailable: result.readingAvailable, lastResponseAt: observedAt,
      lastResponseKeyIndex: reservation.keyIndex, lastResponseRemaining: observation.remaining,
      lastResponseUsed: observation.used, lastResponseCost: actualCost,
      updatedAt: observedAt }, { merge: true });
  });
  return { ...result, actualCost: observation.last ?? reservation.cost };
}

async function recordUnreservedResponse(key, index, headers) {
  const observation = parseHeaders(headers);
  const ref = monthRef(database());
  const fingerprint = keyFingerprint(key);
  const observedAt = new Date().toISOString();
  let result;
  await database().runTransaction(async tx => {
    const snap = await tx.get(ref);
    const state = snap.data() || {};
    if (state.schemaVersion !== SCHEMA_VERSION || !state.keyBalances?.[fingerprint]) return;
    const keyBalances = { ...state.keyBalances,
      [fingerprint]: { ...updateObservation(state.keyBalances[fingerprint], observation, observedAt), index } };
    const doc = { ...state, keyBalances };
    result = summarize(doc);
    tx.set(ref, { keyBalances, totalRemaining: result.totalRemaining, available: result.available,
      readingAvailable: result.readingAvailable, lastResponseAt: observedAt,
      lastResponseKeyIndex: index, lastResponseRemaining: observation.remaining,
      lastResponseUsed: observation.used, lastResponseCost: observation.last ?? 0,
      updatedAt: observedAt }, { merge: true });
  });
  return result;
}

async function releaseQuotaRejected(reservation) {
  if (!reservation) return;
  await database().runTransaction(async tx => {
    const snap = await tx.get(reservation.ref);
    const state = snap.data() || {};
    const keyBalances = { ...(state.keyBalances || {}) };
    const prior = keyBalances[reservation.keyFingerprint] || {};
    keyBalances[reservation.keyFingerprint] = { ...prior, remaining: 0, observedAt: new Date().toISOString() };
    const pendingRequests = { ...(state.pendingRequests || {}) };
    delete pendingRequests[reservation.id];
    const result = summarize({ ...state, keyBalances, pendingRequests });
    tx.set(reservation.ref, { keyBalances, pendingRequests, totalRemaining: result.totalRemaining,
      available: result.available, readingAvailable: result.readingAvailable, updatedAt: new Date().toISOString() }, { merge: true });
  });
}

module.exports = {
  reserve, reconcile, refreshBalances, releaseQuotaRejected, estimateCost,
  recordUnreservedResponse, summarize, planReservation, keyFingerprint, parseHeaders,
  database, CLOSING_RESERVE, SCHEMA_VERSION,
};
