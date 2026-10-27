// Coleta Betano por JSON de rede numa sessão Edge visível e persistente.
// A máquina coleta odds; Pinnacle, validação e comparação executam na nuvem.
const { spawn } = require('node:child_process');
const { chromium } = require('playwright');
const admin = require('firebase-admin');
const { loadEnvFileIfPresent } = require('./odds_api_client');
const competitions = require('./placard_config');
const path = require('node:path');
const fs = require('../scripts/local_bookmakers/safe_files.cjs');
const { readRetabet } = require('../scripts/local_bookmakers/retabet_reader.cjs');
const { readBwin } = require('../scripts/local_bookmakers/bwin_reader.cjs');
const { readBetclic } = require('../scripts/local_bookmakers/betclic_reader.cjs');
const { readLebull } = require('../scripts/local_bookmakers/lebull_reader.cjs');
const { readEscOnline } = require('../scripts/local_bookmakers/esc_online_reader.cjs');
const { readGoldenpark } = require('../scripts/local_bookmakers/goldenpark_reader.cjs');
const { scheduledFeedProbe } = require('../scripts/local_bookmakers/scheduled_feed_probe.cjs');

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
const MAX_MEASURED_CYCLE_MB = 18;
const OUTPUT_DIR = path.join(process.env.EDGE_DATA_ROOT || PROJECT, '.local_logs', 'betano');
const BWIN_VALIDATION_REQUEST = path.join(OUTPUT_DIR, 'bwin-validation-request.json');
const BLOCKED_RESOURCE_TYPES = new Set(['image', 'media', 'font']);
const BLOCKED_TRACKING_URL = /google-analytics|googletagmanager|doubleclick|facebook\.net|hotjar|optimove|go-mpulse|bsqd\.me/i;

function tunnel(action, cycleId = '', purpose = '') {
  const attemptFile = path.join(OUTPUT_DIR, `tunnelbear_attempts_${monthKey()}.jsonl`);
  const invoke = (operation, restarted = false) => {
    const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', TUNNEL, operation];
    if (operation === 'meter') args.push('-StableSeconds', '15');
    return require('node:child_process').spawnSync('powershell.exe', args,
      { encoding: 'utf8', timeout: operation === 'recover' ? 90000 : 240000, env: { ...process.env,
        EDGE_TUNNEL_ATTEMPT_LOG: attemptFile, EDGE_TUNNEL_CYCLE_ID: cycleId, EDGE_TUNNEL_PURPOSE: purpose,
        EDGE_TUNNEL_RESTARTED: restarted ? '1' : '0' } });
  };
  const { runTunnel } = require('../scripts/local_bookmakers/tunnel_runner.cjs');
  const result = runTunnel(action, invoke, () => fs.existsSync(attemptFile) && fs.readFileSync(attemptFile, 'utf8')
    .split(/\r?\n/).some(line => { try { const row = JSON.parse(line); return row.cycleId === cycleId && row.status === 'hung_reopened'; } catch { return false; } }));
  if (result.status !== 0) throw new Error((result.stderr || result.stdout || `TunnelBear ${action} falhou`).trim());
  return JSON.parse(result.stdout.trim());
}

function physicalNetworkBytes() {
  const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(PROJECT, 'scripts/local_bookmakers/network_adapter.ps1')];
  if (physicalNetworkBytes.interfaceIndex) args.push('-InterfaceIndex', String(physicalNetworkBytes.interfaceIndex));
  const result = require('node:child_process').spawnSync('powershell.exe', args,
    { encoding: 'utf8', timeout: 20000 });
  if (result.status !== 0) throw new Error((result.stderr || result.stdout || 'Falha ao ler bytes da rede física.').trim());
  const bytes = JSON.parse(result.stdout.trim());
  physicalNetworkBytes.interfaceIndex = bytes.interfaceIndex;
  if (![bytes.receivedBytes, bytes.sentBytes].every(value => Number.isFinite(value) && value >= 0)) {
    throw new Error('Contadores de bytes da rede física inválidos.');
  }
  return bytes;
}

function vpnNetworkBytes() {
  const script = "$adapter = [System.Net.NetworkInformation.NetworkInterface]::GetAllNetworkInterfaces() | Where-Object { $_.Description -eq 'TunnelBear Adapter V9' } | Select-Object -First 1; if (-not $adapter) { throw 'Adaptador TunnelBear não encontrado.' }; $stats = $adapter.GetIPv4Statistics(); [pscustomobject]@{ receivedBytes = [double]$stats.BytesReceived; sentBytes = [double]$stats.BytesSent } | ConvertTo-Json -Compress";
  const result = require('node:child_process').spawnSync('powershell.exe', ['-NoProfile', '-Command', script],
    { encoding: 'utf8', timeout: 20000 });
  if (result.status !== 0) return null;
  const bytes = JSON.parse(result.stdout.trim());
  if (![bytes.receivedBytes, bytes.sentBytes].every(value => Number.isFinite(value) && value >= 0)) {
    return null;
  }
  return bytes;
}

