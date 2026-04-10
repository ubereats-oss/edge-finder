const axios = require('axios');
const fs = require('fs');

const API_KEY = '1c578076d6dfa967d0369920e4c22969';

async function getOdds() {
  const url = `https://api.the-odds-api.com/v4/sports/tennis_atp/odds/?apiKey=${API_KEY}&regions=eu&markets=h2h`;

  try {
    const response = await axios.get(url);

    const odds = [];

    response.data.forEach(match => {
      if (!match.bookmakers.length) return;

      const bookmaker = match.bookmakers[0];
      const market = bookmaker.markets.find(m => m.key === 'h2h');

      if (!market) return;

      const p1 = market.outcomes[0];
      const p2 = market.outcomes[1];

      odds.push({
        player1: p1.name,
        player2: p2.name,
        odds1: p1.price,
        odds2: p2.price
      });
    });

    fs.writeFileSync('odds.json', JSON.stringify(odds, null, 2));

    console.log('Odds salvas');
  } catch (err) {
    console.error('Erro ao buscar odds:', err.response?.status, err.response?.data || err.message);
  }
}

getOdds();
