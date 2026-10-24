const fs = require('node:fs');
const path = require('node:path');

function compactCycle(cycle) {
  return { startedAt: cycle.startedAt, finishedAt: cycle.finishedAt,
    status: cycle.status, reason: cycle.pauseReason || cycle.error || null,
    spentMB: Number(cycle.vpnAdapterMB ?? cycle.consumedMB ?? 0),
    estimated: Boolean(cycle.vpnEstimate),
    vpnBudgetMonth: cycle.budget?.month || '2026-10',
    vpnBudgetExhausted: Number(cycle.budget?.limitMB || 2700) - Number(cycle.accumulatedMB || 0) < 60,
    vpnMonthlySpentMB: Number(cycle.accumulatedMB ?? 0),
    vpnMonthlyRemainingMB: Math.max(0, Number(cycle.budget?.limitMB || 0) - Number(cycle.accumulatedMB || 0)),
    gamesByHouse: Object.fromEntries(Object.entries(cycle.reads || {})
      .map(([house, read]) => [house, Number(read.games || 0)])),
    errors: [cycle.error, cycle.disconnectError, cycle.usageError]
      .filter(Boolean).map(String).slice(0, 5) };
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
          spentMB: row.vpnMonthlySpentMB, remainingMB: row.vpnMonthlyRemainingMB,
          observedAt: row.finishedAt || row.startedAt,
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