function networkProcessSnapshot() {
  const script = "$rows=Get-NetTCPConnection -State Established -ErrorAction SilentlyContinue | Where-Object { $_.RemoteAddress -notin @('127.0.0.1','::1') } | Group-Object OwningProcess | ForEach-Object { $pidValue=[int]$_.Name; $process=Get-Process -Id $pidValue -ErrorAction SilentlyContinue; if ($process) { [pscustomobject]@{ pid=$pidValue; name=$process.ProcessName; connections=$_.Count } } }; @($rows) | ConvertTo-Json -Compress";
  const result = require('node:child_process').spawnSync('powershell.exe', ['-NoProfile', '-Command', script],
    { encoding: 'utf8', timeout: 12000 });
  if (result.status !== 0) return [];
  try { return [].concat(JSON.parse(result.stdout.trim() || '[]')).filter(Boolean); }
  catch { return []; }
}

function summarizeNetworkProcesses(samples) {
  const byPid = new Map();
  for (const sample of samples) for (const row of sample.rows) {
    const previous = byPid.get(row.pid) || { pid: row.pid, name: row.name, samples: 0, peakConnections: 0 };
    previous.samples++;
    previous.peakConnections = Math.max(previous.peakConnections, row.connections);
    byPid.set(row.pid, previous);
  }
  return [...byPid.values()].sort((a, b) => b.samples - a.samples || b.peakConnections - a.peakConnections);
}

function database() {
  if (!process.env.FIREBASE_SERVICE_ACCOUNT) throw new Error('FIREBASE_SERVICE_ACCOUNT ausente.');
  if (!admin.apps.length) admin.initializeApp({
    credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)),
  });
  return admin.firestore();
}

