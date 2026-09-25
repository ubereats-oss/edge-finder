const fs    = require('fs');
const path  = require('path');
const { createOddsApiClient, defaultKeysFromEnv } = require('./odds_api_client');
const ledger = require('./model_ledger');
const closingOddsRules = require('./closing_odds_rules');

// Esportes com coleta de props (além de H2H)
const SPORTS_TO_COLLECT = new Set([
  'basketball_nba',
  'baseball_mlb',
]);

const SPORTS_WITH_PROPS = new Set([
  'basketball_nba',
]);

const HISTORY_DIR    = path.join(__dirname, '..', 'odds_snapshots');
const KEY_STATE_FILE = path.join(HISTORY_DIR, '_key_state.json');
const PROPS_MARKETS  = 'player_points,player_rebounds,player_assists,player_steals,player_threes';

let keyIndex = 0;
const keyBalances = {};
let oddsApi;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Gestão de chaves ───────────────────────────────────────────────────────────
function loadKeyState() {
  if (!fs.existsSync(KEY_STATE_FILE)) return;
  try {
    const state = JSON.parse(fs.readFileSync(KEY_STATE_FILE));
    if (state.month === monthStr()) {
      keyIndex = state.keyIndex ?? 0;
      Object.assign(keyBalances, state.balances || {});
    }
  } catch {}
}

function saveKeyState() {
  writeJson(KEY_STATE_FILE, { month: monthStr(), keyIndex, savedAt: nowISO(), balances: keyBalances });
}

function knownTotalRemaining() {
  const values = Object.values(keyBalances)
    .map(b => Number(b?.remaining))
    .filter(Number.isFinite);
  if (!values.length) return null;
  return values.reduce((sum, v) => sum + v, 0);
}

function nextOddsApiRenewal(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0, 0));
}

function estimateClosingOddsReserve(nowMs = Date.now()) {
  const renewalMs = nextOddsApiRenewal(new Date(nowMs)).getTime();
  const groups = new Set();

  for (const file of ledger.listAllPartitions()) {
    const entries = ledger.loadPartitionFile(file);
    for (const entry of entries) {
      if (!closingOddsRules.isClosingOddsEligible(entry)) continue;
      const commence = new Date(entry.commenceTime).getTime();
      if (isNaN(commence)) continue;
      if (commence < nowMs - closingOddsRules.CLOSING_ODDS_CAPTURE_WINDOW_AFTER_MS) continue;
      if (commence > renewalMs + closingOddsRules.CLOSING_ODDS_CAPTURE_WINDOW_AFTER_MS) continue;
      groups.add(`${entry.esporte}|${entry.eventId}|${entry.market}`);
    }
  }

  return groups.size;
}

function globalReserve() {
  const raw = process.env.ODDS_API_TOTAL_MIN_REMAINING || '0';
  const configured = parseInt(raw, 10);
  const dynamic = estimateClosingOddsReserve();
  const reserve = Math.max(Number.isFinite(configured) ? configured : 0, dynamic);
  console.log(`[quota] reserva global dinâmica: ${reserve} crédito(s) (captura estimada até ${nextOddsApiRenewal().toISOString().slice(0, 10)}: ${dynamic}; piso configurado: ${Number.isFinite(configured) ? configured : 0}).`);
  return reserve;
}

function ensureGlobalQuotaAvailable(scope) {
  if (process.env.ODDS_API_IGNORE_GLOBAL_RESERVE === 'true') return true;
  const reserve = globalReserve();
  if (reserve <= 0) return true;
  const total = knownTotalRemaining();
  if (total === null || total >= reserve) return true;
  console.log(`[quota] ${scope}: chamada pulada por reserva global da The Odds API. total_conhecido=${total}; reserva=${reserve}.`);
  return false;
}

async function apiGet(url, params = {}) {
  const res = await oddsApi.get(url, { params });
  return res.data;
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

function inSeason(sportKey) {
  const month = new Date().getUTCMonth() + 1;
  if (sportKey === 'basketball_nba') return month >= 10 || month <= 4;
  if (sportKey === 'baseball_mlb') return month >= 3 && month <= 10;
  return true;
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
  if (!inSeason(sportKey)) {
    console.log(`  [${sportKey}/h2h] pulado: esporte fora de temporada.`);
    return;
  }
  if (!ensureGlobalQuotaAvailable(`${sportKey}/h2h`)) return;
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
  if (!inSeason(sportKey)) {
    console.log(`  [${sportKey}/props] pulado: mercado fora de temporada.`);
    return;
  }
  if (!ensureGlobalQuotaAvailable(`${sportKey}/props/events`)) return;
  const events = await apiGet(`https://api.the-odds-api.com/v4/sports/${sportKey}/events`, {});
  if (!events?.length) return;

  const today   = todayStr();
  const now     = nowISO();
  const records = [];

  for (const event of events) {
    try {
      if (!ensureGlobalQuotaAvailable(`${sportKey}/props/${event.id}`)) break;
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
  const envKeys = defaultKeysFromEnv();
  oddsApi = createOddsApiClient({
    keys: envKeys,
    label: 'odds-history',
    startIndex: keyIndex,
    onKeyUsed: ({ index, remaining, used, last }) => {
      keyIndex = index;
      keyBalances[index] = {
        remaining: parseInt(remaining ?? '999'),
        used: parseInt(used ?? '0'),
        lastCost: parseInt(last ?? '0'),
        updatedAt: nowISO(),
      };
      saveKeyState();
      if (remaining !== undefined) console.log(`  [key] chave ${index} créditos restantes: ${remaining}`);
    },
  });

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
