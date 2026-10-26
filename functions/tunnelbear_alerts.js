const { createHash } = require('node:crypto');
const digest = value => createHash('sha256').update(value).digest('hex').slice(0, 24);
const { CATEGORIES, safeStateLines } = require('./tunnelbear_states');

function tunnelBearAlerts(diagnostic) {
  if (!diagnostic) return [];
  const alerts = [];
  if (diagnostic.failure) {
    const code = Object.hasOwn(CATEGORIES, diagnostic.failure.code) ? diagnostic.failure.code : 'Unknown';
    const category = CATEGORIES[code];
    const epoch = diagnostic.lastSuccessfulConnectionAt || 'initial';
    const stateLines = safeStateLines(diagnostic.stateLines);
    alerts.push({ id: `tb-refusal-${digest(`${epoch}|${code}`)}`,
      category, stateLinesAt: stateLines[0]?.slice(0, 24) || new Date().toISOString(),
      text: [`VPN não confirmado — ${category}`, ...stateLines].join('\n') });
  }
  if (diagnostic.updateObserved) {
    const version = diagnostic.requestedUpdateVersion || `desconhecida-${diagnostic.version}`;
    alerts.push({ id: `tb-update-${digest(version)}`,
      text: `TunnelBear pede atualização — atualize manualmente${diagnostic.requestedUpdateVersion ? ` (versão ${version})` : ' (versão pedida não informada no registro)'}` });
  }
  return alerts;
}
module.exports = { tunnelBearAlerts };