async function authenticate(db, timeoutMs = 15000) {
  let timer;
  try {
    await Promise.race([db.collection('_placard_pinnacle_latest').limit(1).get(),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Firebase: autenticação não confirmada em 15 segundos.')), timeoutMs); })]);
    return { authenticated: true, at: new Date().toISOString() };
  } catch (error) { throw new Error(`Firebase: autenticação falhou antes do VPN: ${error.message}`); }
  finally { clearTimeout(timer); }
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
    try {
      const response = await page.goto(`https://www.betano.pt${DATA_PATH}`, {
        waitUntil: 'domcontentloaded', timeout: 20000,
      });
      if (response?.ok() && /json/i.test(response.headers()['content-type'] || '')) {
        const payload = await response.json();
        if (Array.isArray(payload?.data?.events)) return payload;
      }
    } catch (_) { /* endpoint direto pode exigir a página inicial */ }
    await page.goto(START_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await dismissCookieNotice(page);
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
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit' })
    .formatToParts(new Date(now));
  const value = type => parts.find(part => part.type === type).value;
  return `${value('year')}-${value('month')}`;
}

function usageFile(now = Date.now()) {
  return path.join(OUTPUT_DIR, `tunnelbear_usage_${monthKey(now)}.json`);
}

function readMonthlyUsage(now = Date.now()) {
  const file = usageFile(now);
  if (!fs.existsSync(file)) return { month: monthKey(now), totalMB: 0, cycles: [] };
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { throw new Error('Registro mensal TunnelBear ilegível; consumo não pôde ser recuperado.'); }
}

function tunnelCycleAffordable(usedMB) {
  return Number.isFinite(usedMB) && usedMB >= 0;
}

function assertTunnelBudget(now = Date.now()) {
  return readMonthlyUsage(now);
}

function recordTunnelUsage({ startedAt, beforeMB, afterMB, networkBytesBefore, networkBytesAfter,
  vpnBytesBefore, vpnBytesAfter,
  now = Date.now(), reason = 'complete' }) {
  const ledger = readMonthlyUsage(now);
  const providerDeltaMB = Number.isFinite(beforeMB) && Number.isFinite(afterMB) && afterMB <= beforeMB
    ? beforeMB - afterMB : null;
  const networkBefore = networkBytesBefore && networkBytesBefore.receivedBytes + networkBytesBefore.sentBytes;
  const networkAfter = networkBytesAfter && networkBytesAfter.receivedBytes + networkBytesAfter.sentBytes;
  const networkMB = Number.isFinite(networkBefore) && Number.isFinite(networkAfter) && networkAfter >= networkBefore
    ? (networkAfter - networkBefore) / 1000000 : null;
  const vpnBefore = vpnBytesBefore && vpnBytesBefore.receivedBytes + vpnBytesBefore.sentBytes;
  const vpnAfter = vpnBytesAfter && vpnBytesAfter.receivedBytes + vpnBytesAfter.sentBytes;
  const vpnMB = Number.isFinite(vpnBefore) && Number.isFinite(vpnAfter) && vpnAfter >= vpnBefore
    ? (vpnAfter - vpnBefore) / 1000000 : null;
  const measuredMB = vpnMB ?? providerDeltaMB ?? networkMB;
  const chargedMB = Math.max(MAX_MEASURED_CYCLE_MB, Number.isFinite(measuredMB) ? Math.ceil(measuredMB) : 0);
  ledger.cycles.push({ startedAt, recordedAt: new Date(now).toISOString(), beforeMB, afterMB,
    providerDeltaMB, networkBytesBefore, networkBytesAfter, wifiUpperBoundMB: networkMB,
    vpnBytesBefore, vpnBytesAfter, measuredMB,
    measurementSource: vpnMB !== null ? 'tunnelbear_adapter' : providerDeltaMB !== null ? 'provider_ui'
      : networkMB !== null ? 'wifi_upper_bound_during_vpn' : 'unavailable',
    chargedMB, reason });
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
  const retabetGate = (await db.collection('_bookmaker_validation').doc('retabet_soccer').get()).data();
  const bwinGate = (await db.collection('_bookmaker_validation').doc('bwin_soccer').get()).data();
  const betclicGate = (await db.collection('_bookmaker_validation').doc('betclic_soccer').get()).data();
  const lebullGate = (await db.collection('_bookmaker_validation').doc('lebull_soccer').get()).data();
  const escGate = (await db.collection('_bookmaker_validation').doc('esc online_soccer').get()).data();
  const goldenparkGate = (await db.collection('_bookmaker_validation').doc('goldenpark_soccer').get()).data();
  if (!validationOnly && gate?.passed !== true) throw new Error('Betano futebol ainda não validado: 20 seleções exigidas.');
  let browser;
  let context;
  let vpnConnected = false;
  let beforeMB = null;
  let afterMB = null;
  let networkBytesBefore = null;
  let networkBytesAfter = null;
  let vpnBytesBefore = null;
  let vpnBytesAfter = null;
  let usageRecorded = false;
  const networkProcessSamples = [];
  let networkProcessTimer = null;
  let error;
  let cycle = { startedAt, taskName: TASK_NAME, computerName: process.env.COMPUTERNAME, validationOnly };
  try {
    assertTunnelBudget();
    networkBytesBefore = physicalNetworkBytes();
    try { beforeMB = tunnel('meter').remainingMB; } catch (meterError) { cycle.meterBeforeError = meterError.message; }
    cycle.vpn = tunnel('connect', startedAt, validationOnly ? 'betano_football_validation'
      : fs.existsSync(path.join(OUTPUT_DIR, 'feed-probe-request.json')) ? 'feed_probe'
        : fs.existsSync(BWIN_VALIDATION_REQUEST) ? 'bwin_validation' : 'production_cycle');
    vpnConnected = true;
    const sampleNetworkProcesses = () => networkProcessSamples.push({ at: new Date().toISOString(), rows: networkProcessSnapshot() });
    sampleNetworkProcesses();
    networkProcessTimer = setInterval(sampleNetworkProcesses, 5000);
    networkProcessTimer.unref();
    vpnBytesBefore = vpnNetworkBytes();
    const edge = await ensureEdge();
    browser = edge.browser;
    context = edge.context;
    const page = edge.page;
    await dismissCookieNotice(page);
    cycle.feedProbe = await scheduledFeedProbe(context, OUTPUT_DIR);
    if (cycle.feedProbe) {
      vpnBytesAfter = vpnNetworkBytes();
      cycle.disconnected = tunnel('disconnect');
      vpnConnected = false;
      clearInterval(networkProcessTimer);
      networkBytesAfter = physicalNetworkBytes();
      try { afterMB = tunnel('meter').remainingMB; } catch (meterError) { cycle.meterAfterError = meterError.message; }
      const usage = recordTunnelUsage({ startedAt, beforeMB, afterMB, networkBytesBefore, networkBytesAfter,
        vpnBytesBefore, vpnBytesAfter, reason: 'feed_probe' });
      usageRecorded = true;
      cycle = { ...cycle, probeOnly: true, finishedAt: new Date().toISOString(), beforeMB, afterMB,
        consumedMB: usage.cycles.at(-1).measuredMB, measurementSource: usage.cycles.at(-1).measurementSource,
        monthlyChargedMB: usage.cycles.at(-1).chargedMB, monthlyUsageMB: usage.totalMB };
      fs.writeFileSync(outputFile, JSON.stringify(cycle, null, 2));
      console.log(JSON.stringify({ outputFile, probeOnly: true, target: cycle.feedProbe.target,
        consumedMB: cycle.consumedMB, VPN: 'off' }));
      return;
    }

    let nba = await initialJson(page);
    let football = await freshJson(page, FOOTBALL_PATH);
    const availableFootball = readSelections(football).filter(game => {
      const delta = Date.parse(game.commenceTime) - Date.now();
      return delta > 600000 && delta <= 12 * 3600000;
    });
    if (bwinGate?.passed === true || fs.existsSync(BWIN_VALIDATION_REQUEST)) {
      try {
        const bwin = await readBwin(context, availableFootball);
        cycle.bwinDiagnostics = bwin.diagnostics;
        cycle.bwinGames = bwin.games.length;
        cycle.bwinSelections = bwin.games.reduce((sum, game) => sum + game.markets
          .reduce((total, market) => total + market.selections.length, 0), 0);
        if (!bwin.games.length) throw new Error('Bwin sem totais 2,5 elegíveis que confiram com Betano.');
        const bwinId = `local-bwin-${Date.now()}`;
        const bwinRef = db.collection('_bookmaker_reads').doc(bwinId);
        cycle.bwinReadId = bwinId;
        await bwinRef.set({ bookmaker: 'Bwin', observedAt: new Date().toISOString(),
          mode: bwinGate?.passed === true ? 'production' : 'validation', status: 'writing',
          gameCount: bwin.games.length, source: 'Bwin fixtures JSON: Total golos; 2GV excluído' });
        await Promise.all(bwin.games.map((game, index) => bwinRef.collection('games').doc(`game-${index}`).set(game)));
        await bwinRef.set({ status: 'ready', gamesWrittenAt: new Date().toISOString() }, { merge: true });
      } catch (bwinError) {
        cycle.bwinError = bwinError.message;
        await db.collection('local_bookmaker_status').doc('bwin').set({ enabled: false,
          lastFailureAt: new Date().toISOString(), lastFailure: bwinError.message.slice(0, 500),
          taskName: TASK_NAME, computerName: process.env.COMPUTERNAME }, { merge: true });
      }
      if (fs.existsSync(BWIN_VALIDATION_REQUEST)) fs.unlinkSync(BWIN_VALIDATION_REQUEST);
    }
    if (betclicGate?.passed === true) {
      try {
        const betclic = await readBetclic(context, availableFootball, 8);
        cycle.betclicDiagnostics = betclic.diagnostics;
        cycle.betclicGames = betclic.games.length;
        cycle.betclicSelections = betclic.games.reduce((sum, game) => sum + game.markets
          .reduce((total, market) => total + market.selections.length, 0), 0);
        if (!betclic.games.length) throw new Error('Betclic sem jogos pré-jogo elegíveis.');
        const betclicId = `local-betclic-${Date.now()}`;
        const betclicRef = db.collection('_bookmaker_reads').doc(betclicId);
        cycle.betclicReadId = betclicId;
        await betclicRef.set({ bookmaker: 'Betclic', observedAt: new Date().toISOString(),
          mode: 'production', status: 'writing', gameCount: betclic.games.length,
          source: 'Betclic HTML pré-jogo: resultado regulamentar e total de golos' });
        await Promise.all(betclic.games.map((game, index) => betclicRef.collection('games').doc(`game-${index}`).set(game)));
        await betclicRef.set({ status: 'ready', gamesWrittenAt: new Date().toISOString() }, { merge: true });
      } catch (betclicError) {
        cycle.betclicError = betclicError.message;
        await db.collection('local_bookmaker_status').doc('betclic').set({ enabled: false,
          lastFailureAt: new Date().toISOString(), lastFailure: betclicError.message.slice(0, 500),
          taskName: TASK_NAME, computerName: process.env.COMPUTERNAME }, { merge: true });
      }
    }
    if (lebullGate?.passed === true) {
      try {
        const lebull = await readLebull(context, availableFootball, 8);
        cycle.lebullDiagnostics = lebull.diagnostics;
        cycle.lebullGames = lebull.games.length;
        cycle.lebullSelections = lebull.games.reduce((sum, game) => sum + game.markets
          .reduce((total, market) => total + market.selections.length, 0), 0);
        if (!lebull.games.length) throw new Error('LeBull sem jogos pré-jogo elegíveis.');
        const lebullId = `local-lebull-${Date.now()}`;
        const lebullRef = db.collection('_bookmaker_reads').doc(lebullId);
        cycle.lebullReadId = lebullId;
        await lebullRef.set({ bookmaker: 'LeBull', observedAt: new Date().toISOString(),
          mode: 'production', status: 'writing', gameCount: lebull.games.length,
          source: 'LeBull iframe HTML pré-jogo: 1X2 e Total de Golos Mais/Menos' });
        await Promise.all(lebull.games.map((game, index) => lebullRef.collection('games').doc(`game-${index}`).set(game)));
        await lebullRef.set({ status: 'ready', gamesWrittenAt: new Date().toISOString() }, { merge: true });
      } catch (lebullError) {
        cycle.lebullError = lebullError.message;
        await db.collection('local_bookmaker_status').doc('lebull').set({ enabled: false,
          lastFailureAt: new Date().toISOString(), lastFailure: lebullError.message.slice(0, 500),
          taskName: TASK_NAME, computerName: process.env.COMPUTERNAME }, { merge: true });
      }
    }
    if (escGate?.passed === true) {
      try {
        const esc = await readEscOnline(context, availableFootball, 8);
        cycle.escDiagnostics = esc.diagnostics;
        cycle.escGames = esc.games.length;
        cycle.escSelections = esc.games.reduce((sum, game) => sum + game.markets
          .reduce((total, market) => total + market.selections.length, 0), 0);
        if (!esc.games.length) throw new Error('ESC Online sem totais regulamentares elegíveis.');
        const escId = `local-esc_online-${Date.now()}`;
        const escRef = db.collection('_bookmaker_reads').doc(escId);
        cycle.escReadId = escId;
        await escRef.set({ bookmaker: 'ESC Online', observedAt: new Date().toISOString(),
          mode: 'production', status: 'writing', gameCount: esc.games.length,
          source: 'ESC Online Total de Golos; Resultado Final 2Up excluído' });
        await Promise.all(esc.games.map((game, index) => escRef.collection('games').doc(`game-${index}`).set(game)));
        await escRef.set({ status: 'ready', gamesWrittenAt: new Date().toISOString() }, { merge: true });
      } catch (escError) {
        cycle.escError = escError.message;
        await db.collection('local_bookmaker_status').doc('esc_online').set({ enabled: false,
          lastFailureAt: new Date().toISOString(), lastFailure: escError.message.slice(0, 500),
          taskName: TASK_NAME, computerName: process.env.COMPUTERNAME }, { merge: true });
      }
    }
    if (goldenparkGate?.passed === true) {
      try {
        const goldenpark = await readGoldenpark(context, availableFootball, 9);
        cycle.goldenparkDiagnostics = goldenpark.diagnostics;
        cycle.goldenparkGames = goldenpark.games.length;
        cycle.goldenparkSelections = goldenpark.games.reduce((sum, game) => sum + game.markets
          .reduce((total, market) => total + market.selections.length, 0), 0);
        if (!goldenpark.games.length) throw new Error('GoldenPark sem jogos pré-jogo elegíveis.');
        const goldenparkId = `local-goldenpark-${Date.now()}`;
        const goldenparkRef = db.collection('_bookmaker_reads').doc(goldenparkId);
        cycle.goldenparkReadId = goldenparkId;
        await goldenparkRef.set({ bookmaker: 'GoldenPark', observedAt: new Date().toISOString(),
          mode: 'production', status: 'writing', gameCount: goldenpark.games.length,
          source: 'GoldenPark HTML pré-jogo: Resultado do jogo e Total de Golos' });
        await Promise.all(goldenpark.games.map((game, index) => goldenparkRef.collection('games').doc(`game-${index}`).set(game)));
        await goldenparkRef.set({ status: 'ready', gamesWrittenAt: new Date().toISOString() }, { merge: true });
      } catch (goldenparkError) {
        cycle.goldenparkError = goldenparkError.message;
        await db.collection('local_bookmaker_status').doc('goldenpark').set({ enabled: false,
          lastFailureAt: new Date().toISOString(), lastFailure: goldenparkError.message.slice(0, 500),
          taskName: TASK_NAME, computerName: process.env.COMPUTERNAME }, { merge: true });
      }
    }
    const retabet = await readRetabet(context, availableFootball, 4, gate?.sample?.map(row => row.teams) || []);
    cycle.retabetDiagnostics = retabet.diagnostics;
    cycle.retabetGames = retabet.games.length;
    if (retabet.games.length < 4 && retabetGate?.passed !== true) {
      throw new Error(`Retabet: ${retabet.games.length} jogos completos; são necessários 4 para validar 20 seleções.`);
    }
    if (retabet.games.length) {
      const retabetId = `local-retabet-${Date.now()}`;
      const retabetRef = db.collection('_bookmaker_reads').doc(retabetId);
      cycle.retabetReadId = retabetId;
      cycle.retabetSelections = retabet.games.reduce((sum, game) => sum + game.markets
        .reduce((total, market) => total + market.selections.length, 0), 0);
      await retabetRef.set({ bookmaker: 'Retabet', observedAt: new Date().toISOString(),
        mode: retabetGate?.passed === true ? 'production' : 'validation', status: 'writing',
        gameCount: retabet.games.length, source: 'HTML pré-jogo Retabet' });
      await Promise.all(retabet.games.map((game, index) => retabetRef.collection('games').doc(`game-${index}`).set(game)));
      await retabetRef.set({ status: 'ready', gamesWrittenAt: new Date().toISOString() }, { merge: true });
    }
    nba = await freshJson(page, DATA_PATH);
    football = await freshJson(page, FOOTBALL_PATH);
    fs.writeFileSync(path.join(OUTPUT_DIR, 'football-latest.json'), JSON.stringify(football));
    const games = [...(validationOnly ? [] : readSelections(nba)), ...readSelections(football)].map(adaptTotalsAndHandicaps).filter(game => {
      const delta = Date.parse(game.commenceTime) - Date.now();
      return delta > 0 && delta <= 12 * 3600000;
    });
    if (!games.length) throw new Error('Endpoint Betano sem jogos elegíveis nas próximas 12h.');
    await page.goto('about:blank');
    vpnBytesAfter = vpnNetworkBytes();
    cycle.disconnected = tunnel('disconnect');
    vpnConnected = false;
    clearInterval(networkProcessTimer);
    networkBytesAfter = physicalNetworkBytes();
    try { afterMB = tunnel('meter').remainingMB; } catch (meterError) { cycle.meterAfterError = meterError.message; }

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
    if (!Number.isInteger(comparison.comparedSelections) || comparison.comparedSelections < 1) {
      throw new Error('Comparação na nuvem concluiu sem nenhuma seleção Pinnacle válida; ciclo não conta como sucesso.');
    }
    cycle.comparison = { status: comparison.status, processedAt: comparison.processedAt,
      comparedSelections: comparison.comparedSelections, opportunities: comparison.opportunities };
    if (cycle.retabetReadId) {
      const retabetRef = db.collection('_bookmaker_reads').doc(cycle.retabetReadId);
      let retabetComparison;
      while (Date.now() < deadline) {
        retabetComparison = (await retabetRef.get()).data();
        if (['processed', 'processed_with_errors'].includes(retabetComparison.status)) break;
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
      const minimumCompared = retabetGate?.passed === true ? 1 : 20;
      if (retabetComparison?.status !== 'processed' || retabetComparison.comparedSelections < minimumCompared) {
        throw new Error(`Retabet não atingiu ${minimumCompared} seleções comparadas: ${retabetComparison?.status}; ${retabetComparison?.comparedSelections || 0}; ${JSON.stringify(retabetComparison?.errors || [])}`);
      }
      if (retabetGate?.passed !== true && (await db.collection('_bookmaker_validation').doc('retabet_soccer').get()).data()?.passed !== true) {
        throw new Error('Validação Retabet de 20 seleções não aprovada.');
      }
      cycle.retabetComparison = { status: retabetComparison.status,
        comparedSelections: retabetComparison.comparedSelections,
        processedAt: retabetComparison.processedAt };
    }
    if (cycle.bwinReadId) {
      const bwinRef = db.collection('_bookmaker_reads').doc(cycle.bwinReadId);
      let bwinComparison;
      while (Date.now() < deadline) {
        bwinComparison = (await bwinRef.get()).data();
        if (['processed', 'processed_with_errors'].includes(bwinComparison.status)) break;
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
      cycle.bwinComparison = { status: bwinComparison?.status || 'pending',
        comparedSelections: bwinComparison?.comparedSelections || 0,
        processedAt: bwinComparison?.processedAt || null,
        errors: bwinComparison?.errors || [] };
    }
    if (cycle.betclicReadId) {
      const betclicRef = db.collection('_bookmaker_reads').doc(cycle.betclicReadId);
      let betclicComparison;
      while (Date.now() < deadline) {
        betclicComparison = (await betclicRef.get()).data();
        if (['processed', 'processed_with_errors'].includes(betclicComparison.status)) break;
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
      cycle.betclicComparison = { status: betclicComparison?.status || 'pending',
        comparedSelections: betclicComparison?.comparedSelections || 0,
        processedAt: betclicComparison?.processedAt || null,
        errors: betclicComparison?.errors || [] };
    }
    if (cycle.lebullReadId) {
      const lebullRef = db.collection('_bookmaker_reads').doc(cycle.lebullReadId);
      let lebullComparison;
      while (Date.now() < deadline) {
        lebullComparison = (await lebullRef.get()).data();
        if (['processed', 'processed_with_errors'].includes(lebullComparison.status)) break;
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
      cycle.lebullComparison = { status: lebullComparison?.status || 'pending',
        comparedSelections: lebullComparison?.comparedSelections || 0,
        processedAt: lebullComparison?.processedAt || null,
        errors: lebullComparison?.errors || [] };
    }
    if (cycle.escReadId) {
      const escRef = db.collection('_bookmaker_reads').doc(cycle.escReadId);
      let escComparison;
      while (Date.now() < deadline) {
        escComparison = (await escRef.get()).data();
        if (['processed', 'processed_with_errors'].includes(escComparison.status)) break;
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
      cycle.escComparison = { status: escComparison?.status || 'pending',
        comparedSelections: escComparison?.comparedSelections || 0,
        processedAt: escComparison?.processedAt || null,
        errors: escComparison?.errors || [] };
    }
    if (cycle.goldenparkReadId) {
      const goldenparkRef = db.collection('_bookmaker_reads').doc(cycle.goldenparkReadId);
      let goldenparkComparison;
      while (Date.now() < deadline) {
        goldenparkComparison = (await goldenparkRef.get()).data();
        if (['processed', 'processed_with_errors'].includes(goldenparkComparison.status)) break;
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
      cycle.goldenparkComparison = { status: goldenparkComparison?.status || 'pending',
        comparedSelections: goldenparkComparison?.comparedSelections || 0,
        processedAt: goldenparkComparison?.processedAt || null,
        errors: goldenparkComparison?.errors || [] };
    }
    if (validationOnly && (await db.collection('_bookmaker_validation').doc('betano_soccer').get()).data()?.passed !== true) {
      throw new Error('Validação futebol insuficiente: consulte _bookmaker_validation/betano_soccer.');
    }
    const usage = recordTunnelUsage({ startedAt, beforeMB, afterMB, networkBytesBefore, networkBytesAfter,
      vpnBytesBefore, vpnBytesAfter });
    usageRecorded = true;
    if (!Number.isFinite(usage.cycles.at(-1).measuredMB) || usage.cycles.at(-1).measuredMB <= 0) {
      throw new Error('Consumo de rede do ciclo não pôde ser medido de forma confiável.');
    }
    cycle = { ...cycle, finishedAt: new Date().toISOString(),
      beforeMB, afterMB, networkBytesBefore, networkBytesAfter, vpnBytesBefore, vpnBytesAfter,
      consumedMB: usage.cycles.at(-1).measuredMB, measurementSource: usage.cycles.at(-1).measurementSource,
      providerDeltaMB: usage.cycles.at(-1).providerDeltaMB, monthlyChargedMB: usage.cycles.at(-1).chargedMB,
      monthlyUsageMB: usage.totalMB, endpoints: [DATA_PATH, FOOTBALL_PATH] };
    if (cycle.consumedMB > 30) {
      cycle.networkProcesses = summarizeNetworkProcesses(networkProcessSamples);
      cycle.networkProcessEvidence = 'Amostras de conexões TCP estabelecidas durante VPN; bytes por processo indisponíveis no Windows.';
    }
    if (!validationOnly) await db.collection('local_bookmaker_status').doc('betano').set({
      lastSuccessAt: cycle.finishedAt, vpnDisconnected: true, taskName: TASK_NAME, computerName: process.env.COMPUTERNAME,
      lastReadAt: cycle.finishedAt, lastTunnelBearMB: cycle.consumedMB, lastReadId: cycleId,
      lastMeasurementSource: cycle.measurementSource, lastProviderDeltaMB: cycle.providerDeltaMB,
      comparedSelections: comparison.comparedSelections, selections: cycle.selections, schedule: '11,13,15,17,19,21,23 America/Sao_Paulo',
    }, { merge: true });
    if (cycle.retabetComparison && retabetGate?.passed === true) await db.collection('local_bookmaker_status').doc('retabet').set({
      lastSuccessAt: cycle.finishedAt, vpnDisconnected: true, taskName: TASK_NAME,
      computerName: process.env.COMPUTERNAME, lastReadId: cycle.retabetReadId,
      comparedSelections: cycle.retabetComparison.comparedSelections, selections: cycle.retabetSelections,
      lastTunnelBearMB: cycle.consumedMB, schedule: '11,13,15,17,19,21,23 America/Sao_Paulo',
    }, { merge: true });
    if (cycle.bwinComparison) await db.collection('local_bookmaker_status').doc('bwin').set({
      lastReadAt: cycle.finishedAt, taskName: TASK_NAME, computerName: process.env.COMPUTERNAME,
      lastReadId: cycle.bwinReadId, selections: cycle.bwinSelections,
      comparedSelections: cycle.bwinComparison.comparedSelections, lastTunnelBearMB: cycle.consumedMB,
      lastValidationStatus: cycle.bwinComparison.status,
      enabled: bwinGate?.passed === true && cycle.bwinComparison.status === 'processed',
      ...(bwinGate?.passed === true && cycle.bwinComparison.status === 'processed'
        ? { lastSuccessAt: cycle.finishedAt, vpnDisconnected: true }
        : { lastFailureAt: cycle.finishedAt,
          lastFailure: 'Validação de 20 totais 2,5 aguarda gate na nuvem; mercado 2GV excluído.' }),
    }, { merge: true });
    if (cycle.betclicComparison) await db.collection('local_bookmaker_status').doc('betclic').set({
      lastReadAt: cycle.finishedAt, taskName: TASK_NAME, computerName: process.env.COMPUTERNAME,
      lastReadId: cycle.betclicReadId, selections: cycle.betclicSelections,
      comparedSelections: cycle.betclicComparison.comparedSelections, lastTunnelBearMB: cycle.consumedMB,
      lastValidationStatus: cycle.betclicComparison.status,
      enabled: betclicGate?.passed === true && cycle.betclicComparison.status === 'processed'
        && cycle.betclicComparison.comparedSelections > 0,
      ...(betclicGate?.passed === true && cycle.betclicComparison.status === 'processed'
        && cycle.betclicComparison.comparedSelections > 0
        ? { lastSuccessAt: cycle.finishedAt, vpnDisconnected: true }
        : { lastFailureAt: cycle.finishedAt, lastFailure: 'Comparação Betclic não concluiu com seleções Pinnacle válidas.' }),
    }, { merge: true });
    if (cycle.lebullComparison) await db.collection('local_bookmaker_status').doc('lebull').set({
      lastReadAt: cycle.finishedAt, taskName: TASK_NAME, computerName: process.env.COMPUTERNAME,
      lastReadId: cycle.lebullReadId, selections: cycle.lebullSelections,
      comparedSelections: cycle.lebullComparison.comparedSelections, lastTunnelBearMB: cycle.consumedMB,
      lastValidationStatus: cycle.lebullComparison.status,
      enabled: lebullGate?.passed === true && cycle.lebullComparison.status === 'processed'
        && cycle.lebullComparison.comparedSelections > 0,
      ...(lebullGate?.passed === true && cycle.lebullComparison.status === 'processed'
        && cycle.lebullComparison.comparedSelections > 0
        ? { lastSuccessAt: cycle.finishedAt, vpnDisconnected: true }
        : { lastFailureAt: cycle.finishedAt, lastFailure: 'Comparação LeBull não concluiu com seleções Pinnacle válidas.' }),
    }, { merge: true });
    if (cycle.escComparison) await db.collection('local_bookmaker_status').doc('esc_online').set({
      lastReadAt: cycle.finishedAt, taskName: TASK_NAME, computerName: process.env.COMPUTERNAME,
      lastReadId: cycle.escReadId, selections: cycle.escSelections,
      comparedSelections: cycle.escComparison.comparedSelections, lastTunnelBearMB: cycle.consumedMB,
      lastValidationStatus: cycle.escComparison.status,
      enabled: escGate?.passed === true && cycle.escComparison.status === 'processed'
        && cycle.escComparison.comparedSelections > 0,
      ...(escGate?.passed === true && cycle.escComparison.status === 'processed'
        && cycle.escComparison.comparedSelections > 0
        ? { lastSuccessAt: cycle.finishedAt, vpnDisconnected: true }
        : { lastFailureAt: cycle.finishedAt, lastFailure: 'Comparação ESC Online não concluiu com seleções Pinnacle válidas.' }),
    }, { merge: true });
    if (cycle.goldenparkComparison) await db.collection('local_bookmaker_status').doc('goldenpark').set({
      lastReadAt: cycle.finishedAt, taskName: TASK_NAME, computerName: process.env.COMPUTERNAME,
      lastReadId: cycle.goldenparkReadId, selections: cycle.goldenparkSelections,
      comparedSelections: cycle.goldenparkComparison.comparedSelections, lastTunnelBearMB: cycle.consumedMB,
      lastValidationStatus: cycle.goldenparkComparison.status,
      enabled: goldenparkGate?.passed === true && cycle.goldenparkComparison.status === 'processed'
        && cycle.goldenparkComparison.comparedSelections > 0,
      ...(goldenparkGate?.passed === true && cycle.goldenparkComparison.status === 'processed'
        && cycle.goldenparkComparison.comparedSelections > 0
        ? { lastSuccessAt: cycle.finishedAt, vpnDisconnected: true }
        : { lastFailureAt: cycle.finishedAt, lastFailure: 'Comparação GoldenPark não concluiu com seleções Pinnacle válidas.' }),
    }, { merge: true });
    fs.writeFileSync(outputFile, JSON.stringify(cycle, null, 2));
    console.log(JSON.stringify({ outputFile, finishedAt: cycle.finishedAt, games: cycle.games,
      consumedMB: cycle.consumedMB, firestoreReadId: cycle.firestoreReadId, VPN: 'off' }));
  } catch (caught) {
    error = caught;
  } finally {
    if (context) await context.unroute('**/*').catch(() => {});
    if (browser) await browser.close().catch(() => {});
    if (networkProcessTimer) clearInterval(networkProcessTimer);
    if (vpnConnected) {
      try { if (vpnBytesBefore && !vpnBytesAfter) vpnBytesAfter = vpnNetworkBytes();
        cycle.disconnected = tunnel('disconnect'); vpnConnected = false; } catch (disconnectError) {
        error = new Error(`${error?.message || 'ciclo falhou'}; VPN não desligou: ${disconnectError.message}`);
      }
    }
    if (networkBytesBefore && !usageRecorded) {
      try { if (!networkBytesAfter && !vpnConnected) networkBytesAfter = physicalNetworkBytes();
        const usage = recordTunnelUsage({ startedAt, beforeMB, afterMB, networkBytesBefore, networkBytesAfter,
          vpnBytesBefore, vpnBytesAfter,
        reason: error ? 'failed' : 'incomplete' });
        if (usage.cycles.at(-1).measuredMB > 30) {
          cycle.networkProcesses = summarizeNetworkProcesses(networkProcessSamples);
          cycle.networkProcessEvidence = 'Amostras de conexões TCP estabelecidas durante VPN; bytes por processo indisponíveis no Windows.';
        } }
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

module.exports = { readSelections, adaptTotalsAndHandicaps, assertTunnelBudget, recordTunnelUsage,
  tunnelCycleAffordable, monthKey, MAX_MEASURED_CYCLE_MB,
  ensureEdge, initialJson, freshJson, tunnel, database, authenticate, physicalNetworkBytes, vpnNetworkBytes,
  networkProcessSnapshot, summarizeNetworkProcesses, updateFailure };
if (require.main === module) {
  const run = process.argv.includes('--legacy') || process.argv.includes('--validate-football')
    ? main : require('./local_bookmaker_cycle_fast.cjs').main;
  const { acquire } = require('../scripts/local_bookmakers/resource_lock.cjs');
  (async () => {
    const release = await acquire(process.env.EDGE_DATA_ROOT || PROJECT);
    if (!release) throw new Error('Ciclo pulado: trava ocupada após 5 minutos.');
    try { await run(); } finally { release(); }
  })().then(() => process.exit(0)).catch(error => { console.error(error.message); process.exit(1); });
}
