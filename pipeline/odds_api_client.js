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

function intFromEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function createOddsApiClient({
  keys = defaultKeysFromEnv(),
  label = 'The Odds API',
  logger = console,
  startIndex = 0,
  onKeyUsed = null,
  minRemaining = intFromEnv('ODDS_API_MIN_REMAINING', 0),
  maxCalls = intFromEnv('ODDS_API_MAX_CALLS', 0),
  disabled = process.env.ODDS_API_DISABLE === '1',
} = {}) {
  if (!keys.length) {
    throw new Error('Nenhuma chave ODDS_API_KEY configurada.');
  }
  if (disabled) {
    throw new Error(`[${label}] chamadas à The Odds API bloqueadas por ODDS_API_DISABLE=1.`);
  }

  const exhaustedKeys = new Set();
  const reservedKeys = new Set();
  let keyIndex = ((startIndex % keys.length) + keys.length) % keys.length;
  let callCount = 0;

  function nextKey() {
    for (let i = 0; i < keys.length; i++) {
      const idx = (keyIndex + i) % keys.length;
      if (!exhaustedKeys.has(idx) && !reservedKeys.has(idx)) {
        keyIndex = (idx + 1) % keys.length;
        return { key: keys[idx], index: idx };
      }
    }
    return null;
  }

  async function get(url, options = {}) {
    let lastError = null;

    if (maxCalls > 0 && callCount >= maxCalls) {
      throw new Error(`[${label}] chamada pulada por limite operacional de ${maxCalls} chamada(s) nesta execução para preservar cota.`);
    }

    while (exhaustedKeys.size < keys.length) {
      const current = nextKey();
      if (!current) break;

      try {
        const res = await axios.get(url, {
          ...options,
          params: { ...(options.params || {}), apiKey: current.key },
        });
        callCount++;

        const remaining = res.headers['x-requests-remaining'];
        const used = res.headers['x-requests-used'];
        const last = res.headers['x-requests-last'];
        onKeyUsed?.({ index: current.index, remaining, used, last });
        if (remaining !== undefined || last !== undefined) {
          logger.log(`[${label}] chave ${current.index + 1}/${keys.length}: restantes=${remaining ?? 'n/d'}; custo_ultima_chamada=${last ?? 'n/d'}`);
        }
        const remainingInt = parseInt(remaining ?? '', 10);
        if (Number.isFinite(remainingInt) && remainingInt <= minRemaining) {
          reservedKeys.add(current.index);
          logger.warn(`[${label}] chave ${current.index + 1}/${keys.length} em reserva (${remainingInt} créditos restantes <= ${minRemaining}); próximas chamadas com essa chave serão puladas.`);
        }
        return res;
      } catch (error) {
        if (!isQuotaError(error)) throw error;
        lastError = error;
        exhaustedKeys.add(current.index);
        logger.warn(`[${label}] chave ${current.index + 1}/${keys.length} sem cota; tentando próxima chave disponível.`);
      }
    }

    if (reservedKeys.size > 0 && exhaustedKeys.size + reservedKeys.size >= keys.length) {
      throw new Error(`[${label}] chamada pulada por falta de cota acima da reserva (${minRemaining}). Chaves reservadas: ${reservedKeys.size}; esgotadas: ${exhaustedKeys.size}.`);
    }
    throw new Error(`[${label}] todas as ${keys.length} chaves estão sem cota para esta execução.${lastError ? ` Último erro: ${lastError.response?.data?.message || lastError.message}` : ''}`);
  }

  return {
    get,
    keyCount: keys.length,
    exhaustedCount: () => exhaustedKeys.size,
    reservedCount: () => reservedKeys.size,
    callCount: () => callCount,
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
