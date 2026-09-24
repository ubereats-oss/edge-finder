const axios = require('axios');
const fs = require('fs');
const { createOddsApiClient, loadEnvFileIfPresent } = require('./odds_api_client');

loadEnvFileIfPresent();
let oddsApi;

const ARCADIA_KEY = 'CmX2KcMrXuFmNg6YFbmTxE0y9CblvR';

async function fetchPinnacleMatchups(leagueId) {
  const url = `https://guest.api.arcadia.pinnacle.com/0.1/leagues/${leagueId}/matchups`;
  const res = await axios.get(url, {
    headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json', 'x-api-key': ARCADIA_KEY }
  });
  return res.data.filter(m => m.participants?.length === 2);
}

function findMatchupId(matchups, homeTeam, awayTeam) {
  const norm = s => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  for (const m of matchups) {
    if (!m.participants || m.participants.length !== 2) continue;
    const names = m.participants.map(p => norm(p.name));
    if (names.includes('over') || names.includes('under')) continue;
    if (names.some(n => norm(homeTeam).includes(n.slice(0,6)) || n.includes(norm(homeTeam).slice(0,6))) &&
        names.some(n => norm(awayTeam).includes(n.slice(0,6)) || n.includes(norm(awayTeam).slice(0,6)))) {
      return m.id;
    }
  }
  return null;
}

function toSlug(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

const MARKETS = 'player_points,player_goals,player_assists,player_shots_on_goal';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchEvents() {
  const url = 'https://api.the-odds-api.com/v4/sports/icehockey_nhl/events';
  const res = await oddsApi.get(url);
  return res.data;
}

async function fetchEventProps(eventId) {
  const res = await oddsApi.get(
    `https://api.the-odds-api.com/v4/sports/icehockey_nhl/events/${eventId}/odds`,
    { params: { regions: 'us', markets: MARKETS, oddsFormat: 'decimal' } }
  );
  const remaining = res.headers['x-requests-remaining'];
  if (remaining !== undefined) console.log(`    Créditos restantes: ${remaining}`);
  return res.data;
}

async function getNhlProps() {
  let playerTeam = {};
  if (fs.existsSync('nhl_player_team.json')) {
    playerTeam = JSON.parse(fs.readFileSync('nhl_player_team.json'));
  } else {
    console.warn('nhl_player_team.json não encontrado — location não será preenchido.');
  }

  let pinnacleMatchups = [];
  try {
    pinnacleMatchups = await fetchPinnacleMatchups(1456);
    console.log(`Pinnacle matchups NHL: ${pinnacleMatchups.length}`);
  } catch(e) {
    console.warn('Arcadia API indisponível — pinnacleId não será preenchido:', e.message);
  }

  try {
    const events = await fetchEvents();
    if (!events.length) {
      console.log('Sem jogos NHL disponíveis.');
      fs.writeFileSync('nhl_props.json', JSON.stringify([], null, 2));
      return;
    }

    console.log(`Jogos NHL encontrados: ${events.length}`);
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
            player_points:         'points',
            player_goals:          'goals',
            player_assists:        'assists',
            player_shots_on_goal:  'shots',
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
                pinnacleId: findMatchupId(pinnacleMatchups, event.home_team, event.away_team),
                pinnacleSlug: `${toSlug(event.away_team)}-vs-${toSlug(event.home_team)}`,
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

    fs.writeFileSync('nhl_props.json', JSON.stringify(allProps, null, 2));
    console.log(`Props NHL salvas: ${allProps.length} entradas.`);
    console.log(`Descartados por divergência de linha (NHL): ${descartadosLinhaDivergente}`);
  } catch (e) {
    console.error('Erro ao buscar props NHL:', e.response?.data || e.message);
  }
}

try {
  oddsApi = createOddsApiClient({ label: 'NHL props' });
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
getNhlProps();
