const fs = require('fs');
const { createOddsApiClient, loadEnvFileIfPresent } = require('./odds_api_client');

loadEnvFileIfPresent();
let oddsApi;

const MARKETS = 'player_points,player_rebounds,player_assists,player_steals,player_threes';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchEvents() {
  const url = 'https://api.the-odds-api.com/v4/sports/basketball_nba/events';
  const res = await oddsApi.get(url);
  return res.data;
}

async function fetchEventProps(eventId) {
  const res = await oddsApi.get(
    `https://api.the-odds-api.com/v4/sports/basketball_nba/events/${eventId}/odds`,
    { params: { regions: 'us', markets: MARKETS, oddsFormat: 'decimal' } }
  );
  const remaining = res.headers['x-requests-remaining'];
  if (remaining !== undefined) console.log(`    Créditos restantes: ${remaining}`);
  return res.data;
}

async function getNbaProps() {
  let playerTeam = {};
  if (fs.existsSync('nba_player_team.json')) {
    playerTeam = JSON.parse(fs.readFileSync('nba_player_team.json'));
  } else {
    console.warn('nba_player_team.json não encontrado — location não será preenchido.');
  }

  try {
    const events = await fetchEvents();
    if (!events.length) {
      console.log('Sem jogos NBA disponíveis.');
      fs.writeFileSync('nba_props.json', JSON.stringify([], null, 2));
      return;
    }

    console.log(`Jogos encontrados: ${events.length}`);
    const allProps = [];

    for (const event of events) {
      if (oddsApi.allExhausted()) {
        console.error('Todas as chaves esgotadas — abortando.');
        break;
      }
      try {
        const data = await fetchEventProps(event.id);
        const bookmaker = data.bookmakers?.[0];
        if (!bookmaker) continue;

        for (const market of bookmaker.markets) {
          const propType = {
            player_points: 'points',
            player_rebounds: 'rebounds',
            player_assists: 'assists',
            player_steals: 'steals',
            player_threes: 'threes',
          }[market.key];
          if (!propType) continue;

          const players = {};
          for (const outcome of market.outcomes) {
            const player = outcome.description;
            if (!players[player]) players[player] = {};
            players[player][outcome.name] = { price: outcome.price, line: outcome.point };
          }

          for (const [player, sides] of Object.entries(players)) {
            if (!sides.Over || !sides.Under) continue;
            const team = playerTeam[player];
            let location = 'unknown';
            if (team) {
              if (team === event.home_team) location = 'home';
              else if (team === event.away_team) location = 'away';
            }
            allProps.push({
              eventId: event.id,
              game: `${event.home_team} x ${event.away_team}`,
              commence_time: event.commence_time,
              player,
              prop: propType,
              location,
              line: sides.Over.line,
              oddsOver: sides.Over.price,
              oddsUnder: sides.Under.price,
              bookmaker: bookmaker.key,
            });
          }
        }

        console.log(`  ${event.home_team} x ${event.away_team}: OK`);
        await sleep(300);
      } catch (e) {
        console.error(`  Erro no evento ${event.id}:`, e.response?.data?.message || e.message);
      }
    }

    fs.writeFileSync('nba_props.json', JSON.stringify(allProps, null, 2));
    console.log(`Props salvas: ${allProps.length} entradas.`);
  } catch (e) {
    console.error('Erro ao buscar props NBA:', e.response?.data || e.message);
  }
}

try {
  oddsApi = createOddsApiClient({ label: 'NBA props' });
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
getNbaProps();
