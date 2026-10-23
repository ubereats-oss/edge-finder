const axios = require('axios');

const ROOT = 'https://api.arcadia.pinnacle.se/0.1';
const CONFIG = 'https://www.pinnacle.com/config/app.json';
const LEAGUES = {
  soccer_portugal_primeira_liga: 2386, soccer_epl: 1980,
  soccer_spain_la_liga: 2196, soccer_italy_serie_a: 2436,
  soccer_germany_bundesliga: 1842, soccer_uefa_champs_league: 2627,
  soccer_efl_champ: 1977, soccer_netherlands_eredivisie: 1928,
  soccer_france_ligue_one: 2036, soccer_uefa_europa_league: 2630,
  basketball_nba: 487, basketball_euroleague: 382,
  icehockey_nhl: 1456, americanfootball_nfl: 889,
  americanfootball_ncaaf: 880, baseball_mlb: 246,
  tennis_wta_ningbo_open: 227923, mma_mixed_martial_arts: 1624,
};

function decimal(american) {
  const value = Number(american);
  if (!Number.isFinite(value) || value === 0) return null;
  return value > 0 ? 1 + value / 100 : 1 + 100 / -value;
}

function adaptLeague(matchups, prices, sport, age, fetchedAt) {
  const updatedAt = new Date(Date.parse(fetchedAt) - age * 1000).toISOString();
  const byMatchup = new Map();
  for (const row of prices) {
    if (row.period !== 0 || row.status === 'closed' || !['moneyline', 'total', 'spread'].includes(row.type)) continue;
    if (!byMatchup.has(row.matchupId)) byMatchup.set(row.matchupId, []);
    byMatchup.get(row.matchupId).push(row);
  }
  const events = [];
  for (const game of matchups) {
    if (game.type !== 'matchup' || game.parentId || game.isLive || Date.parse(game.startTime) <= Date.parse(fetchedAt)) continue;
    const home = game.participants?.find(p => p.alignment === 'home')?.name;
    const away = game.participants?.find(p => p.alignment === 'away')?.name;
    if (!home || !away) continue;
    const markets = [];
    const rows = byMatchup.get(game.id) || [];
    const moneyline = rows.find(row => row.type === 'moneyline');
    if (moneyline) {
      const labels = [['home', home], ['draw', 'Draw'], ['away', away]];
      const outcomes = labels.flatMap(([designation, name]) => {
        const price = decimal(moneyline.prices?.find(p => p.designation === designation)?.price);
        return price ? [{ name, price }] : [];
      });
      if (outcomes.length === (sport.startsWith('soccer_') ? 3 : 2)) markets.push({ key: 'h2h', last_update: updatedAt, outcomes });
    }
    for (const [type, key] of [['total', 'totals'], ['spread', 'spreads']]) {
      const outcomes = [];
      for (const row of rows.filter(value => value.type === type)) {
        const sides = type === 'total' ? [['over', 'Over'], ['under', 'Under']] : [['home', home], ['away', away]];
        const pair = sides.map(([designation, name]) => {
          const raw = row.prices?.find(p => p.designation === designation);
          const price = decimal(raw?.price);
          return Number.isFinite(raw?.points) && price ? { name, point: raw.points, price } : null;
        });
        if (pair.every(Boolean)) outcomes.push(...pair);
      }
      if (outcomes.length) markets.push({ key, last_update: updatedAt, outcomes });
    }
    if (markets.length) events.push({ id: String(game.id), sport_key: sport,
      home_team: home, away_team: away, commence_time: game.startTime,
      bookmakers: [{ key: 'pinnacle', last_update: updatedAt, markets }],
      pinnacleSource: 'arcadia', pinnacleAgeSeconds: age });
  }
  return events;
}

function createArcadiaClient({ httpGet = axios.get, wait = ms => new Promise(resolve => setTimeout(resolve, ms)),
  now = Date.now, maxWaitMs = 7 * 60000, globalWaitMs = 7 * 60000 } = {}) {
  let apiKey;
  let keyPromise;
  let firstQueryAt;
  const usage = { queries: 0, freshResponses: 0, freshPairs: 0, fallbackUsed: 0, keyRefreshes: 0 };
  async function loadKey(force = false) {
    if (apiKey && !force) return;
    if (!keyPromise) keyPromise = (async () => {
      const response = await httpGet(CONFIG, { timeout: 15000, proxy: false });
      const value = response.data?.api?.haywire?.apiKey;
      if (typeof value !== 'string' || !/^[A-Za-z0-9]{32}$/.test(value)) throw new Error('Chave pública Arcadia indisponível no app.json.');
      apiKey = value;
    })().finally(() => { keyPromise = null; });
    await keyPromise;
  }
  async function request(path) {
    if (!apiKey) await loadKey();
    for (let attempt = 0; attempt < 2; attempt++) {
      usage.queries++;
      try {
        const response = await httpGet(`${ROOT}${path}`, { timeout: 15000, proxy: false,
          headers: { 'x-api-key': apiKey, Accept: 'application/json', 'User-Agent': 'Mozilla/5.0' } });
        const rawAge = response.headers?.age;
        const age = rawAge === undefined || rawAge === null || rawAge === '' ? null : Number(rawAge);
        const fresh = Number.isFinite(age) && age >= 0 && age < 120;
        if (fresh) usage.freshResponses++;
        return { data: response.data, age, fresh };
      } catch (error) {
        if (error.response?.status !== 403 || attempt) throw error;
        await loadKey(true);
        usage.keyRefreshes++;
        console.warn(`Arcadia: chave pública relida após HTTP 403 às ${new Date(now()).toISOString()}.`);
      }
    }
    throw new Error('Arcadia não respondeu após atualização da chave.');
  }
  async function fetchFresh(sport, { deadlineAt = Infinity } = {}) {
    const league = LEAGUES[sport];
    if (!league) return null;
    firstQueryAt ??= now();
    const deadline = Math.min(now() + maxWaitMs, firstQueryAt + globalWaitMs, deadlineAt);
    do {
      try {
        const [matchups, markets] = await Promise.all([
          request(`/leagues/${league}/matchups`), request(`/leagues/${league}/markets/straight`),
        ]);
        if (matchups.fresh && markets.fresh) {
          usage.freshPairs++;
          const capturedAt = new Date(now()).toISOString();
          return adaptLeague(matchups.data, markets.data, sport, Math.max(matchups.age, markets.age), capturedAt);
        }
      } catch (error) { console.warn(`Arcadia ${sport}: ${error.response?.status || error.code || error.message}`); }
      if (now() + 20000 > deadline) break;
      await wait(20000);
    } while (now() < deadline);
    return null;
  }
  return { fetchFresh, usage: () => ({ ...usage }), markFallback: () => { usage.fallbackUsed++; } };
}

module.exports = { createArcadiaClient, adaptLeague, decimal, LEAGUES };
