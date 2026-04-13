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

async function getOdds() {
  let lastError = null;
  for (let i = 0; i < API_KEYS.length; i++) {
    try {
      const url = `https://api.the-odds-api.com/v4/sports/tennis_atp/odds/?apiKey=${API_KEYS[i]}&regions=eu&markets=h2h`;
      const response = await axios.get(url);
      const remaining = response.headers['x-requests-remaining'];
      if (remaining !== undefined) console.log(`Créditos restantes: ${remaining}`);
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
      fs.writeFileSync('odds.json', JSON.stringify(odds, null, 2));
      console.log('Odds salvas');
      return;
    } catch (err) {
      const msg = err.response?.data?.message || err.message || '';
      if (msg.toLowerCase().includes('quota')) {
        console.warn(`    Chave esgotada (${i + 1}/${API_KEYS.length}), tentando próxima...`);
        lastError = err;
        continue;
      }
      console.error('Erro ao buscar odds:', err.response?.status, err.response?.data || err.message);
      return;
    }
  }
  console.error('Erro ao buscar odds: todas as chaves esgotadas.', lastError?.response?.data || lastError?.message);
}

getOdds();