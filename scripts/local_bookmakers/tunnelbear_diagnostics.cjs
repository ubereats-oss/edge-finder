const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const safe = require('./safe_files.cjs');
const { originalReason } = require('../../functions/local_cycle_health.js');
const { CATEGORIES, statePayload, categoryFor, expireStateLines, RETENTION_MS } = require('../../functions/tunnelbear_states');

function parseNative(text, since, until) {
  const failures = [], updates = [], stateLines = [];
  for (const line of text.split(/\r?\n/)) {
    const stamp = /^(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d),(\d{3})/.exec(line);
    if (!stamp) continue;
    // The source is this Windows machine, not the VPN exit in Portugal.
    const offset = new Intl.DateTimeFormat('en', { timeZone: 'America/Sao_Paulo', timeZoneName: 'longOffset' })
      .formatToParts(new Date(`${stamp[1].slice(0, 10)}T12:00:00Z`))
      .find(part => part.type === 'timeZoneName').value.replace('GMT', '') || '+00:00';
    const millis = Date.parse(`${stamp[1].replace(' ', 'T')}.${stamp[2]}${offset}`);
    if (!Number.isFinite(millis) || millis > Date.parse(until)) continue;
    const version = /new version:\s*(\d+(?:\.\d+){2,3})/i.exec(line);
    if (version) updates.push({ at: new Date(millis).toISOString(), version: version[1] });
    if (millis < Date.parse(since)) continue;
    const payload = statePayload(line);
    if (payload) stateLines.push(`${new Date(millis).toISOString()} ${payload}`);
    const code = /responseResult:(DataLimitReached|VpnConnectionFailed)\b/.exec(payload || '')?.[1];
    if (code) failures.push({ at: new Date(millis).toISOString(), code,
      message: code === 'DataLimitReached' ? 'Data limit reached.' : 'VPN Connection failed' });
  }
  failures.sort((a, b) => a.at.localeCompare(b.at));
  updates.sort((a, b) => a.at.localeCompare(b.at));
  return { failures, stateLines, requestedUpdateVersion: updates.at(-1)?.version || null };
}

function startMetadata(root) {
  const result = { runtimeSha: null, tunnelBearVersion: null };
  try {
    const sha = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', timeout: 4000, windowsHide: true });
    result.runtimeSha = /^[a-f0-9]{40}$/.test(sha.stdout?.trim()) ? sha.stdout.trim() : process.env.EDGE_RUNTIME_SHA || null;
    if (!result.runtimeSha) result.versionError = 'SHA indisponível no Git e no runtime.';
  } catch (error) { result.versionError = error.message; }
  try {
    const command = "$p=Join-Path ${env:ProgramFiles(x86)} 'TunnelBear\\TunnelBear.exe'; (Get-Item -LiteralPath $p).VersionInfo.FileVersion";
    const version = spawnSync('powershell.exe', ['-NoProfile', '-Command', command],
      { encoding: 'utf8', timeout: 6000, windowsHide: true });
    result.tunnelBearVersion = version.stdout?.trim() || null;
    if (!result.tunnelBearVersion) result.tunnelBearVersionError = 'Versão do executável TunnelBear indisponível.';
  } catch (error) { result.tunnelBearVersionError = error.message; }
  return result;
}

