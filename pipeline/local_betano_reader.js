// Coleta Betano por JSON de rede numa sessão Chrome visível e persistente.
// Escopo atualmente comprovado: NBA, mercado principal de vencedor/handicap/total.
const { spawn } = require('node:child_process');
const { chromium } = require('playwright');
const admin = require('firebase-admin');
const { loadEnvFileIfPresent, createOddsApiClient } = require('./odds_api_client');
const { compareBookmaker } = require('./placard_value');
const { allEntries, captureClosing, publish, saveOpportunity } = require('./run_placard_value');
const path = require('node:path');
const fs = require('node:fs');

const PROJECT = path.resolve(__dirname, '..');
const TUNNEL = path.join(PROJECT, 'scripts', 'local_bookmakers', 'tunnelbear.ps1');
const PROFILE = path.join(process.env.LOCALAPPDATA, 'odds_app', 'chrome_betano_persistent');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const CDP = 'http://127.0.0.1:9222';
const START_URL = 'https://www.betano.pt/sport/basquetebol/eua/nba';
const SPORT = 'basketball_nba';
const DATA_PATH = '/api/sports/BASK/hot/trending/leagues/441g/events?req=s,stnf,c,mb';
const START_TOLERANCE_MS = 10 * 60000;
const MONTHLY_TUNNEL_CAP_MB = 4000;
const MAX_MEASURED_CYCLE_MB = 56;
const OUTPUT_DIR = path.join(PROJECT, '.local_logs', 'betano');
const IMAGE_AND_MEDIA = new Set(['image', 'media']);

function tunnel(action) {
  const result = require('node:child_process').spawnSync('powershell.exe', [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', TUNNEL, action,
  ], { encoding: 'utf8', timeout: 240000 });
  if (result.status !== 0) throw new Error((result.stderr || result.stdout || `TunnelBear ${action} falhou`).trim());
  return JSON.parse(result.stdout.trim());
}

function database() {
  if (!process.env.FIREBASE_SERVICE_ACCOUNT) throw new Error('FIREBASE_SERVICE_ACCOUNT ausente.');
  if (!admin.apps.length) admin.initializeApp({
    credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)),
  });
  return admin.firestore();
}

async function cdpReady() {
  try { return (await fetch(`${CDP}/json/version`)).ok; } catch { return false; }
}

async function ensureChrome() {
  if (!(await cdpReady())) {
    if (!fs.existsSync(CHROME)) throw new Error(`Chrome instalado não encontrado: ${CHROME}`);
    fs.mkdirSync(PROFILE, { recursive: true });
    const child = spawn(CHROME, [
      '--remote-debugging-port=9222', `--user-data-dir=${PROFILE}`, '--no-first-run', '--new-window', START_URL,
    ], { detached: true, stdio: 'ignore', windowsHide: false });
    child.unref();
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline && !(await cdpReady())) await new Promise(resolve => setTimeout(resolve, 500));
  }
  if (!(await cdpReady())) throw new Error('Chrome visível não abriu a porta de depuração remota em 30s.');
  const browser = await chromium.connectOverCDP(CDP);
  const context = browser.contexts()[0];
  if (!context) throw new Error('Chrome conectado sem contexto persistente.');
  await context.route('**/*', route => IMAGE_AND_MEDIA.has(route.request().resourceType())
    ? route.abort() : route.continue());
  let page = context.pages().find(candidate => candidate.url().startsWith('https://www.betano.pt/'))
    || context.pages()[0] || await context.newPage();
  return { browser, context, page };
}

async function dismissCookieNotice(page) {
  for (const name of [/rejeitar todos/i, /recusar tudo/i, /reject all/i, /accept all/i, /aceitar todos/i]) {
    const button = page.getByRole('button', { name }).first();
    if (await button.isVisible().catch(() => false)) {
      await button.click({ timeout: 1500 }).catch(() => {});
      return;
    }
  }
}

