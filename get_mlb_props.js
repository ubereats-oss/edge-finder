const axios = require('axios');
const fs = require('fs');

const API_KEY = '1c578076d6dfa967d0369920e4c22969';
const MARKETS = 'batter_hits,batter_home_runs,pitcher_strikeouts,pitcher_hits_allowed';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchEvents() {
  const url = `https://api.the-odds-api.com/v4/sports/baseball_mlb/events?apiKey=${API_KEY}`;
  const res = await axios.get(url);
  return res.data;
}

async function fetchEventProps(eventId) {
  const url = `https://api.the-odds-api.com/v4/sports/baseball_mlb/events/${eventId}/odds?apiKey=${API_KEY}&regions=us&markets=${MARKETS}&oddsFormat=decimal`;
  const res = await axios.get(url);
  return res.data;
}

async function getMlbProps() {
  try {
    const events = await fetchEvents();

    if (!events.length) {
      console.log('Sem jogos MLB disponíveis.');
      fs.writeFileSync('mlb_props.json', JSON.stringify([], null, 2));
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
            batter_hits: 'hits',
            batter_home_runs: 'homeRuns',
            pitcher_strikeouts: 'strikeouts',
            pitcher_hits_allowed: 'hitsAllowed',
          }[market.key];

          if (!propType) continue;

          const isPitcher = market.key.startsWith('pitcher_');
          const players = {};

          for (const outcome of market.outcomes) {
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
              isPitcher,
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

    fs.writeFileSync('mlb_props.json', JSON.stringify(allProps, null, 2));
    console.log(`Props salvas: ${allProps.length} entradas.`);
  } catch (e) {
    console.error('Erro ao buscar props MLB:', e.response?.data || e.message);
  }
}

getMlbProps();
