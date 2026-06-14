const axios = require('axios');
const fs = require('fs');

if (fs.existsSync('.env')) {
  for (const line of fs.readFileSync('.env', 'utf-8').split('\n')) {
    const [k, ...v] = line.split('=');
    if (k) process.env[k.trim()] = v.join('=').trim();
  }
}

const API_KEYS = [];
for (let i = 1; i <= 19; i++) {
  const key = i === 1 ? process.env.ODDS_API_KEY : process.env[`ODDS_API_KEY_${i}`];
  if (key && key.trim()) API_KEYS.push(key.trim());
}
if (!API_KEYS.length) { console.error('Nenhuma chave ODDS_API_KEY encontrada.'); process.exit(1); }

const exhaustedKeys = new Set();
let keyIndex = 0;

function getNextValidKey() {
  for (let i = 0; i < API_KEYS.length; i++) {
    const idx = (keyIndex + i) % API_KEYS.length;
    if (!exhaustedKeys.has(idx)) {
      keyIndex = (idx + 1) % API_KEYS.length;
      return API_KEYS[idx];
    }
  }
  return null;
}

function markCurrentKeyExhausted() {
  const idx = (keyIndex - 1 + API_KEYS.length) % API_KEYS.length;
  exhaustedKeys.add(idx);
}

async function getActiveTennisSports() {
  for (let i = 0; i < API_KEYS.length; i++) {
    const key = getNextValidKey();
    if (!key) break;
    try {
      const res = await axios.get(`https://api.the-odds-api.com/v4/sports?apiKey=${key}`);
      return res.data
        .filter(s => s.group === 'Tennis' && s.active)
        .map(s => s.key);
    } catch (err) {
      const msg = err.response?.data?.message || err.message || '';
      if (msg.toLowerCase().includes('quota')) {
        markCurrentKeyExhausted();
        continue;
      }
      throw err;
    }
  }
  throw new Error('Não foi possível listar esportes ativos — chaves esgotadas.');
}

async function getOddsForSport(sportKey) {
  let lastError = null;
  for (let i = 0; i < API_KEYS.length; i++) {
    const key = getNextValidKey();
    if (!key) break;
    try {
      const url = `https://api.the-odds-api.com/v4/sports/${sportKey}/odds/?apiKey=${key}&regions=eu&markets=h2h`;
      const response = await axios.get(url);
      const remaining = response.headers['x-requests-remaining'];
      if (remaining !== undefined) console.log(`  Créditos restantes: ${remaining}`);

      const odds = [];
      response.data.forEach(match => {
        if (!match.bookmakers.length) return;
        const bookmaker = match.bookmakers[0];
        const market = bookmaker.markets.find(m => m.key === 'h2h');
        if (!market) return;
        const p1 = market.outcomes[0];
        const p2 = market.outcomes[1];
        odds.push({ player1: p1.name, player2: p2.name, odds1: p1.price, odds2: p2.price });
      });
      return odds;
    } catch (err) {
      const msg = err.response?.data?.message || err.message || '';
      if (msg.toLowerCase().includes('quota')) {
        markCurrentKeyExhausted();
        console.warn(`    Chave esgotada, tentando próxima...`);
        lastError = err;
        continue;
      }
      console.error(`  Erro ao buscar odds (${sportKey}):`, err.response?.status, err.response?.data || err.message);
      return [];
    }
  }
  console.error(`  Erro ao buscar odds (${sportKey}): todas as chaves esgotadas.`, lastError?.response?.data || lastError?.message);
  return [];
}

async function getOdds() {
  let tennisSports = [];
  try {
    tennisSports = await getActiveTennisSports();
  } catch (e) {
    console.error('Erro ao listar esportes de tênis ativos:', e.message);
    fs.writeFileSync('odds.json', JSON.stringify([], null, 2));
    return;
  }

  if (!tennisSports.length) {
    console.log('Nenhum torneio de tênis ativo no momento.');
    fs.writeFileSync('odds.json', JSON.stringify([], null, 2));
    return;
  }

  console.log(`Torneios de tênis ativos: ${tennisSports.join(', ')}`);

  const allOdds = [];
  for (const sportKey of tennisSports) {
    if (exhaustedKeys.size >= API_KEYS.length) {
      console.error('Todas as chaves esgotadas — abortando.');
      break;
    }
    const odds = await getOddsForSport(sportKey);
    console.log(`  ${sportKey}: ${odds.length} partidas`);
    allOdds.push(...odds);
  }

  fs.writeFileSync('odds.json', JSON.stringify(allOdds, null, 2));
  console.log(`Odds salvas: ${allOdds.length} partidas.`);
}

getOdds();
