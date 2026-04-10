const axios = require('axios');
const fs = require('fs');

const API_KEY = '1c578076d6dfa967d0369920e4c22969';

async function getMlbOdds() {
  const url = `https://api.the-odds-api.com/v4/sports/baseball_mlb/odds/?apiKey=${API_KEY}&regions=eu&markets=h2h&oddsFormat=decimal`;

  try {
    const response = await axios.get(url);
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
      });
    });

    fs.writeFileSync('mlb_odds.json', JSON.stringify(odds, null, 2));
    console.log(`MLB odds salvas: ${odds.length} partidas.`);
  } catch (err) {
    console.error('Erro ao buscar odds MLB:', err.response?.status, err.response?.data || err.message);
  }
}

getMlbOdds();
