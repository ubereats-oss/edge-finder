const axios = require('axios');
const fs = require('fs');
const crypto = require('crypto');
const balanceSyncPromises = new Map();

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
  for (let i = 0; i <= 19; i++) {
    const key = i === 0 ? process.env.ODDS_API_KEY : process.env[`ODDS_API_KEY_${i}`];
    if (key && key.trim() && !keys.includes(key.trim())) keys.push(key.trim());
  }
  return keys;
}

function isQuotaError(error) {
  const status = error.response?.status;
  const msg = String(error.response?.data?.message || error.message || '').toLowerCase();
  return status === 429 || msg.includes('quota') || msg.includes('usage');
}

// Toda chamada real à The Odds API passa por aqui — é o único lugar que
// precisa bloquear execução fora do GitHub Actions (CI define GITHUB_ACTIONS
// automaticamente; local/dev não). Protege contra .env local com chaves
// reais sendo usado sem querer em teste ou verificação (já aconteceu).
// ALLOW_LIVE_ODDS_API=1 é a liberação explícita, só quando o usuário pedir
// uma chamada real na mensagem atual — nunca em teste/comparação automática.
function isRunningOutsideGithubActions() {
  return process.env.GITHUB_ACTIONS !== 'true';
}

function assertLiveCallAllowed(label) {
  if (!isRunningOutsideGithubActions()) return;
  if (process.env.ALLOW_LIVE_ODDS_API === '1') return;
  throw new Error(
    `[${label}] chamada real à The Odds API bloqueada — rodando fora do GitHub Actions ` +
    `(local, possivelmente com .env com chaves reais). Defina ALLOW_LIVE_ODDS_API=1 nesta ` +
    `execução se a chamada real for mesmo intencional. Nunca use isso em teste ou comparação ` +
    `automática — só quando o usuário pedir explicitamente na mensagem atual.`
  );
}

function createOddsApiClient({
  keys = defaultKeysFromEnv(),
  label = 'The Odds API',
  logger = console,
  startIndex = 0,
  onKeyUsed = null,
  disabled = process.env.ODDS_API_DISABLE === '1',
} = {}) {
  assertLiveCallAllowed(label);
  if (!keys.length) {
    throw new Error('Nenhuma chave THE_ODDS_API_KEYS ou ODDS_API_KEY configurada.');
  }
  if (disabled) {
    throw new Error(`[${label}] chamadas à The Odds API bloqueadas por ODDS_API_DISABLE=1.`);
  }

  const exhaustedKeys = new Set();
  let keyIndex = ((startIndex % keys.length) + keys.length) % keys.length;
  const usage = { creditsSpent: 0, calls: 0 };

  async function ensureBalanceSync(budget) {
    const fingerprintSet = keys.map(key => crypto.createHash('sha256').update(key).digest('hex')).sort().join(':');
    const syncKey = `${new Date().toISOString().slice(0, 7)}:${fingerprintSet}`;
    if (!balanceSyncPromises.has(syncKey)) {
      const syncPromise = budget.refreshBalances(keys);
      balanceSyncPromises.set(syncKey, syncPromise);
    }
    await balanceSyncPromises.get(syncKey);
  }

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
    const budget = require('./odds_api_monthly_budget');
    try { await ensureBalanceSync(budget); }
    catch (error) { logger.warn(`[${label}] saldo real indisponível; limite antigo aplicado: ${error.message}`); }

    while (exhaustedKeys.size < keys.length) {
      const reservation = await budget.reserve(url, options.params, label, keys, exhaustedKeys);
      const current = reservation
        ? { key: keys[reservation.keyIndex], index: reservation.keyIndex }
        : nextKey();
      if (!current) break;

      try {
        const res = await axios.get(url, {
          ...options,
          params: { ...(options.params || {}), apiKey: current.key },
        });

        const remaining = res.headers['x-requests-remaining'];
        const used = res.headers['x-requests-used'];
        const last = res.headers['x-requests-last'];
        if (reservation) await budget.reconcile(reservation, res.headers);
        else await budget.recordUnreservedResponse(current.key, current.index, res.headers);
        usage.creditsSpent += Number(last) || 0;
        usage.calls++;
        onKeyUsed?.({ index: current.index, remaining, used, last });
        if (remaining !== undefined || last !== undefined) {
          logger.log(`[${label}] chave ${current.index + 1}/${keys.length}: restantes=${remaining ?? 'n/d'}; custo_ultima_chamada=${last ?? 'n/d'}`);
        }
        return res;
      } catch (error) {
        if (reservation) {
          if (error.response?.headers?.['x-requests-remaining'] !== undefined) {
            await budget.reconcile(reservation, error.response.headers);
          } else if (isQuotaError(error)) {
            await budget.releaseQuotaRejected(reservation);
          }
        }
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
    usage: () => ({ ...usage }),
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
