const { createHash } = require('node:crypto');
const digest = value => createHash('sha256').update(value).digest('hex').slice(0, 24);

function tunnelBearAlerts(diagnostic) {
  if (!diagnostic) return [];
  const alerts = [];
  if (diagnostic.failure) {
    const { code, message } = diagnostic.failure;
    const epoch = diagnostic.lastSuccessfulConnectionAt || 'initial';
    alerts.push({ id: `tb-refusal-${digest(`${epoch}|${code}|${message}`)}`,
      text: `TunnelBear recusou a conexão — ${code}: ${message}` });
  }
  if (diagnostic.updateObserved) {
    const version = diagnostic.requestedUpdateVersion || `desconhecida-${diagnostic.version}`;
    alerts.push({ id: `tb-update-${digest(version)}`,
      text: `TunnelBear pede atualização — atualize manualmente${diagnostic.requestedUpdateVersion ? ` (versão ${version})` : ' (versão pedida não informada no registro)'}` });
  }
  return alerts;
}
module.exports = { tunnelBearAlerts };