function readSelections(payload) {
  return (payload?.data?.events || []).flatMap(event => {
    const markets = (event.sixPackBlocks || []).flatMap(block => block.columns || []).flatMap(column => {
      const type = ({ H2HT: 'H2HT', FHOT: 'HCOT', FTPO: 'HCTG' })[column.type];
      if (!type || !Array.isArray(column.selections)) return [];
      const selections = column.selections.filter(s => Number.isFinite(Number(s.price)) && Number(s.price) > 1)
        .map(s => ({ price: Number(s.price), line: type === 'H2HT' ? null : Number(s.handicap),
          fullName: s.fullName || '', name: s.name || '', unavailable: false }));
      if (selections.length < 2) return [];
      return [{ type, title: column.name, selections }];
    });
    const teams = (event.participants || []).map(participant => participant.name).filter(Boolean);
    if (teams.length !== 2 || !markets.length || !Number.isFinite(Number(event.startTime))) return [];
    return [{ apiSport: SPORT, teams, competition: event.leagueName || event.leagueDescription || 'NBA',
      commenceTime: new Date(Number(event.startTime)).toISOString(), observedAt: new Date().toISOString(),
      sourceUrl: new URL(event.url || START_URL, 'https://www.betano.pt').toString(), markets,
      sourceEventId: String(event.id), sourceEventName: event.shortName || event.name }];
  });
}

function adaptTotalsAndHandicaps(game) {
  return { ...game, markets: game.markets.map(market => {
    if (market.type === 'HCTG') return { ...market, selections: market.selections.map(selection => ({
      ...selection, line: Number.isFinite(selection.line) ? selection.line : null,
      name: selection.name.toLowerCase().startsWith('mais') ? 'Over'
        : selection.name.toLowerCase().startsWith('menos') ? 'Under' : selection.name,
    })) };
    if (market.type === 'HCOT') return { ...market, selections: market.selections.map(selection => ({
      ...selection, line: Number.isFinite(selection.line) ? selection.line : null,
    })) };
    return market;
  }) };
}

async function freshJson(page, endpoint) {
  const result = await page.evaluate(async path => {
    const response = await fetch(path, { credentials: 'include', cache: 'no-store' });
    return { status: response.status, contentType: response.headers.get('content-type'), payload: await response.json() };
  }, endpoint);
  if (result.status !== 200 || !/json/i.test(result.contentType || '') || !Array.isArray(result.payload?.data?.events)) {
    throw new Error(`Endpoint de eventos Betano inválido (HTTP ${result.status}).`);
  }
  return result.payload;
}

