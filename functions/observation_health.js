const { report } = require('./placard_value');
const { CLOSING_ODDS_CAPTURE_WINDOW_AFTER_MS } = require('./closing_odds_rules');

const OBSERVATION_START = Date.parse('2026-11-15T03:00:00Z');
const timestamp = row => Date.parse(row.firstEvaluatedAt || row.evaluatedAt || '');
const number = value => Number.isFinite(value) ? value.toFixed(2).replace('.', ',') : 'não confirmado';

function closingState(entry, now) {
  if (Number.isFinite(entry.closingOdds) && entry.closingOdds > 1) return 'capturado';
  const start = Date.parse(entry.commenceTime || '');
  if (entry.closingOddsStatus === 'expirada'
    || (Number.isFinite(start) && start + CLOSING_ODDS_CAPTURE_WINDOW_AFTER_MS < now)) return 'perdido';
  return 'pendente';
}

function nflHealth(entries, now) {
  const published = entries.filter(row => row.esporte === 'americanfootball/nfl'
    && row.published === true && row.hasModelProb === true
    && row.validForCalibration !== false && row.source !== 'pt_odds_check');
  const observation = published.filter(row => timestamp(row) >= OBSERVATION_START && timestamp(row) < now);
  const recent = observation.filter(row => timestamp(row) >= now - 86400000);
  const closing = { capturado: 0, pendente: 0, perdido: 0 };
  for (const row of observation) closing[closingState(row, now)]++;
  // CLV do ledger já está em pontos percentuais. Reutiliza o bootstrap oficial.
  const score = report(published.map(row => ({ ...row, apiSport: row.esporte, clvPct: row.clv,
    closingStatus: closingState(row, now) === 'capturado' ? 'capturada'
      : closingState(row, now) === 'perdido' ? 'indisponivel' : 'pendente' })));
  return { recent: recent.length, closing, score,
    text: `NFL (observação): ${recent.length} indicações nas últimas 24 h; fechamentos: ${closing.capturado} capturados, ${closing.pendente} ${closing.pendente === 1 ? 'pendente' : 'pendentes'}, ${closing.perdido} perdidos; placar acumulado: ${score.n} com CLV, CLV médio ${number(score.mean)}%, IC95 [${number(score.lower)}%; ${number(score.upper)}%].` };
}

function sampleHealth(state, now) {
  if (!state || state.exists === false) return null;
  const completed = state.completedNights || [];
  const completedDates = new Set(completed.map(row => typeof row === 'string' ? row : row.date));
  const due = (state.plannedDates || []).find(date =>
    Date.parse(`${date}T${state.localTime || '16:10'}:00-03:00`) < now && !completedDates.has(date));
  const failed = [...(state.attempts || [])].reverse().find(row =>
    ['failed', 'not_sampled', 'falhou', 'não amostrada'].includes(row.status));
  if (due || (failed && !completedDates.has(failed.date))) {
    const reason = failed && (failed.date === due || !due) ? failed.reason || failed.error : null;
    return `Amostra props NBA: noite ${completed.length + 1} falhou: ${reason || 'sem registro de execução ou resultado'}.`;
  }
  return `Amostra props NBA: noite ${completed.length} de ${state.nightTarget || 5} concluída.`;
}

async function loadNflLedger(token, fetchImpl = fetch) {
  const url = 'https://api.github.com/repos/ubereats-oss/edge-finder/contents/odds_history?ref=data';
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json',
    'User-Agent': 'Edge-Finder-health' };
  const listing = await fetchImpl(url, { headers, signal: AbortSignal.timeout(15000) });
  if (!listing.ok) throw new Error(`GitHub HTTP ${listing.status}`);
  const files = await listing.json();
  if (!Array.isArray(files)) throw new Error('lista de partições NFL inválida');
  const nfl = files.filter(file => file.type === 'file' && /^model_ledger_nfl_.*\.json$/.test(file.name))
    .sort((a, b) => a.name.localeCompare(b.name));
  if (!nfl.length) throw new Error('partições NFL não encontradas');
  const rows = [];
  for (const file of nfl) {
    const response = await fetchImpl(file.download_url, { signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`partição NFL HTTP ${response.status}`);
    const entries = await response.json();
    if (!Array.isArray(entries)) throw new Error('partição NFL inválida');
    rows.push(...entries);
  }
  return rows;
}

module.exports = { closingState, nflHealth, sampleHealth, loadNflLedger };
