const fs    = require('fs');
const path  = require('path');
const axios = require('axios');

// ── Chaves com rotação automática ─────────────────────────────────────────────
const API_KEYS = [
  '1c578076d6dfa967d0369920e4c22969',
  'cdea0b39024b47310a32dab1dfb308a8',
  '438ae5826b683c3251a3adee591e19f5',
  'abce8a042af4f25fd795835932746518',
  '0c92529a8b4493260dded91f83008547',
  'bf93bfd15042771f6b4b919f1c40a0ac',
  'a23686280065456cf304a7800249b2d0',
  '81e70ddaf53dee6f25b6e2031cdfd5c5',
  '97343549274d914ec2680e40f77d37bb',
  'e7947fa40bf559435f11301c00a6987f',
  'e8a536d6be32236e870cf7f0d6ae7e05',
  'c96bb55d00cace6e0aca19ab7cbae462',
  'dc6eef44441582f0aa3a4a632ee63f95',
  'abce8a042af4f25fd795835932746518'
];

// Esportes com coleta de props (além de H2H)
const SPORTS_TO_COLLECT = new Set([
  'basketball_nba',
  'baseball_mlb',
  'tennis_atp',
]);

const SPORTS_WITH_PROPS = new Set([
  'basketball_nba',
]);

const HISTORY_DIR    = path.join(__dirname, 'odds_history');
const KEY_STATE_FILE = path.join(HISTORY_DIR, '_key_state.json');
const PROPS_MARKETS  = 'player_points,player_rebounds,player_assists,player_steals,player_threes';

let keyIndex = 0;
const keyBalances = {};

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Gestão de chaves ───────────────────────────────────────────────────────────
function loadKeyState() {
  if (!fs.existsSync(KEY_STATE_FILE)) return;
  try {
    const state = JSON.parse(fs.readFileSync(KEY_STATE_FILE));
    if (state.month === monthStr()) keyIndex = state.keyIndex ?? 0;
  } catch {}
}

function saveKeyState() {
  writeJson(KEY_STATE_FILE, { month: monthStr(), keyIndex, savedAt: nowISO(), balances: keyBalances });
}

function currentKey() { return API_KEYS[keyIndex % API_KEYS.length]; }

function rotateKey() {
  keyIndex = (keyIndex + 1) % API_KEYS.length;
  saveKeyState();
  console.log(`  [key] rotacionando para chave ${keyIndex}`);
}

async function apiGet(url, params = {}) {
  for (let i = 0; i < API_KEYS.length; i++) {
    try {
      const res = await axios.get(url, { params: { ...params, apiKey: currentKey() } });
      const rem  = parseInt(res.headers['x-requests-remaining'] ?? '999');
      const used = parseInt(res.headers['x-requests-used'] ?? '0');
      const last = parseInt(res.headers['x-requests-last'] ?? '0');
      keyBalances[keyIndex] = { remaining: rem, used, lastCost: last, updatedAt: nowISO() };
      saveKeyState();
      if (rem < 10) { console.log(`  [key] chave ${keyIndex} quase esgotada (${rem}) — rotacionando`); rotateKey(); }
      return res.data;
    } catch (e) {
      if (e.response?.status === 401 || e.response?.status === 429) {
        console.warn(`  [key] chave ${keyIndex} inválida/esgotada — rotacionando`);
        rotateKey();
        await sleep(500);
      } else throw e;
    }
  }
  throw new Error('Todas as chaves esgotadas');
}

// ── Utilitários ────────────────────────────────────────────────────────────────
function ensureDir(dir) { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); }
function todayStr()     { return new Date().toISOString().slice(0, 10); }
function monthStr()     { return new Date().toISOString().slice(0, 7); }
function nowISO()       { return new Date().toISOString(); }

