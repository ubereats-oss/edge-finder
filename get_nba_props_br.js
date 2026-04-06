const axios = require('axios');
const fs = require('fs');

for (const line of fs.readFileSync('.env', 'utf-8').split('\n')) {
  const [k, ...v] = line.split('=');
  if (k) process.env[k.trim()] = v.join('=').trim();
}

// Carrega todas as chaves disponíveis
const API_KEYS = [];
for (let i = 1; i <= 12; i++) {
  const key = i === 1
    ? process.env.ODDS_API_KEY
    : process.env[`ODDS_API_KEY_${i}`];
  if (key && key.trim()) API_KEYS.push(key.trim());
}
if (!API_KEYS.length) { console.error('Nenhuma chave ODDS_API_KEY encontrada.'); process.exit(1); }

// Rastreia chaves esgotadas
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
  return null; // todas esgotadas
}

function markCurrentKeyExhausted() {
  const idx = (keyIndex - 1 + API_KEYS.length) % API_KEYS.length;
  exhaustedKeys.add(idx);
}

const MARKETS = 'player_points,player_rebounds,player_assists,player_steals,player_threes';
const BOOKMAKER = 'pinnacle';
const REGION = 'eu';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchEvents() {
  const key = getNextValidKey();
  if (!key) throw new Error('Todas as chaves esgotadas.');
  const url = `https://api.the-odds-api.com/v4/sports/basketball_nba/events?apiKey=${key}`;
  const res = await axios.get(url);
  return res.data;
}

// Tenta buscar props tentando todas as chaves válidas antes de desistir
async function fetchEventProps(eventId) {
  const url = `https://api.the-odds-api.com/v4/sports/basketball_nba/events/${eventId}/odds`;
  let lastError = null;

  for (let attempt = 0; attempt < API_KEYS.length; attempt++) {
    const key = getNextValidKey();
    if (!key) break;

    try {
      const res = await axios.get(url, {
        params: {
          apiKey: key,
          regions: REGION,
          markets: MARKETS,
          bookmakers: BOOKMAKER,
          oddsFormat: 'decimal',
        },
      });
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
      throw e; // erro que não é quota — propaga
    }
  }

  throw lastError || new Error('Todas as chaves esgotadas para este evento.');
}

function parseBookmakerProps(data, event, playerTeam, allProps) {
  const bookmaker = data.bookmakers?.find(b => b.key === BOOKMAKER);
  if (!bookmaker) return false;

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
  return true;
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
      fs.writeFileSync('nba_props_pinnacle.json', JSON.stringify([], null, 2));
      return;
    }

    console.log(`Jogos encontrados: ${events.length} | Chaves disponíveis: ${API_KEYS.length}`);
    const allProps = [];

    for (const event of events) {
      if (exhaustedKeys.size >= API_KEYS.length) {
        console.error('Todas as chaves esgotadas — abortando.');
        break;
      }

      try {
        const data = await fetchEventProps(event.id);
        const found = parseBookmakerProps(data, event, playerTeam, allProps);
        if (!found) {
          console.log(`  ${event.home_team} x ${event.away_team}: Pinnacle sem dados`);
        } else {
          console.log(`  ${event.home_team} x ${event.away_team}: OK`);
        }
        await sleep(300);
      } catch (e) {
        const msg = e.response?.data?.message || e.message;
        console.error(`  Erro no evento ${event.id}:`, msg);
        await sleep(300);
      }
    }

    fs.writeFileSync('nba_props_pinnacle.json', JSON.stringify(allProps, null, 2));
    console.log(`Props Pinnacle salvas: ${allProps.length} entradas.`);
  } catch (e) {
    console.error('Erro:', e.response?.data || e.message);
  }
}

getNbaProps();
