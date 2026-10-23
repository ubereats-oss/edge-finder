function brasilDay(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo',
    year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}
function daysRemaining(day) {
  const [year, month, date] = day.split('-').map(Number);
  return new Date(Date.UTC(year, month, 0)).getUTCDate() - date + 1;
}
function vpnBudgetForDay(budget, now = new Date()) {
  const day = brasilDay(now);
  const month = day.slice(0, 7);
  const limitMB = month <= '2026-10' ? 2700 : 4000;
  const currentMonth = budget.month || '2026-10';
  const reset = currentMonth !== month;
  const measured = reset ? 0 : Number(budget.measuredMB || 0);
  const carried = reset ? 0 : Number(budget.carriedForwardMB || 0);
  const spent = measured + carried;
  const todayUsed = reset ? 0 : (budget.adapterCycles || []).filter(entry =>
    brasilDay(new Date(entry.startedAt)) === day).reduce((sum, entry) => sum + Number(entry.bytes || 0) / 1000000, 0);
  const allowance = Math.max(0, (limitMB - spent + todayUsed) / daysRemaining(day));
  return { day, month, limitMB, reset, spent, todayUsed, daysRemaining: daysRemaining(day),
    allowance, remaining: Math.max(0, allowance - todayUsed), monthlyRemaining: Math.max(0, limitMB - spent) };
}
function shouldRunForPinnacleWindow(window, now = Date.now()) {
  const rows = Object.values(window || {});
  const events = rows.flatMap(row => row.events || []);
  const newest = Math.max(...rows.map(row => Date.parse(row.updatedAt || '')).filter(Number.isFinite), -Infinity);
  if (!events.length) return { run: true, reason: 'lista Pinnacle vazia' };
  if (!Number.isFinite(newest) || now - newest > 2 * 3600000)
    return { run: true, reason: 'lista Pinnacle desatualizada' };
  const near = events.filter(event => {
    const start = Date.parse(event.commence_time);
    return start > now && start <= now + 3 * 3600000;
  });
  return near.length ? { run: true, reason: `${near.length} jogos em até 3 horas` }
    : { run: false, reason: 'nenhum jogo Pinnacle começa nas próximas 3 horas' };
}
module.exports = { brasilDay, daysRemaining, vpnBudgetForDay, shouldRunForPinnacleWindow };
