const { summarize, monthlyUsed, brasilDay } = require('./odds_api_monthly_budget');

const DAY_MS = 24 * 3600000;
const reportDay = (now = new Date()) => brasilDay(now);
function scheduledSlots(now) {
  const start = now - DAY_MS;
  const first = Math.ceil((start - 50 * 60000) / 3600000) * 3600000 + 50 * 60000;
  const slots = [];
  for (let at = first; at < now; at += 3600000) slots.push(at);
  return slots;
}
function composeHealth({ cycles = [], runs = [], opportunities = [], budget = {}, priorErrors = [] }, now = Date.now()) {
  const start = now - DAY_MS;
  const recent = cycles.filter(row => Date.parse(row.startedAt) >= start && Date.parse(row.startedAt) < now);
  const complete = recent.filter(row => row.status === 'complete');
  const skipped = recent.filter(row => row.status === 'ciclo pulado');
  const failed = recent.filter(row => !['complete', 'ciclo pulado'].includes(row.status));
  const missing = scheduledSlots(now).filter(slot => !recent.some(row =>
    Math.abs(Date.parse(row.startedAt) - slot) <= 15 * 60000));
  const houses = [...new Set(recent.flatMap(row => Object.entries(row.gamesByHouse || {})
    .filter(([, games]) => games > 0).map(([house]) => house)))].sort();
  const workflowRuns = runs.filter(row => Date.parse(row.created_at) >= start && Date.parse(row.created_at) < now);
  const success = workflowRuns.filter(row => row.conclusion === 'success').length;
  const workflowFailures = workflowRuns.filter(row => row.status === 'completed' && row.conclusion !== 'success');
  const sent = opportunities.filter(row => Date.parse(row.telegramSentAt) >= start
    && Date.parse(row.telegramSentAt) < now).length;
  const latest = recent.slice().sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))[0];
  const usedCredits = monthlyUsed(budget);
  const remainingCredits = summarize(budget).totalRemaining;
  const errors = [...priorErrors, ...recent.flatMap(row => [...(row.errors || []), row.syncError].filter(Boolean)),
    ...workflowFailures.map(row => `Placard x Pinnacle ${row.id}: ${row.conclusion}`)];
  const number = value => Number.isFinite(value) ? value.toFixed(2).replace('.', ',') : 'não sei';
  const lines = [`Saúde Edge Finder — ${brasilDay(new Date(now))}, últimas 24 horas`];
  if (!recent.length) lines.push('⚠️ computador desligado ou coleta parada — nenhum registro de ciclo local chegou.');
  lines.push(`Ciclos locais: ${complete.length} rodados; ${skipped.length} pulados; ${failed.length} com falha; ${missing.length} ausentes.`);
  if (skipped.length) lines.push(`Pulados: ${skipped.map(row => row.reason || 'motivo não registrado').join(' | ')}.`);
  lines.push(`Casas com jogos: ${houses.join(', ') || 'nenhuma'}.`);
  lines.push(`Placard x Pinnacle: ${success} execuções com sucesso; ${workflowFailures.length} sem sucesso.`);
  lines.push(`Indicações enviadas: ${sent}.`);
  lines.push(`Créditos no mês: ${number(usedCredits)} usados; ${number(remainingCredits)} restantes.`);
  lines.push(`VPN no mês: ${number(latest?.vpnMonthlySpentMB)} MB usados; ${number(latest?.vpnMonthlyRemainingMB)} MB restantes.`);
  lines.push(`Erros: ${errors.length ? errors.slice(0, 5).join(' | ') : 'nenhum registrado'}.`);
  return { text: lines.join('\n').slice(0, 4000), counts: { run: complete.length,
    skipped: skipped.length, failed: failed.length, missing: missing.length,
    workflowSuccess: success, workflowFailed: workflowFailures.length, sent }, errors };
}
async function loadHealth(db, token, now = Date.now(), fetchImpl = fetch) {
  const since = new Date(now - DAY_MS).toISOString();
  const errors = [];
  const [cycles, opportunities, budget, reports] = await Promise.all([
    db.collection('_local_cycle_health').where('startedAt', '>=', since).get(),
    db.collection('_placard_opportunities').where('telegramSentAt', '>=', since).get(),
    db.collection('_odds_api_budget').doc(brasilDay(new Date(now)).slice(0, 7)).get(),
    db.collection('_edge_health_reports').orderBy('generatedAt', 'desc').limit(3).get(),
  ]);
  let runs = [];
  try {
    const response = await fetchImpl('https://api.github.com/repos/ubereats-oss/edge-finder/actions/workflows/placard_value.yml/runs?per_page=100', {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json',
        'User-Agent': 'Edge-Finder-health' }, signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`GitHub HTTP ${response.status}`);
    runs = (await response.json()).workflow_runs || [];
  } catch (error) { errors.push(`consulta GitHub: ${error.message}`); }
  for (const report of reports.docs) {
    const row = report.data();
    if (row.status === 'send_failed') errors.push(`Telegram anterior: ${row.error || 'falha sem detalhe'}`);
  }
  return composeHealth({ cycles: cycles.docs.map(doc => doc.data()), runs,
    opportunities: opportunities.docs.map(doc => doc.data()), budget: budget.data() || {}, priorErrors: errors }, now);
}
module.exports = { scheduledSlots, composeHealth, loadHealth, reportDay };
