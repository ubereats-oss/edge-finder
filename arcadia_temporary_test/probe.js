const https = require('node:https');
const crypto = require('node:crypto');
const COLLECTION = '_arcadia_temporary_test';
const INTERVAL_MS = 120000;
const DURATION_MS = 1800000;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function query(path, apiKey) {
  const started = Date.now();
  return new Promise(resolve => {
    const req = https.get(`https://guest.api.arcadia.pinnacle.com/0.1${path}`, {
      headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json', 'x-api-key': apiKey },
    }, res => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        let rows;
        let parseError = null;
        try { rows = JSON.parse(body); } catch (error) { parseError = error.message; }
        const list = Array.isArray(rows) ? rows : [];
        const games = list.filter(row => row.type === 'matchup' && !row.parentId && row.participants?.length === 2);
        const markets = path.endsWith('/straight');
        resolve({ httpStatus: res.statusCode, responseMs: Date.now() - started,
          cacheAgeSeconds: res.headers.age === undefined ? null : Number(res.headers.age),
          serverDate: res.headers.date || null, returnedCount: list.length,
          gamesReturned: markets ? new Set(list.map(row => row.matchupId).filter(Boolean)).size : games.length,
          responseHash: crypto.createHash('sha256').update(body).digest('hex'),
          priceSample: markets ? list.filter(row => row.period === 0).slice(0, 5).map(row => ({
            matchupId: row.matchupId, type: row.type, version: row.version ?? null, prices: row.prices || [],
          })) : [], error: parseError });
      });
      res.on('error', error => resolve({ httpStatus: res.statusCode, responseMs: Date.now() - started,
        cacheAgeSeconds: null, gamesReturned: 0, returnedCount: 0, error: error.message }));
    });
    req.setTimeout(20000, () => req.destroy(new Error('Arcadia timeout 20s')));
    req.on('error', error => resolve({ httpStatus: null, responseMs: Date.now() - started,
      cacheAgeSeconds: null, gamesReturned: 0, returnedCount: 0, error: error.message }));
  });
}

async function runProbe(db, origin, runId, apiKey) {
  const started = Date.now();
  const run = db.collection(COLLECTION).doc(`${runId}_${origin}`);
  await run.create({ kind: 'execution', origin, runId, status: 'running',
    startedAt: new Date(started).toISOString(), intervalSeconds: 120, durationSeconds: 1800 });
  const endpoints = [
    ['football', 'games', '/sports/29/matchups'],
    ['football', 'markets', '/sports/29/markets/straight'],
    ['nba', 'games', '/leagues/487/matchups'],
    ['nba', 'markets', '/leagues/487/markets/straight'],
  ];
  try {
    for (let round = 0; round < DURATION_MS / INTERVAL_MS; round++) {
      await sleep(Math.max(0, started + round * INTERVAL_MS - Date.now()));
      await Promise.all(endpoints.map(async ([sport, kind, path]) => {
        const queriedAt = new Date().toISOString();
        const result = await query(path, apiKey);
        await db.collection(COLLECTION).doc(`${runId}_${origin}_${round}_${sport}_${kind}`).create({
          kind: 'query', origin, runId, round, sport, endpointKind: kind, path, queriedAt,
          completedAt: new Date().toISOString(), ...result,
        });
      }));
      await run.update({ completedRounds: round + 1, lastRoundAt: new Date().toISOString() });
    }
    await sleep(Math.max(0, started + DURATION_MS - Date.now()));
    await run.update({ status: 'completed', endedAt: new Date().toISOString() });
  } catch (error) {
    await run.update({ status: 'failed', endedAt: new Date().toISOString(), error: error.message });
    throw error;
  }
}

module.exports = { COLLECTION, runProbe };

if (require.main === module) {
  const admin = require('firebase-admin');
  admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
  runProbe(admin.firestore(), 'github_actions', process.env.ARCADIA_TEST_RUN_ID, process.env.ARCADIA_TEST_API_KEY)
    .catch(error => { console.error(error.message); process.exitCode = 1; });
}
