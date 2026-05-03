const axios = require('axios');
const fs = require('fs');

if (fs.existsSync('.env')) {
  for (const line of fs.readFileSync('.env', 'utf-8').split('\n')) {
    const [k, ...v] = line.split('=');
    if (k) process.env[k.trim()] = v.join('=').trim();
  }
}

const API_KEYS = [];
for (let i = 1; i <= 19; i++) {
  const key = i === 1 ? process.env.ODDS_API_KEY : process.env[`ODDS_API_KEY_${i}`];
  if (key && key.trim()) API_KEYS.push(key.trim());
}
if (!API_KEYS.length) { console.error('Nenhuma chave ODDS_API_KEY encontrada.'); process.exit(1); }

const exhaustedKeys = new Set();
let keyIndex = 0;

function getNextValidKey() {
  for (let i = 0; i < API_KEYS.length; i++) {
    const idx = (keyIndex + i) % API_KEYS.length;
    if (!exhaustedKeys.has(idx)) {
      keyIndex = (idx + 1) % API_KEYS.length;
      return API_KEYS[idx];
    }
  }
  return null;
}

function markCurrentKeyExhausted() {
  const idx = (keyIndex - 1 + API_KEYS.length) % API_KEYS.length;
  exhaustedKeys.add(idx);
}

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
    const names = m.participants.map(p => norm(p.name));
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
  const key = getNextValidKey();
  if (!key) throw new Error('Todas as chaves esgotadas.');
  const url = `https://api.the-odds-api.com/v4/sports/icehockey_nhl/events?apiKey=${key}`;
  const res = await axios.get(url);
  return res.data;
}

async function fetchEventProps(eventId) {
  let lastError = null;
  for (let attempt = 0; attempt < API_KEYS.length; attempt++) {
    const key = getNextValidKey();
    if (!key) break;
    try {
      const res = await axios.get(
        `https://api.the-odds-api.com/v4/sports/icehockey_nhl/events/${eventId}/odds`,
        { params: { apiKey: key, regions: 'us', markets: MARKETS, oddsFormat: 'decimal' } }
      );
      const remaining = res.headers['x-requests-remaining'];
      if (remaining !== undefined) console.log(`    Créditos restantes: ${remaining}`);
      return res.data;
    } catch (e) {
      const msg = e.response?.data?.message || e.message || '';
      if (msg.toLowerCase().includes('quota')) {
        markCurrentKeyExhausted();
        console.warn(`    Chave esgotada (${exhaustedKeys.size}/${API_KEYS.length}), tentando próxima...`);
        await sleep(300);
        lastError = e;
        continue;
      }
      throw e;
    }
  }
  throw lastError || new Error('Todas as chaves esgotadas para este evento.');
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

    for (const event of events) {
      if (exhaustedKeys.size >= API_KEYS.length) {
        console.error('Todas as chaves esgotadas — abortando.');
        break;
      }
      try {
        const data = await fetchEventProps(event.id);
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
            player_points:         'points',
            player_goals:          'goals',
            player_assists:        'assists',
            player_shots_on_goal:  'shots',
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
              pinnacleId: findMatchupId(pinnacleMatchups, event.home_team, event.away_team),
              pinnacleSlug: `${toSlug(event.away_team)}-vs-${toSlug(event.home_team)}`,
            });
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
  } catch (e) {
    console.error('Erro ao buscar props NHL:', e.response?.data || e.message);
  }
}

getNhlProps();
