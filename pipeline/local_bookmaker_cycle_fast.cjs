// One scheduled VPN connection: independent bounded reads, disconnect, then Firestore.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync, execFile } = require('node:child_process');
const { performance } = require('node:perf_hooks');
const { loadEnvFileIfPresent } = require('./odds_api_client');
const core = require('./local_betano_reader.js');
const readers = require('../scripts/local_bookmakers/fast_readers.cjs');
const { failureReasons } = require('../scripts/local_bookmakers/daily_summary.cjs');
const { PRIORITY } = require('../scripts/local_bookmakers/local_competitions.cjs');
const { vpnBudgetForDay, shouldRunForPinnacleWindow } = require('../scripts/local_bookmakers/daily_budget.cjs');
const { flushCycleQueue } = require('../scripts/local_bookmakers/cloud_cycle_queue.cjs');
const { matchingEvents, namesEqual } = require('../functions/placard_value.js');

const ROOT = path.resolve(__dirname, '..');
const LOG_DIR = path.join(ROOT, '.local_logs', 'betano');
const WINDOW_SCRIPT = path.join(ROOT, 'scripts', 'local_bookmakers', 'edge_window.ps1');
const TASK_NAME = 'EdgeFinder-Betano-Local';
const HOUSE_NAMES = {
  betano: 'Betano', retabet: 'Retabet', bwin: 'Bwin', lebull: 'LeBull',
  esc_online: 'ESC Online', goldenpark: 'GoldenPark', betclic: 'Betclic',
};
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const PROCESS_SCRIPT = "$rows=Get-NetTCPConnection -State Established -ErrorAction SilentlyContinue | Where-Object { $_.RemoteAddress -notin @('127.0.0.1','::1') } | Group-Object OwningProcess | ForEach-Object { $pidValue=[int]$_.Name; $process=Get-Process -Id $pidValue -ErrorAction SilentlyContinue; if ($process) { [pscustomobject]@{ pid=$pidValue; name=$process.ProcessName; connections=$_.Count } } }; @($rows) | ConvertTo-Json -Compress";

function networkProcessSnapshotAsync() {
  return new Promise(resolve => execFile('powershell.exe', ['-NoProfile', '-Command', PROCESS_SCRIPT],
    { encoding: 'utf8', timeout: 12000 }, (error, stdout) => {
      if (error) return resolve([]);
      try { resolve([].concat(JSON.parse(stdout.trim() || '[]')).filter(Boolean)); }
      catch { resolve([]); }
    }));
}

function edgeWindow(action) {
  const result = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', WINDOW_SCRIPT, action],
    { encoding: 'utf8', timeout: 15000 });
  if (result.status !== 0) throw new Error((result.stderr || result.stdout || 'Estado Edge indisponível').trim());
  return JSON.parse(result.stdout.trim());
}

