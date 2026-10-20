// Reserva antes da chamada, em transação. Falha de rede mantém a reserva:
// o fornecedor pode ter cobrado mesmo sem termos recebido a resposta.
const LIMIT = 4000;
const readingAllowance = baseline => Math.floor(Math.max(0, LIMIT - baseline) * 1736 / LIMIT);
function database() {
  const admin = require('firebase-admin');
  if (!admin.apps.length) {
    if (!process.env.FIREBASE_SERVICE_ACCOUNT) throw new Error('Controle mensal sem credencial Firebase; chamada bloqueada.');
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
async function initializeMonth(db, ref, month, keys) {
  if ((await ref.get()).data()?.initialized) return;
  if (!keys?.length) throw new Error('Sem chaves para conferir o consumo mensal anterior.');
  const axios = require('axios');
  let baseline = 0;
  for (const key of new Set(keys)) {
    // Catálogo de esportes custa zero; os headers informam gasto já ocorrido.
    // Nunca presume que a ativação ocorreu no primeiro dia do mês.
    const response = await axios.get('https://api.the-odds-api.com/v4/sports', {
      params: { apiKey: key }, timeout: 15000,
    });
    const raw = response.headers['x-requests-used'];
    const used = Number(raw);
    if (raw === undefined || !Number.isFinite(used) || used < 0) throw new Error('Fornecedor não informou gasto mensal anterior; chamada paga bloqueada.');
    baseline += used;
  }
  if (month !== new Date().toISOString().slice(0, 7)) throw new Error('Virada de mês durante conferência de cota; repetir execução.');
  await db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    if (snap.data()?.initialized) return;
    tx.set(ref, { month, limit: LIMIT, initialized: true, baselineCredits: baseline,
      reserved: baseline, nonClosing: 0, nonClosingLimit: readingAllowance(baseline), scans: 0, startedAt: new Date().toISOString() });
  });
}
async function reserve(url, params, label, keys) {
  if (process.env.GITHUB_ACTIONS !== 'true' && process.env.ODDS_API_ENFORCE_MONTHLY_BUDGET !== '1') return null;
  const cost = estimateCost(url, params);
  if (!cost) return null;
  const db = database();
  const month = new Date().toISOString().slice(0, 7);
  const ref = db.collection('_odds_api_budget').doc(month);
  await initializeMonth(db, ref, month, keys);
  await db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    const state = snap.data() || {};
    const used = state.reserved ?? 0;
    // Preserva a reserva de fechamento: histórico e referência manual não
    // podem consumir a parcela destinada ao CLV automático. Na ativação
    // parcial do mês, divide somente o saldo ainda disponível.
    const closing = label === 'placard-closing';
    const scanning = label === 'placard-scan';
    const nonClosing = state.nonClosing ?? 0;
    if (used + cost > LIMIT || (!closing && nonClosing + cost > state.nonClosingLimit)) {
      throw new Error(`Teto mensal: ${used}/${LIMIT} créditos reservados; chamada de ${cost} bloqueada (${label}).`);
    }
    tx.set(ref, { month, limit: LIMIT, reserved: used + cost,
      nonClosing: nonClosing + (closing ? 0 : cost),
      scans: (state.scans ?? 0) + (scanning ? cost : 0),
      updatedAt: new Date().toISOString(), startedAt: state.startedAt || new Date().toISOString() }, { merge: true });
  });
  return { ref, cost };
}
async function reconcile(reservation, reportedCost) {
  if (!reservation) return;
  const actual = Number(reportedCost);
  if (!Number.isFinite(actual) || actual < 0 || actual > reservation.cost) {
    // Incompatibilidade de tarifação bloqueia as próximas chamadas.
    await reservation.ref.set({ reserved: LIMIT, tariffMismatch: true }, { merge: true });
    throw new Error('Custo da API ausente ou superior à reserva; orçamento bloqueado.');
  }
  // Não devolve créditos: contagem conservadora e segura contra concorrência.
}
module.exports = { reserve, reconcile, estimateCost, readingAllowance, database, LIMIT };
