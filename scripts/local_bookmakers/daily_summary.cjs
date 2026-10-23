const fs = require('node:fs');
const path = require('node:path');

const LOG_DIR = path.resolve(__dirname, '../../.local_logs/betano');
const NAMES = { betano: 'Betano', bwin: 'Bwin', lebull: 'LeBull', esc_online: 'ESC Online',
  goldenpark: 'GoldenPark', retabet: 'Retabet', betclic: 'Betclic' };
const STATUSES = { complete: 'concluído', failed: 'falhou', paused: 'pausado',
  'ciclo pulado': 'ciclo pulado', 'ciclo sem conexão': 'falhou sem conexão' };

function failureReasons(read) {
  if (!['empty', 'timeout', 'failed'].includes(read.readingStatus)) return [];
  const messages = [read.error, ...(read.diagnostics || []).flatMap(item => typeof item === 'string'
    ? [item] : [item.reason, item.error, item.directError])];
  return [...new Set(messages.filter(value => typeof value === 'string' && value.trim()))];
}

function localDay(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function generateSummary() {
  const today = localDay(new Date());
  const logFile = path.join(LOG_DIR, 'hourly-cycles.jsonl');
  const rows = fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8').replace(/^\uFEFF/, '')
    .split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line))
    .filter(row => localDay(new Date(row.at)) === today) : [];
  rows.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  // Older compact log entries can recover their reasons from the existing full cycle log.
  const missing = rows.filter(row => Object.values(row.houses || {}).some(read =>
    ['empty', 'timeout', 'failed'].includes(read.readingStatus) && !read.failureReasons?.length));
  if (missing.length) {
    const needed = new Map(missing.map(row => [row.at, row]));
    const utcDays = new Set(missing.map(row => new Date(row.at).toISOString().slice(0, 10)));
    for (const name of fs.readdirSync(LOG_DIR)) {
      if (!/^cycle-.*\.json$/.test(name) || !utcDays.has(name.slice(6, 16))) continue;
      const cycle = JSON.parse(fs.readFileSync(path.join(LOG_DIR, name), 'utf8'));
      const row = needed.get(cycle.localDateTime);
      if (!row) continue;
      for (const [key, read] of Object.entries(row.houses || {})) {
        if (!read.failureReasons?.length && cycle.reads?.[key])
          read.failureReasons = failureReasons(cycle.reads[key]);
      }
    }
  }
  const number = value => Number.isFinite(value) ? value.toLocaleString('pt-BR', { maximumFractionDigits: 3 }) : 'indisponível';
  const duration = value => Number.isFinite(value) ? `${number(value / 1000)} s` : 'indisponível';
  const clean = text => text.replace(/\u001b\[[0-9;]*m/g, '').split(/\r?\nCall log:/)[0].replace(/\s+/g, ' ').trim();
  const lines = [`Resumo da coleta local — ${today}`, 'MB decimais do navegador; média por ciclo em que a casa foi executada.', '', 'Ciclos:'];
  const daily = rows.at(-1)?.dailyVpn;
  if (daily) lines.push(`VPN hoje: cota ${number(daily.allowance)} MB; gastos ${number(daily.todayUsed)} MB; disponíveis ${number(daily.remaining)} MB; saldo mensal ${number(daily.monthlyRemaining)} MB.`);
  for (const row of rows) {
    const at = new Date(row.at).toLocaleTimeString('pt-BR', { hour12: false });
    lines.push(`${at} | ${STATUSES[row.status] || row.status} | duração: ${duration(row.totalDurationMs)} | VPN: ${duration(row.vpnDurationMs)} | saldo: ${number(row.balanceMB)} MB | acumulado: ${number(row.accumulatedMB)} MB${row.reason ? ' | motivo: ' + clean(row.reason) : ''}${row.balanceError ? ' | falha no saldo: ' + clean(row.balanceError) : ''}`);
  }
  lines.push('', 'Casas:');
  const keys = new Set([...Object.keys(NAMES), ...rows.flatMap(row => Object.keys(row.houses || {}))]);
  for (const key of keys) {
    const reads = rows.flatMap(row => row.houses?.[key] ? [row.houses[key]] : []);
    const count = status => reads.filter(read => read.readingStatus === status).length;
    const measured = reads.filter(read => Number.isFinite(read.browserBytes));
    const mean = measured.length ? measured.reduce((sum, read) => sum + read.browserBytes, 0) / measured.length / 1000000 : null;
    const reasons = [...new Set(reads.filter(read => ['empty', 'timeout', 'failed'].includes(read.readingStatus))
      .flatMap(read => read.failureReasons?.length ? read.failureReasons.map(clean) : ['Motivo não registrado.']))];
    lines.push(`${NAMES[key] || key} | sucesso: ${count('success')} | vazia: ${count('empty')} | tempo esgotado: ${count('timeout')} | outras falhas: ${count('failed')} | média: ${number(mean)} MB/ciclo | motivos: ${reasons.join(' ; ') || 'nenhum registrado'}`);
  }
  const outputFile = path.join(LOG_DIR, `resumo-${today}.txt`);
  fs.writeFileSync(outputFile, lines.join('\n') + '\n', 'utf8');
  return outputFile;
}

module.exports = { failureReasons, generateSummary };
if (require.main === module) console.log(generateSummary());
