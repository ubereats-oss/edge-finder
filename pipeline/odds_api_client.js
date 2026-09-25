const axios = require('axios');
const fs = require('fs');

function loadEnvFileIfPresent(envPath = '.env') {
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const [k, ...v] = line.split('=');
    if (k) process.env[k.trim()] = v.join('=').trim();
  }
}

function defaultKeysFromEnv() {
  const grouped = process.env.THE_ODDS_API_KEYS;
  if (grouped && grouped.trim()) {
    return grouped
      .split(/[\r\n,]+/)
      .map(key => key.trim())
      .filter(Boolean);
  }

  const keys = [];
  for (let i = 1; i <= 19; i++) {
    const key = i === 1 ? process.env.ODDS_API_KEY : process.env[`ODDS_API_KEY_${i}`];
    if (key && key.trim()) keys.push(key.trim());
  }
  return keys;
}

function isQuotaError(error) {
  const status = error.response?.status;
  const msg = String(error.response?.data?.message || error.message || '').toLowerCase();
  return status === 429 || msg.includes('quota') || msg.includes('usage');
}

function createOddsApiClient({
  keys = defaultKeysFromEnv(),
  label = 'The Odds API',
  logger = console,
  startIndex = 0,
  onKeyUsed = null,
  disabled = process.env.ODDS_API_DISABLE === '1',
} = {}) {
  if (!keys.length) {
    throw new Error('Nenhuma chave THE_ODDS_API_KEYS ou ODDS_API_KEY configurada.');
  }
  if (disabled) {
    throw new Error(`[${label}] chamadas à The Odds API bloqueadas por ODDS_API_DISABLE=1.`);
  }

  const exhaustedKeys = new Set();
  let keyIndex = ((startIndex % keys.length) + keys.length) % keys.length;

  function nextKey() {
    for (let i = 0; i < keys.length; i++) {
      const idx = (keyIndex + i) % keys.length;
      if (!exhaustedKeys.has(idx)) {
        keyIndex = (idx + 1) % keys.length;
        return { key: keys[idx], index: idx };
      }
    }
    return null;
  }

  async function get(url, options = {}) {
    let lastError = null;

    while (exhaustedKeys.size < keys.length) {
      const current = nextKey();
      if (!current) break;

      try {
        const res = await axios.get(url, {
          ...options,
          params: { ...(options.params || {}), apiKey: current.key },
        });

        const remaining = res.headers['x-requests-remaining'];
        const used = res.headers['x-requests-used'];
        const last = res.headers['x-requests-last'];
        onKeyUsed?.({ index: current.index, remaining, used, last });
        if (remaining !== undefined || last !== undefined) {
          logger.log(`[${label}] chave ${current.index + 1}/${keys.length}: restantes=${remaining ?? 'n/d'}; custo_ultima_chamada=${last ?? 'n/d'}`);
        }
        return res;
      } catch (error) {
        if (!isQuotaError(error)) throw error;
        lastError = error;
        exhaustedKeys.add(current.index);
        logger.warn(`[${label}] chave ${current.index + 1}/${keys.length} sem cota; tentando próxima chave disponível.`);
      }
    }

    throw new Error(`[${label}] todas as ${keys.length} chaves estão sem cota para esta execução.${lastError ? ` Último erro: ${lastError.response?.data?.message || lastError.message}` : ''}`);
  }

  return {
    get,
    keyCount: keys.length,
    exhaustedCount: () => exhaustedKeys.size,
    allExhausted: () => exhaustedKeys.size >= keys.length,
    currentIndex: () => keyIndex,
  };
}

module.exports = {
  createOddsApiClient,
  defaultKeysFromEnv,
  loadEnvFileIfPresent,
  isQuotaError,
};
