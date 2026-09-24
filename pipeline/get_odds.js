const fs = require('fs');
const { createOddsApiClient, loadEnvFileIfPresent } = require('./odds_api_client');

loadEnvFileIfPresent();
let oddsApi;

async function getActiveTennisSports() {
  const res = await oddsApi.get('https://api.the-odds-api.com/v4/sports');
  return res.data
    .filter(s => s.group === 'Tennis' && s.active)
    .map(s => s.key);
}

async function getOddsForSport(sportKey) {
  try {
    const url = `https://api.the-odds-api.com/v4/sports/${sportKey}/odds/`;
    const response = await oddsApi.get(url, { params: { regions: 'eu', markets: 'h2h' } });
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
    console.error(`  Erro ao buscar odds (${sportKey}):`, err.response?.status, err.response?.data || err.message);
    return [];
  }
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
    if (oddsApi.allExhausted()) {
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

try {
  oddsApi = createOddsApiClient({ label: 'tennis h2h' });
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
getOdds();
