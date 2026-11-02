const RETENTION_MS = 30 * 86400000;
const CATEGORIES = Object.freeze({
  DataLimitReached: 'franquia recusada pelo TunnelBear',
  VpnConnectionFailed: 'adaptador não subiu',
  Interrupted: 'conexão interrompida',
  Unknown: 'estado não reconhecido',
  NoRecords: 'TunnelBear sem registro no intervalo',
  ExecutableNotFound: 'executável do TunnelBear não encontrado',
  CountryUnproven: 'país do VPN sem comprovação',
  OtherCountry: 'VPN preexistente em outro país',
  ExternalConfirmation: 'falha na verificação externa de IP',
});
const knownStates = new Set(['Error', 'Disconnected', 'Connected', 'Connecting', 'Disconnecting', 'Success']);
const knownResults = new Set(['DataLimitReached', 'VpnConnectionFailed', 'Success', 'None']);
// Only fixed state fields are retained. Arbitrary native messages, identifiers,
// country/IP fields and log prefixes never cross this boundary.
function statePayload(line) {
  const status = /\bstatus:\s*([^,;\s]+)/i.exec(line) ||
    /(?:Application connection status\s+changed to|OpenVPNInternalChanged changed to|OnConnectionStatusChanged):\s*(\S+)/i.exec(line);
  if (status) {
    const label = knownStates.has(status[1]) ? status[1] : 'estado não reconhecido';
    const result = /\bresponseResult:([^,\s]+)/.exec(line)?.[1];
    return `status:${label}${result ? `, responseResult:${knownResults.has(result) ? result : 'estado não reconhecido'}` : ''}`;
  }
  const on = /\b(?:Set )?IsOn:\s*(True|False)\b/.exec(line);
  if (on) return `IsOn:${on[1]}`;
  if (/Route: Waiting for TUN\/TAP interface to come up|TUN\/TAP: aguardando interface/.test(line)) return 'TUN/TAP: aguardando interface';
  if (/Detected CONNECTED,ERROR/.test(line)) return 'status:Error, responseResult:VpnConnectionFailed';
  if (/\b(?:Old|New) VpnStatus:/.test(line)) {
    const next = /New VpnStatus:\s*(\w+)/.exec(line)?.[1];
    return `status:${knownStates.has(next) ? next : 'estado não reconhecido'}`;
  }
  return null;
}
function categoryFor(lines) {
  if (!lines.length) return 'NoRecords';
  if (lines.some(line => /responseResult:DataLimitReached/.test(line))) return 'DataLimitReached';
  if (lines.some(line => /responseResult:VpnConnectionFailed|TUN\/TAP:/.test(line))) return 'VpnConnectionFailed';
  const joined = lines.join('\n');
  if (/IsOn:True[\s\S]*IsOn:False|status:Connected[\s\S]*status:Disconnected/.test(joined)) return 'Interrupted';
  return 'Unknown';
}
function safeStateLines(lines = []) {
  return lines.flatMap(line => {
    const stamp = /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z) /.exec(line);
    const payload = statePayload(line);
    return stamp && payload ? [`${stamp[1]} ${payload}`] : [];
  }).slice(-20);
}
function failureCodeFor(lines = [], reason = '', recordedCode) {
  const native = categoryFor(lines);
  // Explicit refusal always outranks adapter inference or a generic old category.
  for (const code of ['DataLimitReached', 'VpnConnectionFailed'])
    if (native === code || recordedCode === code) return code;
  if (/executável instalado do TunnelBear não encontrado/i.test(reason)) return 'ExecutableNotFound';
  if (/outro país/.test(reason)) return 'OtherCountry';
  if (/VPN_COUNTRY_UNPROVEN|VPN preexistente não comprovada|VPN com placa Up sem confirmação de IP de Portugal/.test(reason)) return 'CountryUnproven';
  const connected = lines.some(line => /status:Connected\b/.test(line));
  if (connected && /adaptador=Up/.test(reason) && /ipwho\.is|ipapi\.co/.test(reason)) return 'ExternalConfirmation';
  // IsOn records the switch, not establishment of a network connection.
  if (!connected && /adaptador=Down/.test(reason) && (recordedCode === 'Interrupted' || native === 'Interrupted'))
    return 'VpnConnectionFailed';
  return recordedCode || native;
}
function expireStateLines(diagnostic, now = Date.now()) {
  if (!diagnostic || !Array.isArray(diagnostic.stateLines)) return diagnostic;
  return { ...diagnostic, stateLines: (diagnostic.stateLines || []).filter(line =>
    Date.parse(line.slice(0, 24)) >= now - RETENTION_MS) };
}
module.exports = { CATEGORIES, RETENTION_MS, statePayload, categoryFor, failureCodeFor, safeStateLines, expireStateLines };
