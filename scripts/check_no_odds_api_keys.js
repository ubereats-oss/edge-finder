const { spawnSync } = require('child_process');

const keyPattern = /\b[0-9a-f]{32}\b/g;
const ignoredPathPatterns = [
  /^\.git\//,
  /^node_modules\//,
  /(^|\/)package-lock\.json$/,
];

function isIgnored(file) {
  return ignoredPathPatterns.some((pattern) => pattern.test(file));
}

const grep = spawnSync(
  'git',
  ['grep', '-I', '-n', '-E', '\\b[0-9a-f]{32}\\b', '--', '.'],
  { encoding: 'utf8', maxBuffer: 1024 * 1024 * 20 },
);

if (grep.status !== 0 && grep.status !== 1) {
  process.stderr.write(grep.stderr || 'git grep failed\n');
  process.exit(grep.status || 1);
}

const findings = [];

for (const line of grep.stdout.split(/\r?\n/)) {
  if (!line) continue;
  const match = line.match(/^([^:]+):(\d+):(.*)$/);
  if (!match) continue;
  const [, file, lineNumber, text] = match;
  if (isIgnored(file)) continue;
  const keys = [...text.matchAll(keyPattern)].map((item) => item[0]);
  for (const key of keys) {
    findings.push({ file, lineNumber, last4: key.slice(-4) });
  }
}

if (findings.length) {
  console.error('Possiveis chaves da The Odds API encontradas no repositorio:');
  for (const finding of findings) {
    console.error(`${finding.file}:${finding.lineNumber} final=${finding.last4}`);
  }
  process.exit(1);
}

console.log('Nenhuma sequencia com formato de chave da The Odds API encontrada.');
