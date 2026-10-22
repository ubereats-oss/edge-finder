// Coleta Betano por JSON de rede numa sessão Edge visível e persistente.
// A máquina coleta odds; Pinnacle, validação e comparação executam na nuvem.
const { spawn } = require('node:child_process');
const { chromium } = require('playwright');
const admin = require('firebase-admin');
const { loadEnvFileIfPresent } = require('./odds_api_client');
const competitions = require('./placard_config');
const path = require('node:path');
const fs = require('node:fs');

const PROJECT = path.resolve(__dirname, '..');
const TUNNEL = path.join(PROJECT, 'scripts', 'local_bookmakers', 'tunnelbear.ps1');
const PROFILE = path.join(process.env.LOCALAPPDATA || require('node:os').tmpdir(), 'odds_app', 'edge_betano_persistent');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CDP = 'http://127.0.0.1:9331';
const START_URL = 'https://www.betano.pt/sport/basquetebol/eua/nba';
const SPORT = 'basketball_nba';
const DATA_PATH = '/api/sports/BASK/hot/trending/leagues/441g/events?req=s,stnf,c,mb';
const FOOTBALL_PATH = '/api/sports/FOOT/hot/trending/leagues/433g/events?req=s,stnf,c,mb';
const TASK_NAME = 'EdgeFinder-Betano-Local';
const MONTHLY_TUNNEL_CAP_MB = 4000;
const MAX_MEASURED_CYCLE_MB = 15;
const OUTPUT_DIR = path.join(PROJECT, '.local_logs', 'betano');
const BLOCKED_RESOURCE_TYPES = new Set(['image', 'media', 'font']);
const BLOCKED_TRACKING_URL = /google-analytics|googletagmanager|doubleclick|facebook\.net|hotjar|optimove|go-mpulse|bsqd\.me/i;

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

async function ensureEdge() {
  if (!(await cdpReady())) {
    if (!fs.existsSync(EDGE)) throw new Error(`Microsoft Edge instalado não encontrado: ${EDGE}`);
    fs.mkdirSync(PROFILE, { recursive: true });
    const child = spawn(EDGE, [
      '--remote-debugging-port=9331', `--user-data-dir=${PROFILE}`, '--no-first-run', '--new-window', 'about:blank',
    ], { detached: true, stdio: 'ignore', windowsHide: false });
    child.unref();
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline && !(await cdpReady())) await new Promise(resolve => setTimeout(resolve, 500));
  }
  if (!(await cdpReady())) throw new Error('Edge visível não abriu a porta de depuração remota em 30s.');
  const browser = await chromium.connectOverCDP(CDP);
  const context = browser.contexts()[0];
  if (!context) throw new Error('Edge conectado sem contexto persistente.');
  await context.route('**/*', route => {
    const request = route.request();
    return BLOCKED_RESOURCE_TYPES.has(request.resourceType()) || BLOCKED_TRACKING_URL.test(request.url())
      ? route.abort() : route.continue();
  });
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

