const { onRequest } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
const crypto = require('node:crypto');
const { COLLECTION, runProbe } = require('./probe');
admin.initializeApp();

exports.temporaryArcadiaProbe = onRequest({
  region: 'southamerica-east1', timeoutSeconds: 2100, memory: '256MiB',
  maxInstances: 1, concurrency: 1, invoker: 'public',
}, async (req, res) => {
  if (req.method !== 'POST') return res.status(405).send('POST required');
  const { runId, token, apiKey } = req.body || {};
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(runId || '') || !token || !apiKey) return res.status(400).send('Invalid request');
  const db = admin.firestore();
  const control = (await db.collection(COLLECTION).doc(`${runId}_control`).get()).data();
  const hash = crypto.createHash('sha256').update(String(token)).digest('hex');
  if (!control || hash !== control.tokenHash || Date.now() > Date.parse(control.expiresAt)) return res.status(403).send('Forbidden');
  try {
    await runProbe(db, 'firebase', runId, apiKey);
    return res.status(200).json({ status: 'completed', runId });
  } catch (error) {
    return res.status(error.code === 6 ? 409 : 500).send(error.code === 6 ? 'Already started' : 'Probe failed');
  }
});
