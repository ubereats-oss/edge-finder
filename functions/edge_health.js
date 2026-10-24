const { summarize, monthlyUsed, brasilDay } = require('./odds_api_monthly_budget');
const { report: clvReport } = require('./placard_value');
const { isAnnulled } = require('./market_integrity');

const DAY_MS = 24 * 3600000;
const reportDay = (now = new Date()) => brasilDay(now);
function scheduledSlots(now) {
  const start = now - DAY_MS;
  const first = Math.ceil((start - 50 * 60000) / 3600000) * 3600000 + 50 * 60000;
  const slots = [];
  for (let at = first; at < now; at += 3600000) slots.push(at);
  return slots;
}
const OCT_START = '2026-10-01T03:00:00.000Z';
const OCT_END = '2026-11-01T03:00:00.000Z';
const HOUSE_NAMES = { placard: 'Placard', betano: 'Betano', bwin: 'Bwin', lebull: 'LeBull',
  esc_online: 'ESC Online', goldenpark: 'GoldenPark', retabet: 'Retabet', betclic: 'Betclic' };
const number = value => Number.isFinite(value) ? value.toFixed(2).replace('.', ',') : 'não sei';
function octoberReview(cycles, opportunities, budget) {
  const inOctober = value => Date.parse(value) >= Date.parse(OCT_START) && Date.parse(value) < Date.parse(OCT_END);
  const monthCycles = cycles.filter(row => inOctober(row.startedAt));
  const sent = opportunities.filter(row => inOctober(row.telegramSentAt) && !isAnnulled(row));
  const stats = clvReport(sent);
  const lines = ['Levantamento de outubro (Brasília):'];
  for (const [key, name] of Object.entries(HOUSE_NAMES)) {
    const rows = sent.filter(row => String(row.bookmaker || 'Placard').toLowerCase().replace(/\s+/g, '_') === key);
    const mean = clvReport(rows).mean;
    const success = monthCycles.filter(row => Number(row.gamesByHouse?.[key] || 0) > 0).length;
    lines.push(`${name}: ${rows.length} indicações; CLV ${number(mean)}%; ${success} ciclos com jogos.`);
  }
  lines.push(`CLV médio: ${number(stats.mean)}%; IC 95% [${number(stats.lower)}%; ${number(stats.upper)}%]; n=${stats.n}, eventos=${stats.nEvents}. Bootstrap por evento (4.000 reamostragens).`);
  const run = monthCycles.filter(row => row.status === 'complete').length;
  const skipped = monthCycles.filter(row => ['ciclo pulado', 'paused'].includes(row.status)).length;
  const latest = monthCycles.slice().sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))[0];
  const vpn = latest?.vpnMonthlySpentMB ?? budget.vpn?.spentMB;
  const estimated = monthCycles.filter(row => row.estimated).length;
  lines.push(`VPN: ${number(vpn)} MB usados (${estimated} ciclos com estimativa marcada); créditos usados: ${number(monthlyUsed(budget))}.`);
  lines.push(`Ciclos: ${run} rodados; ${skipped} pulados; ${monthCycles.length - run - skipped} com falha. Fonte: registros recebidos.`);
  return lines.join('\n');
}
function composeHealth({ cycles = [], runs = [], opportunities = [], budget = {}, priorErrors = [], octoberBudget = {} }, now = Date.now()) {
  const start = now - DAY_MS;
  const recent = cycles.filter(row => Date.parse(row.startedAt) >= start && Date.parse(row.startedAt) < now);
  const complete = recent.filter(row => row.status === 'complete');
  const skipped = recent.filter(row => ['ciclo pulado', 'paused'].includes(row.status));
  const failed = recent.filter(row => !['complete', 'ciclo pulado', 'paused'].includes(row.status));
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
  const lines = [`Saúde Edge Finder — ${brasilDay(new Date(now))}, últimas 24 horas`];
  if (brasilDay(new Date(now)) >= '2026-11-01') lines.push('Coleta local: aguardando orçamento de novembro. Placard x Pinnacle continua com os créditos renovados.');
  if (!recent.length) lines.push('⚠️ computador desligado ou coleta parada — nenhum registro de ciclo local chegou.');
  lines.push(`Ciclos locais: ${complete.length} rodados; ${skipped.length} pulados; ${failed.length} com falha; ${missing.length} ausentes.`);
  if (skipped.length) {
    const reasons = new Map();
    for (const row of skipped) {
      const reason = row.reason || 'motivo não registrado';
      reasons.set(reason, (reasons.get(reason) || 0) + 1);
    }
    lines.push(`Pulados: ${[...reasons].slice(0, 3).map(([reason, count]) => `${count}× ${reason.slice(0, 160)}`).join(' | ')}.`);
  }
  lines.push(`Casas com jogos: ${houses.join(', ') || 'nenhuma'}.`);
  lines.push(`Placard x Pinnacle: ${success} execuções com sucesso; ${workflowFailures.length} sem sucesso.`);
  lines.push(`Indicações enviadas: ${sent}.`);
  lines.push(`Créditos no mês: ${number(usedCredits)} usados; ${number(remainingCredits)} restantes.`);
  lines.push(`VPN no mês: ${number(latest?.vpnMonthlySpentMB)} MB usados; ${number(latest?.vpnMonthlyRemainingMB)} MB restantes.`);
  if (brasilDay(new Date(now)) === '2026-11-01') lines.push(octoberReview(cycles, opportunities, octoberBudget));
  lines.push(`Erros: ${errors.length ? errors.slice(0, 5).map(error => String(error).slice(0, 160)).join(' | ') : 'nenhum registrado'}.`);
  return { text: lines.join('\n').slice(0, 4000), counts: { run: complete.length,
    skipped: skipped.length, failed: failed.length, missing: missing.length,
    workflowSuccess: success, workflowFailed: workflowFailures.length, sent }, errors };
}
async function loadHealth(db, token, now = Date.now(), fetchImpl = fetch) {
  const since = new Date(now - DAY_MS).toISOString();
  const october = brasilDay(new Date(now)) === '2026-11-01';
  const dataSince = october ? OCT_START : since;
  const errors = [];
  const [cycles, opportunities, budget, reports, alerts, octoberBudget] = await Promise.all([
    db.collection('_local_cycle_health').where('startedAt', '>=', dataSince).get(),
    db.collection('_placard_opportunities').where('telegramSentAt', '>=', dataSince).get(),
    db.collection('_odds_api_budget').doc(brasilDay(new Date(now)).slice(0, 7)).get(),
    db.collection('_edge_health_reports').orderBy('generatedAt', 'desc').limit(3).get(),
    db.collection('_edge_budget_alerts').where('failedAt', '>=', since).get(),
    october ? db.collection('_odds_api_budget').doc('2026-10').get() : Promise.resolve(null),
  ]);
  let runs = [];
  try {
    for (let page = 1; ; page++) {
      const response = await fetchImpl(`https://api.github.com/repos/ubereats-oss/edge-finder/actions/workflows/placard_value.yml/runs?per_page=100&page=${page}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json',
          'User-Agent': 'Edge-Finder-health' }, signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error(`GitHub HTTP ${response.status}`);
      const batch = (await response.json()).workflow_runs || [];
      runs.push(...batch);
      if (batch.length < 100 || Date.parse(batch.at(-1).created_at) < Date.parse(since)) break;
    }
  } catch (error) { errors.push(`consulta GitHub: ${error.message}`); }
  for (const report of reports.docs) {
    const row = report.data();
    if (row.status === 'send_failed') errors.push(`Telegram anterior: ${row.error || 'falha sem detalhe'}`);
  }
  for (const alert of alerts.docs) errors.push(`Aviso Telegram ${alert.id}: ${alert.data().error}`);
  return composeHealth({ cycles: cycles.docs.map(doc => doc.data()), runs,
    opportunities: opportunities.docs.map(doc => doc.data()), budget: budget.data() || {}, priorErrors: errors,
    octoberBudget: octoberBudget?.data() || {} }, now);
}
module.exports = { scheduledSlots, composeHealth, loadHealth, reportDay, octoberReview };