function normalizeCompetition(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function apiSportForEvent(event) {
  const prefix = ({ FOOT: 'soccer_', BASK: 'basketball_', BASE: 'baseball_', TENN: 'tennis_' })[event.sportId];
  if (!prefix) return null;
  const observed = [event.leagueName, event.leagueDescription, event.regionName].map(normalizeCompetition).filter(Boolean);
  const matches = competitions.filter(competition => competition.key.startsWith(prefix)
    && [competition.label, ...(competition.aliases || [])].some(label => {
      const expected = normalizeCompetition(label);
      return observed.some(name => name === expected || (name.length >= 6 && expected.endsWith(name)));
    }));
  return matches.length === 1 ? matches[0].key : null;
}

function readSelections(payload) {
  return (payload?.data?.events || []).flatMap(event => {
    const rawMarkets = Array.isArray(event.markets) ? event.markets
      : (event.sixPackBlocks || []).flatMap(block => block.columns || []);
    const markets = rawMarkets.flatMap(market => {
      const type = ({ H2HT: 'H2HT', HTOH: 'HTOH', MRES: 'MRES', HCOT: 'HCOT', TGHC: 'TGHC',
        FHOT: 'HCOT', FTPO: 'HCTG', HCTG: 'HCTG', TPOT: 'TPOT' })[market.type];
      if (!type || !Array.isArray(market.selections)) return [];
      if (market.selections.some(selection => !Number.isFinite(Number(selection.price)) || Number(selection.price) <= 1
        || selection.isSuspended === true || selection.isAvailable === false)) return [];
      const selections = market.selections
        .map(selection => ({ price: Number(selection.price), line: ['H2HT', 'HTOH', 'MRES'].includes(type)
          ? null : Number(selection.handicap), fullName: selection.fullName || '', name: selection.name || '', unavailable: false }));
      if (selections.length < 2) return [];
      return [{ type, title: market.name, selections }];
    });
    const teams = (event.participants || []).map(participant => participant.name).filter(Boolean);
    const apiSport = apiSportForEvent(event);
    if (teams.length !== 2 || !markets.length || !apiSport || !Number.isFinite(Number(event.startTime))) return [];
    return [{ apiSport, teams, competition: event.leagueName || event.leagueDescription || 'NBA',
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

async function updateFailure(db, error, vpnDisconnected) {
  try {
    await db.collection('local_bookmaker_status').doc('betano').set({
      lastFailureAt: new Date().toISOString(), lastFailure: String(error.message || error).slice(0, 500),
      vpnDisconnected, taskName: TASK_NAME, computerName: process.env.COMPUTERNAME,
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
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const startedAt = new Date().toISOString();
  const db = database();
  const outputFile = path.join(OUTPUT_DIR, `cycle-${startedAt.replace(/[:.]/g, '-')}.json`);
  const validationOnly = process.argv.includes('--validate-football');
  const gate = (await db.collection('_bookmaker_validation').doc('betano_soccer').get()).data();
  if (!validationOnly && gate?.passed !== true) throw new Error('Betano futebol ainda não validado: 20 seleções exigidas.');
  let browser;
  let context;
  let vpnConnected = false;
  let beforeMB = null;
  let afterMB = null;
  let usageRecorded = false;
  let error;
  let cycle = { startedAt, taskName: TASK_NAME, computerName: process.env.COMPUTERNAME, validationOnly };
  try {
    assertTunnelBudget();
    beforeMB = tunnel('meter').remainingMB;
    cycle.vpn = tunnel('connect');
    vpnConnected = true;
    const edge = await ensureEdge();
    browser = edge.browser;
    context = edge.context;
    const page = edge.page;
    await dismissCookieNotice(page);

    const nba = await initialJson(page);
    const football = await freshJson(page, FOOTBALL_PATH);
    fs.writeFileSync(path.join(OUTPUT_DIR, 'football-latest.json'), JSON.stringify(football));
    const games = [...(validationOnly ? [] : readSelections(nba)), ...readSelections(football)].map(adaptTotalsAndHandicaps).filter(game => {
      const delta = Date.parse(game.commenceTime) - Date.now();
      return delta > 0 && delta <= 12 * 3600000;
    });
    if (!games.length) throw new Error('Endpoint Betano sem jogos elegíveis nas próximas 12h.');
    await page.goto('about:blank');
    cycle.disconnected = tunnel('disconnect');
    vpnConnected = false;

    const cycleId = `local-betano-${Date.now()}`;
    cycle.firestoreReadId = cycleId;
    cycle.games = games.length;
    cycle.selections = games.reduce((sum, game) => sum + game.markets.reduce((total, market) => total + market.selections.length, 0), 0);
    const readRef = db.collection('_bookmaker_reads').doc(cycleId);
    await readRef.set({ bookmaker: 'Betano', observedAt: new Date().toISOString(), mode: validationOnly ? 'validation' : 'production',
      status: 'writing', gameCount: games.length, source: 'Edge CDP JSON fetch' });
    await Promise.all(games.map((game, index) => readRef.collection('games').doc(`game-${index}`).set(game)));
    await readRef.set({ status: 'ready', gamesWrittenAt: new Date().toISOString() }, { merge: true });

    const deadline = Date.now() + 8 * 60000;
    let comparison;
    while (Date.now() < deadline) {
      comparison = (await readRef.get()).data();
      if (['processed', 'processed_with_errors'].includes(comparison.status)) break;
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
    if (comparison?.status !== 'processed') throw new Error(`Comparação na nuvem não concluída: ${comparison?.status}; ${JSON.stringify(comparison?.errors || [])}`);
    cycle.comparison = { status: comparison.status, processedAt: comparison.processedAt,
      comparedSelections: comparison.comparedSelections, opportunities: comparison.opportunities };
    if (validationOnly && (await db.collection('_bookmaker_validation').doc('betano_soccer').get()).data()?.passed !== true) {
      throw new Error('Validação futebol insuficiente: consulte _bookmaker_validation/betano_soccer.');
    }
    afterMB = tunnel('meter').remainingMB;
    const usage = recordTunnelUsage({ startedAt, beforeMB, afterMB });
    usageRecorded = true;
    cycle = { ...cycle, finishedAt: new Date().toISOString(),
      beforeMB, afterMB, consumedMB: beforeMB - afterMB, monthlyChargedMB: usage.cycles.at(-1).chargedMB,
      monthlyUsageMB: usage.totalMB, endpoints: [DATA_PATH, FOOTBALL_PATH] };
    if (!validationOnly) await db.collection('local_bookmaker_status').doc('betano').set({
      lastSuccessAt: cycle.finishedAt, vpnDisconnected: true, taskName: TASK_NAME, computerName: process.env.COMPUTERNAME,
      lastReadAt: cycle.finishedAt, lastTunnelBearMB: cycle.consumedMB, lastReadId: cycleId,
      comparedSelections: comparison.comparedSelections, selections: cycle.selections, schedule: '11,13,15,17,19,21,23 America/Sao_Paulo',
    }, { merge: true });
    fs.writeFileSync(outputFile, JSON.stringify(cycle, null, 2));
    console.log(JSON.stringify({ outputFile, finishedAt: cycle.finishedAt, games: cycle.games,
      consumedMB: cycle.consumedMB, firestoreReadId: cycle.firestoreReadId, VPN: 'off' }));
  } catch (caught) {
    error = caught;
  } finally {
    if (context) await context.unroute('**/*').catch(() => {});
    if (browser) await browser.close().catch(() => {});
    if (vpnConnected) {
      try { cycle.disconnected = tunnel('disconnect'); vpnConnected = false; } catch (disconnectError) {
        error = new Error(`${error?.message || 'ciclo falhou'}; VPN não desligou: ${disconnectError.message}`);
      }
    }
    if (Number.isFinite(beforeMB) && !usageRecorded) {
      try { afterMB = tunnel('meter').remainingMB; } catch (_) { afterMB = null; }
      try { recordTunnelUsage({ startedAt, beforeMB, afterMB, reason: error ? 'failed' : 'incomplete' }); }
      catch (ledgerError) { console.error(`Não foi possível registrar uso TunnelBear: ${ledgerError.message}`); }
    }
    if (error) {
      cycle.error = error.message;
      cycle.finishedAt = new Date().toISOString();
      cycle.vpnDisconnected = !vpnConnected;
      cycle.beforeMB = beforeMB; cycle.afterMB = afterMB;
      fs.writeFileSync(outputFile, JSON.stringify(cycle, null, 2));
      await updateFailure(db, error, !vpnConnected);
    }
  }
  if (error) throw error;
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { readSelections, adaptTotalsAndHandicaps, assertTunnelBudget, recordTunnelUsage,
  tunnelCycleAffordable, MONTHLY_TUNNEL_CAP_MB, MAX_MEASURED_CYCLE_MB };
