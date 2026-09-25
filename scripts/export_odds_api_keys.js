const fs = require('fs');

function parseKeys(raw) {
  return String(raw || '')
    .split(/[\r\n,]+/)
    .map((key) => key.trim())
    .filter(Boolean);
}

const keys = parseKeys(process.env.THE_ODDS_API_KEYS);
const fallbackKeys = parseKeys(process.env.ODDS_API_KEYS);
const selectedKeys = keys.length ? keys : fallbackKeys;

if (!selectedKeys.length) {
  throw new Error(
    'Nenhuma chave configurada. Defina THE_ODDS_API_KEYS ou ODDS_API_KEYS.',
  );
}

for (const key of selectedKeys) {
  if (process.env.GITHUB_ACTIONS === 'true') {
    console.log(`::add-mask::${key}`);
  }
}

const lines = selectedKeys.map((key, index) => {
  const name = index === 0 ? 'ODDS_API_KEY' : `ODDS_API_KEY_${index + 1}`;
  return `${name}=${key}`;
});

fs.appendFileSync(process.env.GITHUB_ENV, `${lines.join('\n')}\n`);
console.log(`Chaves da The Odds API injetadas: ${selectedKeys.length}`);
if (!keys.length && fallbackKeys.length) {
  console.log('Usando fallback temporário ODDS_API_KEYS.');
}