async function boundedRead(context, read, timeoutMs = 120000,
  minimizeWindow = edgeWindow, onProgress = () => {}, metrics = {}) {
  const pages = [];
  const pending = new Set();
  metrics.browserBytes = 0;
  metrics.browserByteErrors = 0;
  metrics.browserByteBasis = 'Playwright request.sizes: HTTP lógico; frames WebSocket: payload';
  const scoped = { request: context.request, report: onProgress, newPage: async () => {
    const page = await context.newPage();
    pages.push(page);
    page.on('requestfinished', request => {
      const work = request.sizes().then(sizes => {
        metrics.browserBytes += sizes.requestHeadersSize + sizes.requestBodySize
          + sizes.responseHeadersSize + sizes.responseBodySize;
      }).catch(() => { metrics.browserByteErrors++; });
      pending.add(work);
      work.finally(() => pending.delete(work));
    });
    page.on('requestfailed', () => { metrics.browserByteErrors++; });
    page.on('websocket', socket => {
      const count = frame => { metrics.browserBytes += typeof frame.payload === 'string'
        ? Buffer.byteLength(frame.payload) : frame.payload.length; };
      socket.on('framesent', count);
      socket.on('framereceived', count);
    });
    try { minimizeWindow('minimize'); } catch { /* janela verificada ao fim das leituras */ }
    return page;
  } };
  let timer;
  const task = Promise.resolve().then(() => read(scoped));
  task.catch(() => {});
  try {
    return await Promise.race([task, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Leitura abandonada ao atingir ${timeoutMs / 1000} segundos.`)), timeoutMs);
    })]);
  } finally {
    clearTimeout(timer);
    await Promise.all(pages.map(page => page.close().catch(() => {})));
    await Promise.allSettled([...pending]);
  }
}

function readCycleBudget(cycle) {
  const file = path.join(LOG_DIR, 'vpn-budget.json');
  const budget = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8'))
    : { limitMB: 2700, expiresAt: '2026-11-01T00:00:00-03:00', initialBalanceMB: null };
  cycle.balanceMB = null;
  cycle.balanceReadDurationMs = 0;
  if (!Number.isFinite(budget.carriedForwardMB)) {
    const history = path.join(LOG_DIR, 'hourly-cycles.jsonl');
    const recorded = fs.existsSync(history) ? fs.readFileSync(history, 'utf8').trim().split(/\r?\n/)
      .map(line => { try { return JSON.parse(line).accumulatedMB; } catch { return null; } })
      .filter(value => Number.isFinite(value)) : [];
    budget.carriedForwardMB = Math.max(0, recorded.at(-1) || 0);
    budget.measuredMB = 0;
    budget.adapterCycles = [];
    budget.measurementSource = 'TunnelBear Adapter V9 / GetIPv4Statistics';
  }
  cycle.accumulatedMB = budget.carriedForwardMB + budget.measuredMB;
  const daily = vpnBudgetForDay(budget, new Date(cycle.startedAt));
  budget.month = daily.month;
  budget.limitMB = daily.limitMB;
  budget.expiresAt = '2026-11-01T00:00:00-03:00';
  cycle.dailyVpn = daily;
  cycle.budget = budget;
  if (budget.measurementError) {
    cycle.previousBudgetError = budget.measurementError;
    delete budget.measurementError;
  }
  fs.writeFileSync(file, JSON.stringify(budget, null, 2));
  return daily.reason;
}

function classifyVpnCharge(connected, before, after) {
  if (!connected) return { bytes: 0, estimated: false, reason: 'ciclo sem conexão' };
  const total = value => value && value.receivedBytes + value.sentBytes;
  const start = total(before), end = total(after);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start)
    return { bytes: 60000000, estimated: true, reason: 'bytes da placa indisponíveis; estimativa conservadora' };
  return { bytes: end - start, estimated: false, reason: null };
}

function chargeCycleBudget(cycle, before, after) {
  const budget = cycle.budget;
  const charge = classifyVpnCharge(Boolean(cycle.vpnConnectedAt), before, after);
  cycle.vpnAdapterBytes = charge.bytes;
  cycle.vpnAdapterMB = charge.bytes / 1000000;
  cycle.vpnEstimate = charge.estimated;
  cycle.budgetNote = charge.reason;
  if (cycle.vpnConnectedAt) {
    budget.adapterCycles.push({ startedAt: cycle.startedAt, bytes: charge.bytes,
      estimated: charge.estimated, before, after });
    budget.measuredMB = budget.adapterCycles.reduce((sum, entry) => sum + entry.bytes / 1000000, 0);
  }
  cycle.accumulatedMB = budget.carriedForwardMB + budget.measuredMB;
  cycle.dailyVpn = vpnBudgetForDay(budget, new Date(cycle.startedAt));
  fs.writeFileSync(path.join(LOG_DIR, 'vpn-budget.json'), JSON.stringify(budget, null, 2));
}

async function writeRead(db, key, data) {
  const readId = `local-${key}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const ref = db.collection('_bookmaker_reads').doc(readId);
  await ref.set({ bookmaker: HOUSE_NAMES[key], observedAt: new Date().toISOString(), mode: 'production',
    status: 'writing', gameCount: data.games.length, source: data.source });
  await Promise.all(data.games.map((game, index) => ref.collection('games').doc(`game-${index}`).set(game)));
  await ref.set({ status: 'ready', gamesWrittenAt: new Date().toISOString() }, { merge: true });
  return readId;
}

async function awaitComparison(db, id, deadline) {
  const ref = db.collection('_bookmaker_reads').doc(id);
  while (Date.now() < deadline) {
    const read = (await ref.get()).data();
    if (['processed', 'processed_with_errors'].includes(read?.status)) return {
      status: read.status, comparedSelections: read.comparedSelections || 0,
      processedAt: read.processedAt || null, errors: read.errors || [], opportunities: read.opportunities || 0,
    };
    await wait(4000);
  }
  return { status: 'timeout', comparedSelections: 0, errors: ['Comparação não concluiu em 120 segundos.'] };
}

async function main() {
  loadEnvFileIfPresent(path.join(ROOT, '.env'));
  fs.mkdirSync(LOG_DIR, { recursive: true });
  const startedAt = new Date().toISOString();
  const start = performance.now();
  const outputFile = path.join(LOG_DIR, `cycle-${startedAt.replace(/[:.]/g, '-')}.json`);
  const cycle = { startedAt, taskName: TASK_NAME, computerName: process.env.COMPUTERNAME,
    architecture: 'independent_own_listings_v2', stages: {}, reads: {}, feedAttempts: {},
    leagueAudit: {}, pinnacleWindow: {} };
  const stage = async (name, work) => {
    const at = performance.now();
    const record = { startedAt: new Date().toISOString() };
    cycle.stages[name] = record;
    try { return await work(); }
    catch (error) { record.error = error.message; throw error; }
    finally { record.finishedAt = new Date().toISOString(); record.durationMs = Math.round(performance.now() - at); }
  };
  let browser, context, db, vpnConnected = false, vpnBytesBefore = null, vpnBytesAfter = null;
  let networkBefore = null, networkAfter = null, beforeMB = null, afterMB = null;
  let networkTimer, usageRecorded = false, budgetCharged = false;
  const processSamples = [];
  let caught;
  let vpnStartedAt = null;
  try {
    cycle.localDateTime = spawnSync('powershell.exe', ['-NoProfile', '-Command', 'Get-Date -Format o'],
      { encoding: 'utf8', timeout: 4000 }).stdout.trim();
    const pauseReason = readCycleBudget(cycle);
    if (pauseReason) { cycle.status = 'ciclo pulado'; cycle.pauseReason = pauseReason; return; }
    await stage('preparation', async () => {
      db = core.database();
      const snapshot = await Promise.allSettled(PRIORITY.map(async ([key]) => {
        const doc = (await db.collection('_placard_pinnacle_latest').doc(key).get()).data() || {};
        const events = (doc.events || []).filter(event => {
          const delta = Date.parse(event.commence_time) - Date.now();
          return delta > 0 && delta <= 12 * 3600000;
        });
        return [key, { updatedAt: doc.updatedAt || null, events }];
      }));
      for (let i = 0; i < PRIORITY.length; i++) {
        const key = PRIORITY[i][0], result = snapshot[i];
        cycle.pinnacleWindow[key] = result.status === 'fulfilled'
          ? result.value[1] : { error: result.reason.message, events: [] };
      }
      cycle.pinnacleDecision = shouldRunForPinnacleWindow(cycle.pinnacleWindow);
      if (!cycle.pinnacleDecision.run) return;
      const edge = await core.ensureEdge();
      browser = edge.browser;
      context = edge.context;
      try { cycle.edgeWindow = edgeWindow('minimize'); }
      catch (error) { cycle.edgeWindow = { minimized: false, error: error.message }; }
      networkBefore = core.physicalNetworkBytes();
      beforeMB = cycle.balanceMB;
    });
    if (!cycle.pinnacleDecision.run) {
      cycle.status = 'ciclo pulado';
      cycle.pauseReason = cycle.pinnacleDecision.reason;
      return;
    }
    const connectionDecision = vpnBudgetForDay(cycle.budget, new Date());
    if (!connectionDecision.run) {
      cycle.status = 'ciclo pulado';
      cycle.pauseReason = connectionDecision.reason;
      return;
    }
    await stage('vpnConnect', async () => {
      vpnStartedAt = Date.now();
      try { cycle.vpn = core.tunnel('connect', startedAt, 'production_cycle'); }
      catch (error) {
        cycle.vpnFirstFailure = error.message;
        if (/adaptador=Up/i.test(error.message)) throw error;
        await wait(120000);
        cycle.vpn = core.tunnel('connect', startedAt, 'production_cycle');
      }
      vpnStartedAt = Date.parse(cycle.vpn.vpnStartedAt) || vpnStartedAt;
      vpnConnected = true;
      cycle.vpnConnectedAt = new Date().toISOString();
      cycle.vpnProofChecks = cycle.vpn.checks || [];
      vpnBytesBefore = core.vpnNetworkBytes();
    });
    const sampleProcesses = () => {
      const at = new Date().toISOString();
      networkProcessSnapshotAsync().then(rows => processSamples.push({ at, rows }));
    };
    sampleProcesses();
    networkTimer = setInterval(sampleProcesses, 10000);
    networkTimer.unref();

    const tasks = {};
    cycle.browserMetrics = {};
    const runHouse = (key, reader) => {
      cycle.feedAttempts[key] = [];
      const httpByUrl = new Map();
      cycle.leagueAudit[key] = Object.fromEntries(PRIORITY.map(([league]) => [league,
        { requests: [], seen: 0, events: [], reason: 'não consultada ou não encontrada no catálogo' }]));
      cycle.browserMetrics[key] = {};
      tasks[key] = stage(`read.${key}`, () => boundedRead(context, reader,
        120000, edgeWindow, detail => {
          const at = new Date().toISOString();
          cycle.feedAttempts[key].push({ at, ...detail });
          if (detail.phase === 'http') {
            httpByUrl.set(detail.url, detail.httpStatus);
            for (const audit of Object.values(cycle.leagueAudit[key])) {
              for (const request of audit.requests) if (request.url === detail.url)
                request.httpStatus = detail.httpStatus;
              for (const event of audit.events) if (event.url === detail.url)
                event.httpStatus = detail.httpStatus;
            }
          }
          if (detail.phase === 'league' && cycle.leagueAudit[key][detail.league]) {
            const audit = cycle.leagueAudit[key][detail.league];
            audit.requests.push({ at, url: detail.url || null,
              httpStatus: detail.httpStatus ?? httpByUrl.get(detail.url) ?? null,
              reason: detail.reason || null });
            audit.seen += detail.seen ?? 0;
            audit.events.push(...(detail.events || []).map(event => ({ ...event,
              httpStatus: event.httpStatus ?? httpByUrl.get(event.url) ?? null })));
            audit.reason = detail.reason || null;
          }
          if (detail.phase === 'event_decision' && cycle.leagueAudit[key][detail.league]) {
            const audit = cycle.leagueAudit[key][detail.league];
            const event = audit.events.find(row => row.url === detail.url);
            if (event) Object.assign(event, { teams: detail.teams,
              commenceTime: detail.commenceTime, reason: detail.reason });
            else audit.events.push({ url: detail.url, teams: detail.teams,
              commenceTime: detail.commenceTime, reason: detail.reason });
          }
          if (detail.phase === 'event_discard' && cycle.leagueAudit[key][detail.league]) {
            const audit = cycle.leagueAudit[key][detail.league];
            const event = audit.events.find(row => row.teams?.join('|') === detail.teams?.join('|'));
            if (event) event.reason = detail.reason;
          }
        },
        cycle.browserMetrics[key]));
      return tasks[key];
    };
    for (const [key, reader] of Object.entries({ betano: readers.betano, bwin: readers.bwin,
      lebull: readers.lebull, esc_online: readers.escOnline,
      goldenpark: readers.goldenpark, retabet: readers.retabet,
      betclic: readers.betclic })) runHouse(key, reader);
    const keys = Object.keys(tasks);
    const results = await Promise.allSettled(keys.map(key => tasks[key]));
    const collected = {};
    for (let index = 0; index < keys.length; index++) {
      const key = keys[index], result = results[index];
      if (result.status === 'fulfilled') {
        collected[key] = result.value;
        const foundPinnacle = Object.fromEntries(PRIORITY.map(([league]) => [league,
          result.value.games.filter(game => game.apiSport === league
            && (cycle.pinnacleWindow[league]?.events || []).filter(event =>
              Math.abs(Date.parse(event.commence_time) - Date.parse(game.commenceTime)) <= 10 * 60000
              && game.teams.length === 2 && ((namesEqual(game.teams[0], event.home_team)
                && namesEqual(game.teams[1], event.away_team))
                || (namesEqual(game.teams[0], event.away_team)
                  && namesEqual(game.teams[1], event.home_team)))).length === 1).length]));
        const matchedPinnacle = Object.fromEntries(PRIORITY.map(([league]) => [league,
          result.value.games.filter(game => game.apiSport === league
            && matchingEvents(game, cycle.pinnacleWindow[league]?.events || []).length === 1).length]));
        cycle.reads[key] = { status: result.value.games.length ? 'ready' : 'empty',
          method: result.value.method, games: result.value.games.length,
          foundPinnacle, matchedPinnacle,
          leagues: Object.fromEntries([...new Set(result.value.games.map(game => game.apiSport))]
            .map(sport => [sport, result.value.games.filter(game => game.apiSport === sport).length])),
          selections: readers.count(result.value.games), diagnostics: result.value.diagnostics };
      } else cycle.reads[key] = { status: 'failed', error: result.reason.message };
      Object.assign(cycle.reads[key], cycle.browserMetrics[key], {
        readingStatus: result.status === 'fulfilled' ? (result.value.games.length ? 'success' : 'empty')
          : /Timeout|timed? out|ao atingir/i.test(result.reason.message) ? 'timeout' : 'failed',
      });
    }
    try { cycle.edgeMinimizedAfterReads = edgeWindow('state').minimized; }
    catch (error) { cycle.edgeWindowCheckError = error.message; }
    vpnBytesAfter = core.vpnNetworkBytes();
    await stage('vpnDisconnect', async () => {
      cycle.disconnected = core.tunnel('disconnect');
      vpnConnected = false;
      cycle.vpnDisconnectedAt = new Date().toISOString();
      cycle.vpnDurationMs = (Date.parse(cycle.disconnected.vpnDisconnectedAt) || Date.now()) - vpnStartedAt;
    });
    chargeCycleBudget(cycle, vpnBytesBefore, vpnBytesAfter);
    budgetCharged = true;
    if (networkTimer) clearInterval(networkTimer);
    networkAfter = core.physicalNetworkBytes();
    if (!Object.values(collected).some(data => data.games.length))
      throw new Error('Nenhuma casa produziu odds elegíveis; ciclo não conta como sucesso.');
    const readIds = await stage('send', async () => {
      if (vpnConnected) throw new Error('Envio bloqueado: VPN ainda conectado.');
      const toSend = Object.entries(collected).filter(([, data]) => data.games.length);
      const entries = await Promise.allSettled(toSend.map(async ([key, data]) =>
        [key, await writeRead(db, key, data)]));
      for (let i = 0; i < entries.length; i++) if (entries[i].status === 'rejected')
        cycle.reads[toSend[i][0]].sendError = entries[i].reason.message;
      const sent = Object.fromEntries(entries.filter(result => result.status === 'fulfilled')
        .map(result => result.value));
      if (!Object.keys(sent).length) throw new Error('Nenhuma leitura foi enviada ao Firestore.');
      return sent;
    });
    for (const [key, id] of Object.entries(readIds)) cycle.reads[key].readId = id;
    const comparisons = await stage('comparison', async () => {
      const deadline = Date.now() + 120000;
      return Object.fromEntries(await Promise.all(Object.entries(readIds)
        .map(async ([key, id]) => [key, await awaitComparison(db, id, deadline)])));
    });
    for (const [key, result] of Object.entries(comparisons)) cycle.reads[key].comparison = result;
    const usage = core.recordTunnelUsage({ startedAt, beforeMB, afterMB,
      networkBytesBefore: networkBefore, networkBytesAfter: networkAfter, vpnBytesBefore, vpnBytesAfter });
    usageRecorded = true;
    cycle.consumedMB = usage.cycles.at(-1).measuredMB;
    cycle.measurementSource = usage.cycles.at(-1).measurementSource;
    cycle.monthlyUsageMB = usage.totalMB;
    if (cycle.consumedMB > 30) {
      cycle.networkProcesses = core.summarizeNetworkProcesses(processSamples);
      cycle.networkProcessEvidence = 'Conexões TCP observadas; Windows não atribuiu bytes por processo.';
    }
    await stage('heartbeat', async () => {
      const at = new Date().toISOString();
      await Promise.all(Object.entries(HOUSE_NAMES).map(async ([key]) => {
        const read = cycle.reads[key];
        const okay = read?.comparison?.status === 'processed' && read.comparison.comparedSelections > 0;
        const values = { enabled: true, lastReadAt: at, taskName: TASK_NAME,
          computerName: process.env.COMPUTERNAME, lastTunnelBearMB: cycle.consumedMB,
          lastReadId: read?.readId || null, selections: read?.selections || 0,
          comparedSelections: read?.comparison?.comparedSelections || 0,
          lastValidationStatus: read?.comparison?.status || 'not_compared',
          ...(okay ? { lastSuccessAt: at, vpnDisconnected: true }
            : { lastFailureAt: at, lastFailure: (read?.error || read?.comparison?.errors?.join('; ')
              || 'Nenhuma seleção Pinnacle processada neste ciclo.').slice(0, 500) }),
        };
        await db.collection('local_bookmaker_status').doc(key).set(values, { merge: true });
      }));
    });
    cycle.status = 'complete';
  } catch (error) {
    caught = error;
    cycle.status = cycle.stages.vpnConnect?.error ? 'ciclo sem conexão' : 'failed';
    cycle.error = error.message;
  } finally {
    if (networkTimer) clearInterval(networkTimer);
    if (vpnConnected) {
      try {
        vpnBytesAfter ||= core.vpnNetworkBytes();
        cycle.disconnected = await stage('vpnDisconnect', async () => core.tunnel('disconnect'));
        vpnConnected = false;
        cycle.vpnDisconnectedAt = new Date().toISOString();
        cycle.vpnDurationMs = (Date.parse(cycle.disconnected.vpnDisconnectedAt) || Date.now()) - vpnStartedAt;
      } catch (error) { cycle.disconnectError = error.message; }
    }
    if (vpnStartedAt && !budgetCharged && !vpnConnected) {
      chargeCycleBudget(cycle, vpnBytesBefore, vpnBytesAfter);
      budgetCharged = true;
    }
    if (networkBefore && !usageRecorded && !vpnConnected && cycle.vpnConnectedAt) {
      try {
        networkAfter ||= core.physicalNetworkBytes();
        const usage = core.recordTunnelUsage({ startedAt, beforeMB, afterMB,
          networkBytesBefore: networkBefore, networkBytesAfter: networkAfter,
          vpnBytesBefore, vpnBytesAfter, reason: 'failed' });
        cycle.consumedMB = usage.cycles.at(-1).measuredMB;
        cycle.monthlyUsageMB = usage.totalMB;
      } catch (error) { cycle.usageError = error.message; }
    }
    if (cycle.status === 'ciclo sem conexão') cycle.consumedMB = 0;
    if (cycle.status === 'ciclo pulado') {
      cycle.consumedMB = 0;
      cycle.vpnAdapterBytes = 0;
      cycle.vpnAdapterMB = 0;
    }
    if (caught && db) {
      try { await core.updateFailure(db, caught, !vpnConnected); }
      catch (error) { cycle.failureStatusError = error.message; }
    }
    if (browser) await browser.close().catch(() => {});
    cycle.finishedAt = new Date().toISOString();
    cycle.totalDurationMs = Math.round(performance.now() - start);
    cycle.targetMet = cycle.totalDurationMs <= 600000;
    cycle.vpnDurationMs ??= cycle.vpnConnectedAt ? Date.now() - vpnStartedAt : 0;
    if (!cycle.vpnProofChecks && vpnStartedAt) {
      const attempts = path.join(LOG_DIR, `tunnelbear_attempts_${startedAt.slice(0, 7)}.jsonl`);
      cycle.vpnProofChecks = fs.existsSync(attempts) ? fs.readFileSync(attempts, 'utf8').split(/\r?\n/)
        .flatMap(line => { try { const row = JSON.parse(line);
          return row.cycleId === startedAt && row.status === 'check' ? [JSON.parse(row.detail)] : [];
        } catch { return []; } }) : [];
    }
    fs.writeFileSync(outputFile, JSON.stringify(cycle, null, 2));
    const logLine = { at: cycle.localDateTime, status: cycle.status, balanceMB: cycle.balanceMB,
      accumulatedMB: cycle.accumulatedMB, balanceReadDurationMs: cycle.balanceReadDurationMs,
      vpnAdapterBytes: cycle.vpnAdapterBytes ?? null, vpnAdapterMB: cycle.vpnAdapterMB ?? null,
      vpnEstimate: cycle.vpnEstimate || false, vpnProofChecks: cycle.vpnProofChecks || [],
      dailyVpn: cycle.dailyVpn || null,
      budgetError: cycle.budgetError || null,
      balanceError: cycle.balanceError || null, reason: cycle.pauseReason || cycle.error || null,
      totalDurationMs: cycle.totalDurationMs, vpnDurationMs: cycle.vpnDurationMs,
      houses: Object.fromEntries(Object.entries(cycle.reads).map(([key, read]) => [key,
        { browserBytes: read.browserBytes, readingStatus: read.readingStatus,
          browserByteErrors: read.browserByteErrors, failureReasons: failureReasons(read) }])) };
    fs.appendFileSync(path.join(LOG_DIR, 'hourly-cycles.jsonl'), JSON.stringify(logLine) + '\n');
    const summary = spawnSync(process.execPath,
      [path.join(ROOT, 'scripts', 'local_bookmakers', 'daily_summary.cjs')],
      { encoding: 'utf8', timeout: 4500, killSignal: 'SIGKILL', windowsHide: true });
    if (summary.error || summary.status !== 0)
      console.error(`Resumo diário: ${summary.error?.message || summary.stderr.trim()}`);
    try { cycle.healthSync = await flushCycleQueue(db || core.database(), cycle, LOG_DIR); }
    catch (error) { cycle.healthSync = { error: error.message }; }
    fs.writeFileSync(outputFile, JSON.stringify(cycle, null, 2));
    console.log(JSON.stringify({ outputFile, status: cycle.status, totalDurationMs: cycle.totalDurationMs,
      consumedMB: cycle.consumedMB, vpnDisconnected: !vpnConnected }));
  }
  if (caught) throw caught;
  if (!cycle.targetMet) throw new Error(`Ciclo ultrapassou 10 minutos: ${cycle.totalDurationMs} ms.`);
}

module.exports = { main, boundedRead, edgeWindow, classifyVpnCharge };
