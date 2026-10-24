const { spawnSync } = require('node:child_process');

const keyPattern = /\b[0-9a-f]{32}\b/gi;
// ID Pinnacle comprovado no diagnóstico Lincoln/Burnley e no fixture histórico.
// Exceção por valor E contexto; nenhum arquivo ou campo id é liberado em geral.
const confirmedPinnacleEventId = ['35338730', 'dd2de8ae', '05fc62d9', 'd314e05b'].join('');
const ignoredPathPatterns = [/^\.git\//, /^node_modules\//, /(^|\/)package-lock\.json$/];

function configuredKeys(env = process.env) {
  const keys = new Set();
  for (const [name, value] of Object.entries(env)) {
    if (!/^(?:THE_ODDS_API_KEYS|ODDS_API_KEYS|ODDS_API_KEY(?:_\d+)?)$/.test(name)) continue;
    for (const match of String(value || '').matchAll(keyPattern)) keys.add(match[0].toLowerCase());
  }
  return keys;
}
function isConfirmedEvent(file, text, match) {
  if (match[0].toLowerCase() !== confirmedPinnacleEventId) return false;
  const before = text.slice(0, match.index), after = text.slice(match.index + match[0].length);
  if (file === 'LOG_ATIVIDADES.md') {
    return /\bevento\s+$/.test(before) && /^\./.test(after)
      && before.includes('Pinnacle Over 1,92 e Under 1,97');
  }
  return file === 'pipeline/test_market_integrity.cjs'
    && /^\s*const event = \{ id:\s*['"]$/.test(before)
    && /^['"],\s*sport_key:\s*['"]soccer_efl_champ['"],?\s*$/.test(after);
}
function findFindings(lines, credentials = configuredKeys()) {
  const findings = [];
  for (const line of lines) {
    const parsed = line.match(/^([^:]+):(\d+):(.*)$/);
    if (!parsed) continue;
    const [, file, lineNumber, text] = parsed;
    if (ignoredPathPatterns.some(pattern => pattern.test(file))) continue;
    for (const match of text.matchAll(keyPattern)) {
      if (!credentials.has(match[0].toLowerCase()) && isConfirmedEvent(file, text, match)) continue;
      findings.push({ file, lineNumber, last4: match[0].slice(-4) });
    }
  }
  return findings;
}
function main() {
  const grep = spawnSync('git', ['grep', '-I', '-n', '-i', '-E', '\\b[0-9a-f]{32}\\b', '--', '.'],
    { encoding: 'utf8', maxBuffer: 1024 * 1024 * 20 });
  if (grep.status !== 0 && grep.status !== 1) {
    process.stderr.write(grep.stderr || 'git grep failed\n');
    return grep.status || 1;
  }
  const findings = findFindings(grep.stdout.split(/\r?\n/));
  if (findings.length) {
    console.error('Possiveis chaves da The Odds API encontradas no repositorio:');
    for (const finding of findings) console.error(`${finding.file}:${finding.lineNumber} final=${finding.last4}`);
    return 1;
  }
  console.log('Nenhuma chave suspeita encontrada; IDs Pinnacle confirmados aceitos somente em seus contextos de evento.');
  return 0;
}
module.exports = { configuredKeys, findFindings, confirmedPinnacleEventId };
if (require.main === module) process.exitCode = main();
