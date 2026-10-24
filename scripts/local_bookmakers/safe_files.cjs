const fs = require('node:fs');
const path = require('node:path');
const pause = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
function retry(operation, timeout = 2500) {
  const end = Date.now() + timeout;
  for (;;) {
    try { return operation(); } catch (error) {
      if (!['EBUSY', 'EPERM', 'EACCES'].includes(error.code) || Date.now() >= end) throw error;
      pause(100);
    }
  }
}
function write(method, file, value, options) {
  try { return retry(() => fs[method](file, value, options)); }
  catch (error) {
    if (!['EBUSY', 'EPERM', 'EACCES'].includes(error.code)) throw error;
    const alternate = `${file}.alternate-${Date.now()}-${process.pid}`;
    fs.writeFileSync(alternate, value, options);
    const notice = { at: new Date().toISOString(), file, alternate, error: error.code };
    fs.writeFileSync(`${alternate}.notice.json`, JSON.stringify(notice));
    console.error(`Arquivo bloqueado; registro alternativo: ${alternate}`);
    return alternate;
  }
}
function validBudget(value) {
  if (!value || !Number.isFinite(value.carriedForwardMB) || value.carriedForwardMB < 0
      || !Number.isFinite(value.measuredMB) || value.measuredMB < 0 || !Array.isArray(value.adapterCycles))
    throw new Error('Orçamento VPN inválido.');
  for (const entry of value.adapterCycles) if (!Number.isFinite(entry.bytes) || entry.bytes < 0)
    throw new Error('Medição inválida no orçamento VPN.');
  const total = value.adapterCycles.reduce((sum, entry) => sum + entry.bytes / 1000000, 0);
  if (Math.abs(total - value.measuredMB) > 0.001) throw new Error('Total divergente no orçamento VPN.');
  return value;
}
function atomic(file, text) {
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, text);
  retry(() => fs.renameSync(temporary, file));
}
function saveBudget(file, value) {
  validBudget(value);
  const text = JSON.stringify(value, null, 2);
  // Backup contains the same validated committed state, never corrupt input.
  atomic(file + '.backup', text);
  atomic(file, text);
}
function readBudget(file, notify = () => {}) {
  const parse = name => validBudget(JSON.parse(fs.readFileSync(name, 'utf8').replace(/^\uFEFF/, '')));
  if (!fs.existsSync(file) && !fs.existsSync(file + '.backup')) return null;
  try { return parse(file); }
  catch (original) {
    let restored;
    try { restored = parse(file + '.backup'); }
    catch { throw new Error(`Orçamento e backup indisponíveis: ${original.message}`); }
    atomic(file, JSON.stringify(restored, null, 2));
    notify('Orçamento VPN restaurado da cópia de segurança validada.');
    return restored;
  }
}
module.exports = { ...fs, writeFileSync: (file, value, options) => write('writeFileSync', file, value, options),
  appendFileSync: (file, value, options) => write('appendFileSync', file, value, options),
  retry, validBudget, readBudget, saveBudget, atomic, raw: fs };
