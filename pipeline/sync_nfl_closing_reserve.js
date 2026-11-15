// Apenas projeção de reserva do ledger existente; não gera indicação/aposta.
const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');
const { nflClosingReserve } = require('./odds_api_monthly_budget');

async function main() {
  const dir = path.resolve('odds_history');
  const entries = fs.readdirSync(dir).filter(f => /^model_ledger_nfl_.*\.json$/.test(f))
    .flatMap(f => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')))
    .filter(e => e.esporte === 'americanfootball/nfl' && e.resolutionStatus === 'pendente'
      && e.hasModelProb !== false && e.validForCalibration !== false
      && !e.closingOdds && (!e.closingOddsStatus || e.closingOddsStatus === 'pendente'))
    .map(e => ({ esporte: e.esporte, eventId: e.eventId ?? e.game,
      commenceTime: e.commenceTime, market: e.market, resolutionStatus: e.resolutionStatus,
      hasModelProb: e.hasModelProb ?? true, validForCalibration: e.validForCalibration ?? true,
      closingOddsStatus: 'pendente', published: e.published === true }));
  if (!admin.apps.length) admin.initializeApp({
    credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)),
  });
  const evidence = nflClosingReserve(entries);
  await admin.firestore().collection('system').doc('nflClosingReserve').set({
    schemaVersion: 1, source: 'model_ledger_nfl', entries, evidence,
    observedAt: new Date().toISOString(), runId: process.env.GITHUB_RUN_ID || 'bootstrap',
  });
  console.log(`[NFL observação] reserva sincronizada: ${evidence.openCount} seleções, ` +
    `${evidence.eventCount} jogos, ${evidence.marketCount} mercados, ${evidence.amount} créditos.`);
  await admin.app().delete();
}
main().catch(e => { console.error(e.message); process.exit(1); });
