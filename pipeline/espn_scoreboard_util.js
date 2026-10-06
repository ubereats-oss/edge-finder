// A ESPN passou a rejeitar dates=INICIO-FIM no scoreboard (HTTP 400
// "Failed to get events endpoint") — só aceita um dia por chamada.
// Utilitário compartilhado por todos os scripts do pipeline que buscam
// jogos por período: busca dia a dia e reporta quantas chamadas falharam,
// para quem usa decidir se aborta em vez de seguir como se nada tivesse
// mudado (ver tooManyDayFailures).

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function toUtcDate(ymd) {
  return new Date(Date.UTC(parseInt(ymd.slice(0, 4)), parseInt(ymd.slice(4, 6)) - 1, parseInt(ymd.slice(6, 8))));
}

function formatYmd(date) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

function dateRangeDays(start, end) {
  const days = [];
  let cur = toUtcDate(start);
  const last = toUtcDate(end);
  while (cur <= last) {
    days.push(formatYmd(cur));
    cur = new Date(cur.getTime() + 86400000);
  }
  return days;
}

const DAY_FAILURE_ABORT_RATE = 0.5;

// fetchDay(day) -> array de itens daquele dia; pode lançar (rede/HTTP).
// Nunca lança: cada falha de dia é contada e logada, não interrompe os demais.
// Retorna { items, attempted, failed }.
async function fetchDayRange(start, end, fetchDay, delayMs = 80) {
  const days = dateRangeDays(start, end);
  const items = [];
  let failed = 0;
  for (const day of days) {
    try {
      items.push(...await fetchDay(day));
    } catch (e) {
      failed++;
      console.error(`Erro ${day}:`, e.response ? `HTTP ${e.response.status} ${JSON.stringify(e.response.data)}` : e.message);
    }
    await sleep(delayMs);
  }
  return { items, attempted: days.length, failed };
}

function tooManyDayFailures(attempted, failed) {
  return attempted > 0 && failed > 0 && (failed / attempted) >= DAY_FAILURE_ABORT_RATE;
}

module.exports = { sleep, dateRangeDays, fetchDayRange, tooManyDayFailures, DAY_FAILURE_ABORT_RATE };
