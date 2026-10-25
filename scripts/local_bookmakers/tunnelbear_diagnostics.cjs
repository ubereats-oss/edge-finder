const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const safe = require('./safe_files.cjs');

function parseNative(text, since, until) {
  const failures = [], updates = [];
  for (const line of text.split(/\r?\n/)) {
    const stamp = /^(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d),(\d{3})/.exec(line);
    if (!stamp) continue;
    // TunnelBear writes Windows local time, without an offset.
    const millis = new Date(`${stamp[1].replace(' ', 'T')}.${stamp[2]}`).getTime();
    if (!Number.isFinite(millis) || millis > Date.parse(until)) continue;
    const version = /new version:\s*(\d+(?:\.\d+){2,3})/i.exec(line);
    if (version) updates.push({ at: new Date(millis).toISOString(), version: version[1] });
    if (millis < Date.parse(since)) continue;
    const failure = /status:Disconnected, responseResult:([^,]+),.*?message:(.*)$/.exec(line);
    if (failure && !/^(?:None|Success)$/i.test(failure[1]) &&
        !/^(?:VPN Connection canceled|User canceled)/i.test(failure[2].trim())) {
      failures.push({ at: new Date(millis).toISOString(), code: failure[1].trim(),
        message: failure[2].trim().slice(0, 500) });
    }
  }
  failures.sort((a, b) => a.at.localeCompare(b.at));
  updates.sort((a, b) => a.at.localeCompare(b.at));
  return { failures, requestedUpdateVersion: updates.at(-1)?.version || null };
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
  const diagnostic = { version: cycle.tunnelBearVersion, failure: null, nativeFailures: [],
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
          const parsed = parseNative(buffer.toString('utf8'), cycle.startedAt, cycle.finishedAt);
          diagnostic.nativeFailures.push(...parsed.failures.map(row => ({ ...row, source: file })));
          if (parsed.requestedUpdateVersion) updates.push(parsed.requestedUpdateVersion);
          diagnostic.sources.push(file);
        } catch (error) { diagnostic.errors.push(`${file}: ${error.code || error.message}`); }
      }
    } catch (error) { diagnostic.errors.push(`${directory}: ${error.code || error.message}`); }
  }
  diagnostic.nativeFailures.sort((a, b) => a.at.localeCompare(b.at));
  if (cycle.stages.vpnConnect?.error) diagnostic.failure = diagnostic.nativeFailures[0] || null;
  // Versions are numeric, so a rotated older log cannot replace a newer offer.
  diagnostic.requestedUpdateVersion = updates.sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).at(-1) || null;
  const stateFile = path.join(logDir, 'tunnelbear-notification-state.json');
  let state = {};
  try { if (fs.existsSync(stateFile)) state = JSON.parse(fs.readFileSync(stateFile, 'utf8')); }
  catch (error) { diagnostic.errors.push(`Estado de avisos: ${error.message}`); }
  if (cycle.vpnConnectedAt) {
    state.lastSuccessfulConnectionAt = cycle.vpnConnectedAt;
    try { safe.atomic(stateFile, JSON.stringify(state)); }
    catch (error) { diagnostic.errors.push(`Gravação do estado de avisos: ${error.message}`); }
  }
  diagnostic.lastSuccessfulConnectionAt = state.lastSuccessfulConnectionAt || null;
  return diagnostic;
}
module.exports = { parseNative, startMetadata, collectDiagnostic };
