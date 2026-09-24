const fs = require('fs');
const { createOddsApiClient, loadEnvFileIfPresent } = require('./odds_api_client');

loadEnvFileIfPresent();
let oddsApi;

const MARKETS = 'player_pass_yds,player_pass_tds,player_rush_yds,player_receptions,player_reception_yds';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchEvents() {
  const url = 'https://api.the-odds-api.com/v4/sports/americanfootball_nfl/events';
  const res = await oddsApi.get(url);
  return res.data;
}

async function fetchEventProps(eventId) {
  const res = await oddsApi.get(
    `https://api.the-odds-api.com/v4/sports/americanfootball_nfl/events/${eventId}/odds`,
    { params: { regions: 'us', markets: MARKETS, oddsFormat: 'decimal' } }
  );
  const remaining = res.headers['x-requests-remaining'];
  if (remaining !== undefined) console.log(`    Créditos restantes: ${remaining}`);
  return res.data;
}

async function getNflProps() {
  let playerTeam = {};
  if (fs.existsSync('nfl_player_team.json')) {
    playerTeam = JSON.parse(fs.readFileSync('nfl_player_team.json'));
  } else {
    console.warn('nfl_player_team.json não encontrado — location não será preenchido.');
  }

  try {
    const events = await fetchEvents();
    if (!events.length) {
      console.log('Sem jogos NFL disponíveis.');
      fs.writeFileSync('nfl_props.json', JSON.stringify([], null, 2));
      return;
    }

    console.log(`Jogos NFL encontrados: ${events.length}`);
    const allProps = [];
    let descartadosLinhaDivergente = 0;

    for (const event of events) {
      if (oddsApi.allExhausted()) {
        console.error('Todas as chaves esgotadas — abortando.');
        break;
      }
      try {
        const data = await fetchEventProps(event.id);
        if (!data.bookmakers?.length) continue;

        // Agrega a melhor odd por mercado, jogador e linha. Over e Under só formam
        // um prop quando pertencem à mesma linha; casas que cotam linhas diferentes
        // para o mesmo jogador geram props independentes, nunca misturados.
        const bestMarkets = {};
        for (const bm of data.bookmakers) {
          for (const mkt of (bm.markets ?? [])) {
            if (!bestMarkets[mkt.key]) bestMarkets[mkt.key] = { key: mkt.key, bestOutcomes: {} };
            for (const outcome of mkt.outcomes) {
              if (outcome.point === undefined || outcome.point === null) continue; // linha ausente
              const k = `${outcome.description}||${outcome.point}||${outcome.name}`;
              if (!bestMarkets[mkt.key].bestOutcomes[k] ||
                  outcome.price > bestMarkets[mkt.key].bestOutcomes[k].price) {
                bestMarkets[mkt.key].bestOutcomes[k] = { ...outcome, bookmaker: bm.key };
              }
            }
          }
        }

        for (const market of Object.values(bestMarkets)) {
          const propType = {
            player_pass_yds:      'passYards',
            player_pass_tds:      'passTDs',
            player_rush_yds:      'rushYards',
            player_receptions:    'receptions',
            player_reception_yds: 'receptionYards',
          }[market.key];
          if (!propType) continue;

          // jogador -> linha -> { Over, Under }
          const playerLines = {};
          for (const outcome of Object.values(market.bestOutcomes)) {
            const player = outcome.description;
            if (!playerLines[player]) playerLines[player] = {};
            if (!playerLines[player][outcome.point]) playerLines[player][outcome.point] = {};
            playerLines[player][outcome.point][outcome.name] = { price: outcome.price, line: outcome.point, bookmaker: outcome.bookmaker };
          }

          for (const [player, lines] of Object.entries(playerLines)) {
            for (const sides of Object.values(lines)) {
              if (!sides.Over || !sides.Under) { descartadosLinhaDivergente++; continue; }
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
                bookmakerOver: sides.Over.bookmaker,
                bookmakerUnder: sides.Under.bookmaker,
              });
            }
          }
        }

        console.log(`  ${event.home_team} x ${event.away_team}: OK`);
        await sleep(300);
      } catch (e) {
        console.error(`  Erro no evento ${event.id}:`, e.response?.data?.message || e.message);
      }
    }

    fs.writeFileSync('nfl_props.json', JSON.stringify(allProps, null, 2));
    console.log(`Props NFL salvas: ${allProps.length} entradas.`);
    console.log(`Descartados por divergência de linha (NFL): ${descartadosLinhaDivergente}`);
  } catch (e) {
    console.error('Erro ao buscar props NFL:', e.response?.data || e.message);
  }
}

try {
  oddsApi = createOddsApiClient({ label: 'NFL props' });
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
getNflProps();
