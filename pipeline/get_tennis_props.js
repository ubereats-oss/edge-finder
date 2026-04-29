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

const MARKETS = 'player_sets_won,player_games_won';
const SPORTS  = ['tennis_atp', 'tennis_wta'];

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchEvents(sport) {
  const key = getNextValidKey();
  if (!key) throw new Error('Todas as chaves esgotadas.');
  const res = await axios.get(`https://api.the-odds-api.com/v4/sports/${sport}/events?apiKey=${key}`);
  return res.data;
}

async function fetchEventProps(sport, eventId) {
  let lastError = null;
  for (let attempt = 0; attempt < API_KEYS.length; attempt++) {
    const key = getNextValidKey();
    if (!key) break;
    try {
      const res = await axios.get(
        `https://api.the-odds-api.com/v4/sports/${sport}/events/${eventId}/odds`,
        { params: { apiKey: key, regions: 'eu', markets: MARKETS, oddsFormat: 'decimal' } }
      );
      return res.data;
    } catch (e) {
      const msg = e.response?.data?.message || e.message || '';
      if (msg.toLowerCase().includes('quota')) {
        markCurrentKeyExhausted();
        console.warn(`    Chave esgotada (${exhaustedKeys.size}/${API_KEYS.length})`);
        await sleep(300);
        lastError = e;
        continue;
      }
      throw e;
    }
  }
  throw lastError || new Error('Todas as chaves esgotadas.');
}

async function getTennisProps() {
  const allProps = [];

  for (const sport of SPORTS) {
    try {
      const events = await fetchEvents(sport);
      if (!events.length) { console.log(`Sem jogos ${sport}.`); continue; }
      console.log(`${sport}: ${events.length} jogos`);

      for (const event of events) {
        if (exhaustedKeys.size >= API_KEYS.length) {
          console.error('Todas as chaves esgotadas.');
          break;
        }
        try {
          const data = await fetchEventProps(sport, event.id);
          const bookmaker = data.bookmakers?.[0];
          if (!bookmaker) continue;

          for (const market of bookmaker.markets) {
            const propType = {
              player_sets_won:  'sets',
              player_games_won: 'games',
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
              allProps.push({
                game: `${event.home_team} x ${event.away_team}`,
                commence_time: event.commence_time,
                player,
                prop: propType,
                location: 'unknown',
                line: sides.Over.line,
                oddsOver: sides.Over.price,
                oddsUnder: sides.Under.price,
                tour: sport === 'tennis_atp' ? 'ATP' : 'WTA',
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

getTennisProps();