async function initialJson(page) {
  if (!page.url().startsWith(START_URL)) {
    const responsePromise = page.waitForResponse(response => response.url().includes(DATA_PATH.split('?')[0])
      && /json/i.test(response.headers()['content-type'] || ''), { timeout: 45000 });
    await page.goto(START_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await dismissCookieNotice(page);
    const response = await responsePromise;
    return response.json();
  }
  return freshJson(page, DATA_PATH);
}

async function updateFailure(db, error) {
  try {
    await db.collection('local_bookmaker_status').doc('betano').set({
      lastFailureAt: new Date().toISOString(), lastFailure: String(error.message || error).slice(0, 500),
      vpnDisconnected: true,
    }, { merge: true });
  } catch (firestoreError) {
    console.error(`Não foi possível gravar falha Betano no Firestore: ${firestoreError.message}`);
  }
}

function monthKey(now = Date.now()) {
  return new Date(now).toISOString().slice(0, 7);
}

function usageFile(now = Date.now()) {
  return path.join(OUTPUT_DIR, `tunnelbear_usage_${monthKey(now)}.json`);
}

function readMonthlyUsage(now = Date.now()) {
  const file = usageFile(now);
  if (!fs.existsSync(file)) return { month: monthKey(now), totalMB: 0, cycles: [] };
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { throw new Error('Ledger mensal TunnelBear ilegível; ciclo bloqueado para proteger o limite de 4 GB.'); }
}

function tunnelCycleAffordable(usedMB) {
  return Number.isFinite(usedMB) && usedMB + MAX_MEASURED_CYCLE_MB <= MONTHLY_TUNNEL_CAP_MB;
}

function assertTunnelBudget(now = Date.now()) {
  const ledger = readMonthlyUsage(now);
  if (!tunnelCycleAffordable(ledger.totalMB)) {
    throw new Error(`Ciclo bloqueado: uso conservador TunnelBear ${ledger.totalMB} MB + reserva ${MAX_MEASURED_CYCLE_MB} MB excederia ${MONTHLY_TUNNEL_CAP_MB} MB neste mês.`);
  }
  return ledger;
}

function recordTunnelUsage({ startedAt, beforeMB, afterMB, now = Date.now(), reason = 'complete' }) {
  const ledger = readMonthlyUsage(now);
  const measuredMB = Number.isFinite(beforeMB) && Number.isFinite(afterMB) ? Math.max(0, beforeMB - afterMB) : 0;
  const chargedMB = Math.max(MAX_MEASURED_CYCLE_MB, measuredMB);
  ledger.cycles.push({ startedAt, recordedAt: new Date(now).toISOString(), beforeMB, afterMB,
    measuredMB, chargedMB, reason });
  ledger.totalMB = ledger.cycles.reduce((sum, cycle) => sum + Number(cycle.chargedMB || 0), 0);
  fs.writeFileSync(usageFile(now), JSON.stringify(ledger, null, 2));
  return ledger;
}

async function main() {
  loadEnvFileIfPresent(path.resolve(__dirname, '..', '.env'));
  process.env.ODDS_API_ENFORCE_MONTHLY_BUDGET = '1';
  process.env.ALLOW_LIVE_ODDS_API = '1';
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const startedAt = new Date().toISOString();
  const db = database();
  const outputFile = path.join(OUTPUT_DIR, `cycle-${startedAt.replace(/[:.]/g, '-')}.json`);
  let browser;
  let context;
  let vpnConnected = false;
  let beforeMB = null;
  let afterMB = null;
  let usageRecorded = false;
  let error;
  try {
    assertTunnelBudget();
    beforeMB = tunnel('meter').remainingMB;
    const vpn = tunnel('connect');
    vpnConnected = true;
    const chrome = await ensureChrome();
    browser = chrome.browser;
    context = chrome.context;
    const page = chrome.page;
    await dismissCookieNotice(page);

    // Fechamentos pendentes consomem a cota antes da nova leitura da Betano.
    let entries = await allEntries(db);
    const closingUsage = await captureClosing(db, entries);
    entries = await allEntries(db);

    const payload = await initialJson(page);
    const navigationCount = await page.evaluate(() => performance.getEntriesByType('navigation').length);
    const games = readSelections(payload).map(adaptTotalsAndHandicaps).filter(game => {
      const delta = Date.parse(game.commenceTime) - Date.now();
      return delta > 0 && delta <= 12 * 3600000;
    });
    if (!games.length) throw new Error('Endpoint JSON Betano respondeu, mas não trouxe jogos NBA nas próximas 12h.');

    const api = createOddsApiClient({ label: 'betano-reading' });
    const from = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
    const to = new Date(Date.now() + 12 * 3600000).toISOString().replace(/\.\d{3}Z$/, 'Z');
    const response = await api.get(`https://api.the-odds-api.com/v4/sports/${SPORT}/odds`, {
      timeout: 20000, params: { bookmakers: 'pinnacle', markets: 'h2h,totals,spreads',
        oddsFormat: 'decimal', commenceTimeFrom: from, commenceTimeTo: to },
    });
    const pinnacleEvents = response.data.map(event => ({ ...event, sport_key: SPORT }));
    const comparedAt = Date.now();
    const opportunityRows = [];
    let comparedSelections = 0;
    const validations = [];
    for (const game of games) {
      const comparison = compareBookmaker('Betano', game, pinnacleEvents, comparedAt,
        { startToleranceMs: START_TOLERANCE_MS });
      comparedSelections += comparison.comparedSelections || 0;
      for (const row of comparison.rows) {
        row.sourceEventId = game.sourceEventId;
        await saveOpportunity(db, row);
        opportunityRows.push(row);
      }
      validations.push({ sourceEventId: game.sourceEventId, teams: game.teams,
        start: game.commenceTime, matchedSelections: comparison.comparedSelections || 0,
        opportunities: comparison.rows.length, reason: comparison.reason || null });
    }

    const cacheRef = db.collection('_placard_pinnacle_latest').doc(SPORT);
    await cacheRef.set({ events: pinnacleEvents, updatedAt: new Date().toISOString(), source: 'betano-local-reader' });
    const readDoc = { observedAt: new Date().toISOString(), workflowRunId: `local-betano-${Date.now()}`,
      bookmaker: 'Betano', apiSport: SPORT, games, pinnacle: JSON.stringify(pinnacleEvents), comparedSelections,
      opportunities: opportunityRows.length, source: 'Chrome CDP JSON fetch' };
    await db.collection('_placard_reads').add(readDoc);

    entries = await allEntries(db);
    const currentRows = entries.filter(entry => entry.closingStatus === 'pendente' && Date.parse(entry.commenceTime) > Date.now());
    await publish(db, { rows: currentRows, errors: [], diagnostics: [], apiUsage: api.usage(), closingUsage }, entries);

    const disconnected = tunnel('disconnect');
    vpnConnected = false;
    afterMB = tunnel('meter').remainingMB;
    const usage = recordTunnelUsage({ startedAt, beforeMB, afterMB });
    usageRecorded = true;
    const cycle = { startedAt, finishedAt: new Date().toISOString(), vpn, disconnected,
      beforeMB, afterMB, consumedMB: beforeMB - afterMB, monthlyChargedMB: usage.cycles.at(-1).chargedMB,
      monthlyUsageMB: usage.totalMB, endpoint: DATA_PATH,
      source: 'fetch same-origin JSON na sessão persistente, sem reload', navigationCount,
      games: games.length, comparedSelections, opportunities: opportunityRows.length,
      apiUsage: api.usage(), closingUsage, validations };
    await db.collection('local_bookmaker_status').doc('betano').set({
      lastSuccessAt: cycle.finishedAt, lastFailure: null, lastFailureAt: null, vpnDisconnected: true,
      lastReadAt: cycle.finishedAt, lastComparedSelections: comparedSelections,
      lastOpportunities: opportunityRows.length, lastTunnelBearMB: cycle.consumedMB,
      lastApiCredits: api.usage().creditsSpent,
    }, { merge: true });
    fs.writeFileSync(outputFile, JSON.stringify(cycle, null, 2));
    console.log(JSON.stringify({ outputFile, finishedAt: cycle.finishedAt, games: cycle.games,
      comparedSelections, opportunities: opportunityRows.length, consumedMB: cycle.consumedMB,
      credits: api.usage().creditsSpent, VPN: 'off' }));
  } catch (caught) {
    error = caught;
    await updateFailure(db, caught);
    throw caught;
  } finally {
    if (context) await context.unroute('**/*').catch(() => {});
    if (browser) await browser.close().catch(() => {});
    if (vpnConnected) {
      try { tunnel('disconnect'); } catch (disconnectError) {
        await updateFailure(db, new Error(`${error?.message || 'ciclo falhou'}; VPN não desligou: ${disconnectError.message}`));
      }
    }
    if (Number.isFinite(beforeMB) && !usageRecorded) {
      try { afterMB = tunnel('meter').remainingMB; } catch (_) { afterMB = null; }
      try { recordTunnelUsage({ startedAt, beforeMB, afterMB, reason: error ? 'failed' : 'incomplete' }); }
      catch (ledgerError) { console.error(`Não foi possível registrar uso TunnelBear: ${ledgerError.message}`); }
    }
  }
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { readSelections, adaptTotalsAndHandicaps, assertTunnelBudget, recordTunnelUsage,
  tunnelCycleAffordable, MONTHLY_TUNNEL_CAP_MB, MAX_MEASURED_CYCLE_MB };
