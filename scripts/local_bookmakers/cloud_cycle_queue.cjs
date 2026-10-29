const fs = require('./safe_files.cjs');
const { operatorIssue } = require('../../functions/local_operator_alerts.js');
const path = require('node:path');
const { classifyCycle, sanitizeReason } = require('../../functions/local_cycle_health.js');

function compactCycle(cycle) {
  return { startedAt: cycle.startedAt, finishedAt: cycle.finishedAt,
    runtimeSha: cycle.runtimeSha || null, tunnelBearVersion: cycle.tunnelBearVersion || null,
    tunnelBear: cycle.tunnelBear || null,
    healthCause: classifyCycle(cycle),
    vpnFailures: (cycle.vpnFailures || []).map(row => ({ stage: row.stage, category: row.category,
      originalError: sanitizeReason(row.originalError), originalErrorUnavailable: !row.originalError })),
    status: cycle.status, reason: sanitizeReason(cycle.pauseReason || cycle.error),
    spentMB: Number(cycle.vpnAdapterMB ?? cycle.consumedMB ?? 0),
    estimated: Boolean(cycle.vpnEstimate),
    vpnBudgetMonth: cycle.dailyVpn?.month || cycle.budget?.month || cycle.startedAt?.slice(0, 7),
    vpnProviderExhausted: /TUNNELBEAR_DATA_EXHAUSTED/.test(cycle.error || ''),
    vpnOperatorIssue: operatorIssue(cycle.error),
    vpnMonthlySpentMB: Number(cycle.accumulatedMB ?? 0),
    suspendedHouses: cycle.suspendedHouses || [],
    gamesByHouse: Object.fromEntries(Object.entries(cycle.reads || {})
      .map(([house, read]) => [house, Number(read.games || 0)])),
    errors: [cycle.error, cycle.disconnectError, cycle.usageError]
      .filter(Boolean).map(value => sanitizeReason(value)) };
}
async function flushCycleQueue(db, cycle, logDir) {
  const queueFile = path.join(logDir, 'cloud-cycle-pending.json');
  const pending = fs.existsSync(queueFile) ? JSON.parse(fs.readFileSync(queueFile, 'utf8')) : [];
  if (cycle) pending.push(compactCycle(cycle));
  fs.writeFileSync(queueFile, JSON.stringify(pending, null, 2));
  let sent = 0;
  while (pending.length) {
    const row = pending[0];
    let timer;
    try {
      await Promise.race([(async () => {
        await db.collection('_local_cycle_health').doc(row.startedAt.replace(/[^0-9]/g, '')).set(row);
        await db.collection('_odds_api_budget').doc(row.vpnBudgetMonth || '2026-10').set({ vpn: {
          spentMB: row.vpnMonthlySpentMB,
          observedAt: row.finishedAt || row.startedAt,
          providerExhausted: Boolean(row.vpnProviderExhausted),
          operatorIssue: row.vpnOperatorIssue || null,
          tunnelBear: row.tunnelBear || null,
        } }, { merge: true });
      })(),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('envio à nuvem excedeu 5 s')), 5000); })]);
    } catch (error) {
      row.syncError = error.message;
      fs.writeFileSync(queueFile, JSON.stringify(pending, null, 2));
      return { sent, pending: pending.length, error: error.message };
    } finally { clearTimeout(timer); }
    pending.shift();
    sent++;
    fs.writeFileSync(queueFile, JSON.stringify(pending, null, 2));
  }
  return { sent, pending: 0 };
}
module.exports = { compactCycle, flushCycleQueue };
