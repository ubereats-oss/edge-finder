const { isIP } = require('node:net');
const { CATEGORIES } = require('./tunnelbear_states');

function sanitizeReason(value, limit = 300) {
  return String(value || '').split(/\r?\n/).find(line => line.trim())?.trim()
    .replace(/https?:\/\/[^\s<>]+/gi, '[URL removida]')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[dado removido]')
    .replace(/\b(?:Bearer|Basic)\s+\S+/gi, '[dado removido]')
    .replace(/\b(?:token|api[_-]?key|secret|password|senha|cookie|authorization|identificador|identifier|account|email|e-mail|id|uuid|guid|user|username|(?:device|request|client|session|chat)[_-]?id)\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, '[dado removido]')
    .replace(/(?:[A-Z]:\\|\/Users\/|\/home\/)[^\r\n;]*/gi, '[caminho removido]')
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '[endereço removido]')
    .replace(/[\da-f:.%]+/gi, part => isIP(part.split('%')[0]) === 6 ? '[endereço removido]' : part)
    .replace(/\b(?:[\da-f]{2}[:-]){5}[\da-f]{2}\b/gi, '[dado removido]')
    .replace(/\b[\da-f]{8}-[\da-f-]{27,}\b/gi, '[dado removido]')
    .replace(/\b[\da-f]{12,}\b/gi, '[dado removido]')
    .replace(/\blocal-[\w-]+\b/gi, '[dado removido]')
    .replace(/\b[A-Za-z0-9_+\/-]{24,}={0,2}\b/g, '[dado removido]')
    .replace(/\b\d{6,}\b/g, '[dado removido]')
    .replace(/\s+/g, ' ').slice(0, limit) || null;
}

function originalReason(value) {
  const text = sanitizeReason(value);
  return !text || Object.values(CATEGORIES).some(category => text === category
    || text === `VPN não confirmado — ${category}`) ? null : text;
}

function captureVpnFailure(cycle, stage, error) {
  const originalError = originalReason(error?.message || error);
  const failure = { stage, category: stage === 'vpnDisconnect' ? 'erro na desconexão' : CATEGORIES.Unknown,
    originalError, originalErrorUnavailable: !originalError };
  (cycle.vpnFailures ||= []).push(failure);
  return failure;
}

const KINDS = new Set(['read_with_games', 'no_eligible', 'disconnect_warning', 'vpn_failed', 'other_failed', 'skipped']);
const CATEGORIES_ALLOWED = new Set([...Object.values(CATEGORIES), 'pulado', 'erro na desconexão',
  'sem jogo elegível na Betano', 'lido com jogos', 'autenticação ou preparação', 'erro na leitura da Betano', 'outra falha']);
function result(kind, category, reason) {
  const originalError = originalReason(reason);
  return { kind, category, originalError, originalErrorUnavailable: !originalError };
}
function classifyCycle(cycle) {
  if (cycle.healthCause) {
    const value = cycle.healthCause;
    const known = KINDS.has(value.kind) && CATEGORIES_ALLOWED.has(value.category);
    return result(known ? value.kind : 'other_failed', known ? value.category : 'outra falha', value.originalError);
  }
  if (['ciclo pulado', 'paused'].includes(cycle.status))
    return result('skipped', 'pulado', cycle.pauseReason || cycle.reason);
  const stages = cycle.stages || {};
  const vpn = cycle.vpnFailures || [];
  const failure = cycle.tunnelBear?.failure;
  const errors = cycle.errors || [];
  const fallback = cycle.originalError || cycle.error || cycle.reason || errors[0];
  if (stages.vpnConnect?.error || cycle.status === 'ciclo sem conexão' || failure) {
    const code = failure?.code;
    const original = vpn.find(row => row.stage === 'vpnConnect')?.originalError
      || failure?.originalError || stages.vpnConnect?.originalError || stages.vpnConnect?.error || fallback;
    return result(code && !Object.hasOwn(CATEGORIES, code) ? 'other_failed' : 'vpn_failed',
      code ? CATEGORIES[code] || 'outra falha' : CATEGORIES.Unknown, original);
  }
  const read = cycle.reads?.betano;
  const games = Number(read?.games ?? cycle.gamesByHouse?.betano ?? 0);
  const stageErrors = Object.entries(stages).filter(([, stage]) => stage.error).map(([name]) => name);
  const disconnect = cycle.disconnectError || stages.vpnDisconnect?.error
    || vpn.find(row => row.stage === 'vpnDisconnect')?.originalError
    || (games > 0 && /VPN sem confirmação pela placa/.test(String(fallback)) ? fallback : null);
  if (games > 0 && disconnect && stageErrors.every(name => name === 'vpnDisconnect')
      && !cycle.usageError && !cycle.failureStatusError && !cycle.healthSync?.error)
    return result('disconnect_warning', 'erro na desconexão',
      vpn.find(row => row.stage === 'vpnDisconnect')?.originalError || disconnect);
  const validListing = Object.values(cycle.leagueAudit?.betano || {}).some(audit =>
    audit.events?.length || audit.requests?.some(row => row.httpStatus === 200));
  if (read && !games && /Betano sem odds elegíveis/.test(read.error || '') && validListing)
    return result('no_eligible', 'sem jogo elegível na Betano', read.error);
  if (cycle.status === 'complete') return result('read_with_games', 'lido com jogos', null);
  const reason = read?.error || fallback;
  const category = stages.preparation?.error || /Firebase|autentica/i.test(String(reason))
    ? 'autenticação ou preparação' : read?.error ? 'erro na leitura da Betano' : 'outra falha';
  return result('other_failed', category, reason);
}

function groupedIssues(cycles, external = []) {
  const groups = new Map();
  const add = (category, original, warning = false) => {
    const key = `${warning}|${category}`;
    if (!groups.has(key)) groups.set(key, { category, count: 0, example: sanitizeReason(original), warning });
    const row = groups.get(key); row.count++;
    row.example ||= sanitizeReason(original);
  };
  for (const cycle of cycles) {
    const cause = classifyCycle(cycle);
    if (['vpn_failed', 'other_failed', 'disconnect_warning'].includes(cause.kind))
      add(cause.category, cause.originalError, cause.kind === 'disconnect_warning');
    if (cycle.syncError || cycle.healthSync?.error) add('sincronização com a nuvem', cycle.syncError || cycle.healthSync.error);
    if (cycle.usageError) add('medição de consumo VPN', cycle.usageError);
  }
  for (const issue of external) add(issue.category, issue.originalError);
  return [...groups.values()];
}

module.exports = { sanitizeReason, originalReason, captureVpnFailure, classifyCycle, groupedIssues };