function readJson(filePath) {
  if (!fs.existsSync(filePath)) return [];
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch { return []; }
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function appendRecords(sport, type, records) {
  const file    = path.join(HISTORY_DIR, `${sport}_${type}_${monthStr()}.json`);
  const history = readJson(file);
  const existing = new Set(history.map(e => e._key));
  let added = 0;
  for (const r of records) {
    if (existing.has(r._key)) continue;
    history.push(r);
    existing.add(r._key);
    added++;
  }
  writeJson(file, history);
  console.log(`  [${sport}/${type}] +${added} novos (total: ${history.length})`);
}

// ── Coleta H2H ────────────────────────────────────────────────────────────────
async function collectH2H(sportKey) {
  const data = await apiGet(
    `https://api.the-odds-api.com/v4/sports/${sportKey}/odds/`,
    { regions: 'eu', markets: 'h2h', oddsFormat: 'decimal' }
  );
  if (!data?.length) return;

  const today = todayStr();
  const now   = nowISO();
  const records = [];

  for (const event of data) {
    for (const bm of event.bookmakers ?? []) {
      const market = bm.markets?.find(m => m.key === 'h2h');
      if (!market) continue;
      const o = market.outcomes;
      records.push({
        _key:          `${sportKey}|${event.id}|${bm.key}|${today}`,
        sport:         sportKey,
        savedDate:     today,
        savedAt:       now,
        eventId:       event.id,
        commence_time: event.commence_time,
        home_team:     event.home_team,
        away_team:     event.away_team,
        bookmaker:     bm.key,
        last_update:   bm.last_update ?? null,
        sport_key:     sportKey,
        odds_home:     o.find(x => x.name === event.home_team)?.price ?? null,
        odds_away:     o.find(x => x.name === event.away_team)?.price ?? null,
      });
    }
  }

  appendRecords(sportKey, 'h2h', records);
}

// ── Coleta Props ───────────────────────────────────────────────────────────────
async function collectProps(sportKey) {
  const events = await apiGet(`https://api.the-odds-api.com/v4/sports/${sportKey}/events`, {});
  if (!events?.length) return;

  const today   = todayStr();
  const now     = nowISO();
  const records = [];

  for (const event of events) {
    try {
      const data = await apiGet(
        `https://api.the-odds-api.com/v4/sports/${sportKey}/events/${event.id}/odds`,
        { regions: 'eu', markets: PROPS_MARKETS, oddsFormat: 'decimal' }
      );
      for (const bm of data.bookmakers ?? []) {
        for (const market of bm.markets ?? []) {
          const players = {};
          for (const outcome of market.outcomes ?? []) {
            const p = outcome.description;
            if (!players[p]) players[p] = {};
            players[p][outcome.name] = { price: outcome.price, line: outcome.point };
          }
          for (const [player, sides] of Object.entries(players)) {
            if (!sides.Over || !sides.Under) continue;
            records.push({
              _key:          `${sportKey}|${event.id}|${bm.key}|${market.key}|${player}|${today}`,
              sport:         sportKey,
              savedDate:     today,
              savedAt:       now,
              eventId:       event.id,
              commence_time: event.commence_time,
              home_team:     event.home_team,
              away_team:     event.away_team,
              bookmaker:     bm.key,
              prop:          market.key,
              player,
              line:          sides.Over.line,
              oddsOver:      sides.Over.price,
              oddsUnder:     sides.Under.price,
              last_update:   market.last_update ?? null,
              sport_key:     sportKey,
            });
          }
        }
      }
      await sleep(300);
    } catch (e) {
      console.warn(`  [${sportKey}/props] erro no evento ${event.id}: ${e.message}`);
    }
  }

  appendRecords(sportKey, 'props', records);
}

// ── Relatório ──────────────────────────────────────────────────────────────────
function printReport() {
  console.log('\n── Histórico acumulado ──────────────────────────');
  const files = fs.readdirSync(HISTORY_DIR)
    .filter(f => f.endsWith('.json') && !f.startsWith('_'))
    .sort();
  for (const f of files) {
    const data = readJson(path.join(HISTORY_DIR, f));
    const days = [...new Set(data.map(e => e.savedDate))].length;
    console.log(`  ${f.padEnd(50)} ${String(data.length).padStart(6)} registros | ${days} dias`);
  }
  console.log('────────────────────────────────────────────────');
}

// ── Main ───────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n[save_odds_history] ${nowISO()}`);
  ensureDir(HISTORY_DIR);
  loadKeyState();

  console.log('Esportes configurados:', [...SPORTS_TO_COLLECT].join(', '));
  const sportKeys = [...SPORTS_TO_COLLECT];

  for (const sportKey of sportKeys) {
    console.log(`\n[${sportKey}]`);
    try {
      await collectH2H(sportKey);
      if (SPORTS_WITH_PROPS.has(sportKey)) await collectProps(sportKey);
      await sleep(200);
    } catch (e) {
      console.error(`  ERRO: ${e.message}`);
    }
  }

  saveKeyState();
  printReport();
  console.log('\n[save_odds_history] concluído.\n');
}

main().catch(e => { console.error('ERRO FATAL:', e.message); process.exit(1); });
