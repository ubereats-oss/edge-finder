const fs = require('fs');
const { createOddsApiClient, loadEnvFileIfPresent } = require('./odds_api_client');

loadEnvFileIfPresent();
let oddsApi;

async function getMlbOdds() {
  try {
    const url = 'https://api.the-odds-api.com/v4/sports/baseball_mlb/odds/';
    const response = await oddsApi.get(url, { params: { regions: 'eu', markets: 'h2h', oddsFormat: 'decimal' } });
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
      odds.push({
        team1: t1.name,
        team2: t2.name,
        odds1: t1.price,
        odds2: t2.price,
        commence_time: match.commence_time,
        event_id: match.id,
        bookmaker: bookmaker.key,
      });
    });
    fs.writeFileSync('mlb_odds.json', JSON.stringify(odds, null, 2));
    console.log(`MLB odds salvas: ${odds.length} partidas.`);
  } catch (err) {
    console.error('Erro ao buscar odds MLB:', err.response?.status, err.response?.data || err.message);
  }
}

try {
  oddsApi = createOddsApiClient({ label: 'MLB H2H' });
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
getMlbOdds();
