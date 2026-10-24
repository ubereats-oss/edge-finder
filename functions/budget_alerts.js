const HOUR_MS = 3600000;
const { actions } = require('./local_operator_alerts');

function budgetAlerts(month, state = {}) {
  const alerts = [];
  if (state.vpn?.operatorIssue && state.vpn.operatorIssue !== 'data' && actions[state.vpn.operatorIssue])
    alerts.push({ id: `vpn-action-${month}-${state.vpn.operatorIssue}`, text: `Edge Finder: coleta local bloqueada. Alex: ${actions[state.vpn.operatorIssue]}` });
  if (state.vpn?.providerExhausted)
    alerts.push({ id: `vpn-provider-${month}`, text: `Edge Finder: TunnelBear informou que a franquia de dados acabou. ${actions.data}` });
  if (state.syncComplete && Number.isFinite(state.totalRemaining) && state.totalRemaining <= 1000)
    alerts.push({ id: `credits-${month}`, text: `Edge Finder: créditos da The Odds API chegaram à reserva de 1.000 (800 para fechamentos + 200 de margem). Saldo: ${state.totalRemaining}. Somente fechamentos.` });
  if (state.vpn?.remainingMB < 60)
    alerts.push({ id: `vpn-${month}`, text: `Edge Finder: orçamento VPN de ${month} esgotado para novos ciclos. Usados ${Number(state.vpn.spentMB).toFixed(3)} MB de 2.700; restantes ${Number(state.vpn.remainingMB).toFixed(3)} MB, abaixo do mínimo de 60 MB. Coleta local parada.` });
  return alerts;
}

async function deliverOnce(db, alert, send, enqueue, now = Date.now()) {
  const ref = db.collection('_edge_budget_alerts').doc(alert.id);
  const claimed = await db.runTransaction(async tx => {
    const state = (await tx.get(ref)).data() || {};
    if (state.status === 'sent' || state.nextAttemptAt > now || state.leaseUntil > now) return false;
    tx.set(ref, { ...alert, status: 'sending', leaseUntil: now + 10 * 60000 }, { merge: true });
    return true;
  });
  if (!claimed) return false;
  try {
    const messageId = await send(alert.text);
    await ref.set({ status: 'sent', messageId, sentAt: new Date(now).toISOString(), leaseUntil: 0 }, { merge: true });
    return true;
  } catch (error) {
    await ref.set({ status: 'send_failed', error: error.message, failedAt: new Date(now).toISOString(),
      nextAttemptAt: now + HOUR_MS, leaseUntil: 0 }, { merge: true });
    await enqueue({ alertId: alert.id });
    return false;
  }
}
module.exports = { budgetAlerts, deliverOnce };
