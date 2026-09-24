const fs = require('fs');
const { createOddsApiClient, loadEnvFileIfPresent } = require('./odds_api_client');

loadEnvFileIfPresent();
let oddsApi;

const MARKETS = 'player_sets_won,player_games_won';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function getActiveTennisSports() {
  const res = await oddsApi.get('https://api.the-odds-api.com/v4/sports');
  return res.data
    .filter(s => s.group === 'Tennis' && s.active)
    .map(s => ({ key: s.key, tour: s.key.startsWith('tennis_wta') ? 'WTA' : 'ATP' }));
}

async function fetchEvents(sport) {
  const res = await oddsApi.get(`https://api.the-odds-api.com/v4/sports/${sport}/events`);
  return res.data;
}

async function fetchEventProps(sport, eventId) {
  const res = await oddsApi.get(
    `https://api.the-odds-api.com/v4/sports/${sport}/events/${eventId}/odds`,
    { params: { regions: 'eu', markets: MARKETS, oddsFormat: 'decimal' } }
  );
  return res.data;
}

async function getTennisProps() {
  const allProps = [];

  let sports = [];
  try {
    sports = await getActiveTennisSports();
  } catch (e) {
    console.error('Erro ao listar esportes de tênis ativos:', e.message);
    fs.writeFileSync('tennis_props.json', JSON.stringify([], null, 2));
    return;
  }

  if (!sports.length) {
    console.log('Nenhum torneio de tênis ativo no momento.');
    fs.writeFileSync('tennis_props.json', JSON.stringify([], null, 2));
    return;
  }

  console.log(`Torneios de tênis ativos: ${sports.map(s => s.key).join(', ')}`);

  for (const { key: sport, tour } of sports) {
    try {
      const events = await fetchEvents(sport);
      if (!events.length) { console.log(`Sem jogos ${sport}.`); continue; }
      console.log(`${sport}: ${events.length} jogos`);

      for (const event of events) {
        if (oddsApi.allExhausted()) {
          console.error('Todas as chaves esgotadas.');
          break;
        }
        try {
          const data = await fetchEventProps(sport, event.id);
          if (!data.bookmakers?.length) continue;

          // Agrega a melhor odd Over e Under por mercado entre todas as casas disponíveis
          const bestMarkets = {};
          for (const bm of data.bookmakers) {
            for (const mkt of (bm.markets ?? [])) {
              if (!bestMarkets[mkt.key]) bestMarkets[mkt.key] = { key: mkt.key, bestOutcomes: {} };
              for (const outcome of mkt.outcomes) {
                const k = `${outcome.description}||${outcome.name}`;
                if (!bestMarkets[mkt.key].bestOutcomes[k] ||
                    outcome.price > bestMarkets[mkt.key].bestOutcomes[k].price) {
                  bestMarkets[mkt.key].bestOutcomes[k] = outcome;
                }
              }
            }
          }

          for (const market of Object.values(bestMarkets)) {
            const propType = {
              player_sets_won:  'sets',
              player_games_won: 'games',
            }[market.key];
            if (!propType) continue;

            const players = {};
            for (const outcome of Object.values(market.bestOutcomes)) {
              const player = outcome.description;
              if (!players[player]) players[player] = {};
              players[player][outcome.name] = { price: outcome.price, line: outcome.point };
            }

            for (const [player, sides] of Object.entries(players)) {
              if (!sides.Over || !sides.Under) continue;
              allProps.push({
                game: `${event.home_team} x ${event.away_team}`,
                commence_time: event.commence_time,
                player,
                prop: propType,
                location: 'unknown',
                line: sides.Over.line,
                oddsOver: sides.Over.price,
                oddsUnder: sides.Under.price,
                tour,
              });
            }
          }
          await sleep(300);
        } catch (e) {
          console.error(`  Erro evento ${event.id}:`, e.response?.data?.message || e.message);
        }
      }
    } catch (e) {
      console.error(`Erro ${sport}:`, e.message);
    }
  }

  fs.writeFileSync('tennis_props.json', JSON.stringify(allProps, null, 2));
  console.log(`Props tênis salvas: ${allProps.length} entradas.`);
}

try {
  oddsApi = createOddsApiClient({ label: 'tennis props' });
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
getTennisProps();
