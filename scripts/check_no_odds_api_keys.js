const { spawnSync } = require('node:child_process');
const fs = require('node:fs');

const keyPattern = /\b[0-9a-f]{32}\b/gi;
// ID Pinnacle comprovado no diagnóstico Lincoln/Burnley e no fixture histórico.
// Exceção por valor E contexto; nenhum arquivo ou campo id é liberado em geral.
const confirmedPinnacleEventId = ['35338730', 'dd2de8ae', '05fc62d9', 'd314e05b'].join('');
const confirmedBenficaEventId = ['cdf1a22c', 'e6d16f09', '03216518', 'd909e02a'].join('');
const realFixturePath = 'pipeline/fixtures/integrity_positive_only_real_20261104.json';
const ignoredPathPatterns = [/^\.git\//, /^node_modules\//, /(^|\/)package-lock\.json$/];

function confirmedFixtureLines(source) {
  const lines = new Map();
  let data;
  try { data = JSON.parse(source); } catch { return lines; }
  const cases = [
    ['benfica', confirmedBenficaEventId, 'soccer_portugal_primeira_liga', 'Benfica', 'Alverca', '2026-11-02T20:15:00Z'],
    ['lincoln', confirmedPinnacleEventId, 'soccer_efl_champ', 'Lincoln City', 'Burnley', '2026-10-24T14:00:00Z'],
  ];
  for (const [name, id, sport, home, away, start] of cases) {
    const event = data?.[name]?.event;
    if (event?.id !== id || event.sport_key !== sport || event.home_team !== home
        || event.away_team !== away || event.commence_time !== start) continue;
    // A segunda ocorrência do valor torna o contexto ambíguo: bloquear ambas.
    if (source.indexOf(id) !== source.lastIndexOf(id)) continue;
    const index = source.indexOf(id);
    const lineNumber = source.slice(0, index).split('\n').length;
    const text = source.split('\n')[lineNumber - 1].replace(/\r$/, '');
    if (text.trim() === `"id": "${id}",`) lines.set(String(lineNumber), text);
  }
  return lines;
}

function configuredKeys(env = process.env) {
  const keys = new Set();
  for (const [name, value] of Object.entries(env)) {
    if (!/^(?:THE_ODDS_API_KEYS|ODDS_API_KEYS|ODDS_API_KEY(?:_\d+)?)$/.test(name)) continue;
    for (const match of String(value || '').matchAll(keyPattern)) keys.add(match[0].toLowerCase());
  }
  return keys;
}
function isConfirmedEvent(file, text, match) {
  const before = text.slice(0, match.index), after = text.slice(match.index + match[0].length);
  if (match[0].toLowerCase() === confirmedBenficaEventId) {
    return file === 'LOG_ATIVIDADES.md'
      && before.startsWith('- Registro principal: _bookmaker_reads/local-betano-1793616667401-859, comparação ')
      && before.endsWith('Benfica sourceEventId94732376, Pinnacle ')
      && after.startsWith('; horário de início das duas fontes coincide em2026-11-02T20:15:00Z.');
  }
  if (match[0].toLowerCase() !== confirmedPinnacleEventId) return false;
  if (file === 'LOG_ATIVIDADES.md') {
    return /\bevento\s+$/.test(before) && /^\./.test(after)
      && before.includes('Pinnacle Over 1,92 e Under 1,97');
  }
  return file === 'pipeline/test_market_integrity.cjs'
    && /^\s*const event = \{ id:\s*['"]$/.test(before)
    && /^['"],\s*sport_key:\s*['"]soccer_efl_champ['"],?\s*$/.test(after);
}
function findFindings(lines, credentials = configuredKeys(), fixtureLines = new Map()) {
  const findings = [];
  for (const line of lines) {
    const parsed = line.match(/^([^:]+):(\d+):(.*)$/);
    if (!parsed) continue;
    const [, file, lineNumber, text] = parsed;
    if (ignoredPathPatterns.some(pattern => pattern.test(file))) continue;
    for (const match of text.matchAll(keyPattern)) {
      const confirmedFixture = file === realFixturePath && fixtureLines.get(lineNumber) === text;
      if (!credentials.has(match[0].toLowerCase())
          && (confirmedFixture || isConfirmedEvent(file, text, match))) continue;
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
  const fixtureLines = fs.existsSync(realFixturePath)
    ? confirmedFixtureLines(fs.readFileSync(realFixturePath, 'utf8')) : new Map();
  const findings = findFindings(grep.stdout.split(/\r?\n/), configuredKeys(), fixtureLines);
  if (findings.length) {
    console.error('Possiveis chaves da The Odds API encontradas no repositorio:');
    for (const finding of findings) console.error(`${finding.file}:${finding.lineNumber} final=${finding.last4}`);
    return 1;
  }
  console.log('Nenhuma chave suspeita encontrada; IDs Pinnacle confirmados aceitos somente em seus contextos de evento.');
  return 0;
}
module.exports = { configuredKeys, findFindings, confirmedPinnacleEventId,
  confirmedBenficaEventId, confirmedFixtureLines, realFixturePath };
if (require.main === module) process.exitCode = main();
