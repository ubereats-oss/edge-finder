const axios = require('axios');
const fs = require('fs');

const API_KEY = '1c578076d6dfa967d0369920e4c22969';
const MARKETS = 'player_points,player_rebounds,player_assists,player_steals,player_threes';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchEvents() {
  const url = `https://api.the-odds-api.com/v4/sports/basketball_nba/events?apiKey=${API_KEY}`;
  const res = await axios.get(url);
  return res.data;
}

async function fetchEventProps(eventId) {
  const url = `https://api.the-odds-api.com/v4/sports/basketball_nba/events/${eventId}/odds?apiKey=${API_KEY}&regions=us&markets=${MARKETS}&oddsFormat=decimal`;
  const res = await axios.get(url);
  return res.data;
}

async function getNbaProps() {
  // Carrega mapeamento jogador -> time
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

            // Determina location do jogador nesse jogo
            const team = playerTeam[player];
            let location = 'unknown';
            if (team) {
              if (team === event.home_team) location = 'home';
              else if (team === event.away_team) location = 'away';
            }

            allProps.push({
              game: `${event.home_team} x ${event.away_team}`,
              commence_time: event.commence_time,
              player,
              prop: propType,
              location,
              line: sides.Over.line,
              oddsOver: sides.Over.price,
              oddsUnder: sides.Under.price,
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

getNbaProps();