function collectDiagnostic(cycle, logDir, roots) {
  const diagnostic = { version: cycle.tunnelBearVersion, failure: null, nativeFailures: [], stateLines: [],
    requestedUpdateVersion: null, updateObserved: (cycle.tunnelBearEvents || [])
      .some(event => ['update_ignored', 'update_closed'].includes(event.status)), sources: [], errors: [] };
  const directories = roots || [path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'TunnelBear'),
    path.join(process.env.APPDATA || '', 'TunnelBear', 'logs')];
  const updates = [];
  for (const directory of directories) {
    try {
      for (const name of fs.readdirSync(directory).filter(name => /^trace(?:_maintenance)?(?:\.\d+)?\.log$/i.test(name))) {
        const file = path.join(directory, name);
        try {
          const fd = fs.openSync(file, 'r');
          let buffer;
          try {
            const size = fs.fstatSync(fd).size, length = Math.min(size, 1024 * 1024);
            buffer = Buffer.alloc(length); fs.readSync(fd, buffer, 0, length, size - length);
          } finally { fs.closeSync(fd); }
          const parsed = parseNative(buffer.toString('utf8'), cycle.stages?.vpnConnect?.startedAt || cycle.startedAt,
            cycle.stages?.vpnConnect?.finishedAt || cycle.finishedAt);
          diagnostic.stateLines.push(...parsed.stateLines);
          if (parsed.requestedUpdateVersion) updates.push(parsed.requestedUpdateVersion);
          diagnostic.sources.push(name);
        } catch { diagnostic.errors.push('Leitura de registro TunnelBear indisponível'); }
      }
    } catch { diagnostic.errors.push('Diretório de registros TunnelBear indisponível'); }
  }
  diagnostic.nativeFailures.sort((a, b) => a.at.localeCompare(b.at));
  diagnostic.stateLines = [...new Set(diagnostic.stateLines)].sort();
  if (cycle.stages?.vpnConnect?.error) {
    const code = categoryFor(diagnostic.stateLines);
    const originalError = originalReason(cycle.vpnFailures?.find(row => row.stage === 'vpnConnect')?.originalError
      || cycle.stages.vpnConnect.originalError || cycle.stages.vpnConnect.error);
    diagnostic.failure = { code, category: CATEGORIES[code], message: CATEGORIES[code],
      originalError, originalErrorUnavailable: !originalError };
    diagnostic.stateLines = diagnostic.stateLines.slice(-20);
  } else diagnostic.stateLines = [];
  // Versions are numeric, so a rotated older log cannot replace a newer offer.
  diagnostic.requestedUpdateVersion = updates.sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).at(-1) || null;
  const stateFile = path.join(logDir, 'tunnelbear-notification-state.json');
  let state = {};
  try { if (fs.existsSync(stateFile)) state = JSON.parse(fs.readFileSync(stateFile, 'utf8')); }
  catch { diagnostic.errors.push('Estado de avisos indisponível'); }
  if (cycle.vpnConnectedAt && !cycle.stages?.vpnConnect?.error) {
    state.lastSuccessfulConnectionAt = cycle.vpnConnectedAt;
    try { safe.atomic(stateFile, JSON.stringify(state)); }
    catch { diagnostic.errors.push('Gravação do estado de avisos indisponível'); }
  }
  diagnostic.lastSuccessfulConnectionAt = state.lastSuccessfulConnectionAt || null;
  return diagnostic;
}
function pruneLocalStateLines(logDir, now = Date.now()) {
  if (!fs.existsSync(logDir)) return;
  const prune = row => {
    if (row.tunnelBear) {
      row.tunnelBear = expireStateLines(row.tunnelBear, now);
      if (row.tunnelBear.nativeFailures?.length && Date.parse(row.startedAt || row.at) < now - RETENTION_MS)
        row.tunnelBear.nativeFailures = [];
    }
  };
  for (const name of fs.readdirSync(logDir).filter(name => /^cycle-.*\.json$/.test(name) ||
    name === 'hourly-cycles.jsonl' || name === 'cloud-cycle-pending.json')) {
    const file = path.join(logDir, name), before = fs.readFileSync(file, 'utf8');
    const value = name.endsWith('.jsonl') ? before.trim().split(/\r?\n/).filter(Boolean).map(JSON.parse) : JSON.parse(before);
    const original = JSON.stringify(value);
    if (Array.isArray(value)) value.forEach(prune); else prune(value);
    if (JSON.stringify(value) !== original) safe.atomic(file, name.endsWith('.jsonl') ?
      value.map(row => JSON.stringify(row)).join('\n') + '\n' : JSON.stringify(value, null, 2));
  }
}
module.exports = { parseNative, startMetadata, collectDiagnostic, pruneLocalStateLines };
