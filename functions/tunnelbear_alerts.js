const { createHash } = require('node:crypto');
const digest = value => createHash('sha256').update(value).digest('hex').slice(0, 24);
const { CATEGORIES, safeStateLines } = require('./tunnelbear_states');

function tunnelBearAlerts(diagnostic, now = Date.now()) {
  if (!diagnostic) return [];
  const alerts = [];
  if (diagnostic.failure) {
    const code = Object.hasOwn(CATEGORIES, diagnostic.failure.code) ? diagnostic.failure.code : 'Unknown';
    const category = CATEGORIES[code];
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now));
    const epoch = (diagnostic.lastSuccessfulConnectionAt || 'initial') + (code === 'LoginRequired' ? `|${day}` : '');
    const stateLines = safeStateLines(diagnostic.stateLines);
    alerts.push({ id: `tb-refusal-${digest(`${epoch}|${code}`)}`,
      category, stateLinesAt: stateLines[0]?.slice(0, 24) || new Date().toISOString(),
      text: [code === 'LoginRequired' ? 'TunnelBear pede login — abrir o TunnelBear e fazer login' : `VPN não confirmado — ${category}`, ...stateLines].join('\n') });
  }
  if (diagnostic.updateObserved) {
    const version = diagnostic.requestedUpdateVersion || `desconhecida-${diagnostic.version}`;
    alerts.push({ id: `tb-update-${digest(version)}`,
      text: `TunnelBear pede atualização — atualize manualmente${diagnostic.requestedUpdateVersion ? ` (versão ${version})` : ' (versão pedida não informada no registro)'}` });
  }
  return alerts;
}
module.exports = { tunnelBearAlerts };
