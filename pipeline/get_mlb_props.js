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

const MARKETS = 'batter_hits,batter_home_runs,pitcher_strikeouts,pitcher_hits_allowed';
const BOOKMAKER = 'pinnacle';
const REGION = 'eu';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchEvents() {
  const key = getNextValidKey();
  if (!key) throw new Error('Todas as chaves esgotadas.');
  const url = `https://api.the-odds-api.com/v4/sports/baseball_mlb/events?apiKey=${key}`;
  const res = await axios.get(url);
  return res.data;
}

async function fetchEventProps(eventId) {
  const url = `https://api.the-odds-api.com/v4/sports/baseball_mlb/events/${eventId}/odds`;
  let lastError = null;
  for (let attempt = 0; attempt < API_KEYS.length; attempt++) {
    const key = getNextValidKey();
    if (!key) break;
    try {
      const res = await axios.get(url, {
        params: { apiKey: key, regions: REGION, markets: MARKETS, bookmakers: BOOKMAKER, oddsFormat: 'decimal' },
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
      throw e;
    }
  }
  throw lastError || new Error('Todas as chaves esgotadas para este evento.');
}

async function getMlbProps() {
  // Carrega mapeamento jogador -> time
  let playerTeam = {};
  if (fs.existsSync('mlb_player_team.json')) {
    const raw = fs.readFileSync('mlb_player_team.json', 'utf-8').trim();
    if (raw) playerTeam = JSON.parse(raw);
  } else {
    console.warn('mlb_player_team.json não encontrado — location não será preenchido.');
  }

  let pinnacleMatchups = [];
  try {
    pinnacleMatchups = await fetchPinnacleMatchups(246);
    console.log(`Pinnacle matchups MLB: ${pinnacleMatchups.length}`);
  } catch(e) {
    console.warn('Arcadia API indisponível — pinnacleId não será preenchido:', e.message);
  }

  try {
    const events = await fetchEvents();
    if (!events.length) {
      console.log('Sem jogos MLB disponíveis.');
      fs.writeFileSync('mlb_props.json', JSON.stringify([], null, 2));
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
        const bookmaker = data.bookmakers?.find(b => b.key === BOOKMAKER);
        if (!bookmaker) {
          console.log(`  ${event.home_team} x ${event.away_team}: Pinnacle sem dados`);
          await sleep(300);
          continue;
        }

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

            // Determina location
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
              isPitcher,
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
        const msg = e.response?.data?.message || e.message;
        console.error(`  Erro no evento ${event.id}:`, msg);
        await sleep(300);
      }
    }

    fs.writeFileSync('mlb_props.json', JSON.stringify(allProps, null, 2));
    console.log(`Props Pinnacle salvas: ${allProps.length} entradas.`);
  } catch (e) {
    console.error('Erro:', e.response?.data || e.message);
  }
}

getMlbProps();
