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

const MARKETS = 'player_pass_yds,player_pass_tds,player_rush_yds,player_receptions,player_reception_yds';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchEvents() {
  const key = getNextValidKey();
  if (!key) throw new Error('Todas as chaves esgotadas.');
  const url = `https://api.the-odds-api.com/v4/sports/americanfootball_nfl/events?apiKey=${key}`;
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
        `https://api.the-odds-api.com/v4/sports/americanfootball_nfl/events/${eventId}/odds`,
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
      if (exhaustedKeys.size >= API_KEYS.length) {
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

getNflProps();
