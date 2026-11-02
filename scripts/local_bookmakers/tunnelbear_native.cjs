const fs = require('node:fs');
const path = require('node:path');
const STATES = new Set(['Connected', 'Disconnected', 'Connecting', 'Disconnecting', 'Error']);
function parseConnectionLines(text, source = 'trace.log') {
  const rows = [];
  for (const line of text.split(/\r?\n/)) {
    const stamp = /^(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d),(\d{3})/.exec(line);
    if (!stamp) continue;
    // Native Windows timestamps are Sao Paulo, never the Portugal exit timezone.
    const at = Date.parse(`${stamp[1].replace(' ', 'T')}.${stamp[2]}-03:00`);
    const status = /\bstatus:\s*(\w+)/.exec(line)?.[1]
      || /Application connection status\s+changed to:\s*(\w+)/.exec(line)?.[1];
    const country = /\bcountryCode:\s*([A-Z]{2})\b/.exec(line)?.[1];
    const destination = /\bConnecting Portugal\.\.\./.test(line);
    if (Number.isFinite(at) && (STATES.has(status) || destination))
      rows.push({ at: new Date(at).toISOString(), status: STATES.has(status) ? status : 'Connecting',
        country: country || (destination ? 'PT' : null), source });
  }
  return rows;
}
function connectionState(rows, now = Date.now()) {
  const ordered = rows.filter(row => Date.parse(row.at) <= now).sort((a, b) => a.at.localeCompare(b.at));
  let country = null, latest = null;
  for (const row of ordered) {
    if (['Disconnected', 'Error', 'Disconnecting'].includes(row.status)) country = null;
    if (row.status === 'Connecting' && latest?.status !== 'Connecting') country = null;
    if (row.country) country = row.country;
    latest = row;
  }
  return { Status: latest?.status || 'Unavailable', Country: latest?.status === 'Connected' ? country : null,
    At: latest?.at || null, Source: latest?.source || null };
}
function readConnection(roots, now = Date.now()) {
  const rows = [];
  for (const root of roots) {
    let names;
    try { names = fs.readdirSync(root); } catch { continue; }
    for (const name of names.filter(name => /^trace(?:_maintenance)?(?:\.\d+)?\.log$/i.test(name))) {
      let fd;
      try {
        fd = fs.openSync(path.join(root, name), 'r');
        const size = fs.fstatSync(fd).size, length = Math.min(size, 2 * 1024 * 1024);
        const buffer = Buffer.alloc(length);
        fs.readSync(fd, buffer, 0, length, size - length);
        rows.push(...parseConnectionLines(buffer.toString('utf8'), name));
      } catch { /* Rotated/unavailable file: continue other sources. */ }
      finally { if (fd !== undefined) fs.closeSync(fd); }
    }
  }
  return connectionState(rows, now);
}
module.exports = { parseConnectionLines, connectionState, readConnection };
if (require.main === module) process.stdout.write(JSON.stringify(readConnection([
  process.argv[2] || path.join(process.env.ProgramFiles || 'C:/Program Files', 'TunnelBear'),
  path.join(process.env.APPDATA || '', 'TunnelBear/logs')])));
