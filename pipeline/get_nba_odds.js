const fs = require('fs');
const { createOddsApiClient, loadEnvFileIfPresent } = require('./odds_api_client');

loadEnvFileIfPresent();
let oddsApi;

async function getNbaOdds() {
  try {
    const url = 'https://api.the-odds-api.com/v4/sports/basketball_nba/odds/';
    const response = await oddsApi.get(url, { params: { regions: 'eu', markets: 'h2h' } });
    const remaining = response.headers['x-requests-remaining'];
    if (remaining !== undefined) console.log(`Créditos restantes: ${remaining}`);
    const odds = [];
    response.data.forEach(match => {
      if (!match.bookmakers.length) return;
      const bookmaker = match.bookmakers[0];
      const market = bookmaker.markets.find(m => m.key === 'h2h');
      if (!market) return;
      const t1 = market.outcomes[0];
      const t2 = market.outcomes[1];
      odds.push({ team1: t1.name, team2: t2.name, odds1: t1.price, odds2: t2.price, commence_time: match.commence_time });
    });
    if (!odds.length) {
  console.warn('Sem jogos válidos — salvando array vazio.');
}

const tempFile = 'nba_odds_tmp.json';

fs.writeFileSync(tempFile, JSON.stringify(odds, null, 2));

const check = fs.readFileSync(tempFile, 'utf-8').trim();

if (!check) {
  console.error('Erro: arquivo gerado vazio — abortando.');
  process.exit(1);
}

JSON.parse(check);

fs.renameSync(tempFile, 'nba_odds.json');

console.log(`NBA odds salvas: ${odds.length} partidas.`);
  } catch (err) {
    console.error('Erro ao buscar odds NBA:', err.response?.status, err.response?.data || err.message);
  }
}

try {
  oddsApi = createOddsApiClient({ label: 'NBA H2H' });
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
getNbaOdds();
