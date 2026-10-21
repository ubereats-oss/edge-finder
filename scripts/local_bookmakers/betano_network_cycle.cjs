const { chromium } = require('playwright');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const tunnelScript = path.join(__dirname, 'tunnelbear.ps1');
const outputDir = path.join(root, '.tmp_bookmaker_probe');
const outputFile = path.join(outputDir, 'betano_network_cycle.json');
const profileDir = path.join(process.env.LOCALAPPDATA, 'odds_app', 'chrome_betano_persistent');
const pageUrl = 'https://www.betano.pt/sport/basquetebol/eua/nba';

function tunnel(action) {
  const result = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', tunnelScript, action], {
    encoding: 'utf8', timeout: 210000,
  });
  if (result.status !== 0) throw new Error((result.stderr || result.stdout || `TunnelBear ${action} falhou`).trim());
  return JSON.parse(result.stdout.trim());
}

function safeUrl(raw) {
  const url = new URL(raw);
  for (const key of [...url.searchParams.keys()]) {
    if (/token|key|auth|session|signature|secret/i.test(key)) url.searchParams.set(key, '[redacted]');
  }
  return url.toString();
}

function likelyOddsJson(value) {
  const text = JSON.stringify(value).toLowerCase();
  return /"(odds|price|prices|market|markets|selection|selections|event|events|participant|competitor|line|handicap|total)"/.test(text);
}

async function main() {
  fs.mkdirSync(outputDir, { recursive: true });
  const before = tunnel('meter').remainingMB;
  const connection = tunnel('connect');
  let browserContext;
  let disconnectError = null;
  const responses = [];
  const websockets = [];
  const failures = [];
  const report = { startedAt: new Date().toISOString(), pageUrl, profileDir, beforeMB: before,
    connection, responses, websockets, failures };
  try {
    browserContext = await chromium.launchPersistentContext(profileDir, {
      channel: 'chrome', headless: false, locale: 'pt-PT', timezoneId: 'Europe/Lisbon',
      viewport: { width: 1440, height: 960 },
    });
    const page = await browserContext.newPage();
    page.on('requestfailed', request => failures.push({ url: safeUrl(request.url()), error: request.failure()?.errorText }));
    page.on('websocket', socket => {
      const row = { url: safeUrl(socket.url()), frames: [] };
      socket.on('framereceived', frame => {
        if (row.frames.length < 200) row.frames.push(String(frame.payload).slice(0, 100000));
      });
      websockets.push(row);
    });
    page.on('response', response => {
      const request = response.request();
      if (!['xhr', 'fetch'].includes(request.resourceType())) return;
      const contentType = response.headers()['content-type'] || '';
      const item = { url: safeUrl(response.url()), method: request.method(), status: response.status(), contentType };
      responses.push(item);
      if (!/json/i.test(contentType)) return;
      item.json = response.json().then(data => {
        if (likelyOddsJson(data)) item.payload = data;
        else item.ignored = 'json_sem_campos_de_evento_ou_mercado';
      }).catch(error => { item.parseError = error.message; });
    });

    const navigation = await page.goto(pageUrl, { waitUntil: 'commit', timeout: 60000 });
    report.navigationStatus = navigation?.status() ?? null;
    await page.waitForTimeout(12000);
    for (const name of [/rejeitar todos/i, /recusar tudo/i, /reject all/i, /aceitar todos/i, /accept all/i]) {
      const button = page.getByRole('button', { name }).first();
      if (await button.isVisible().catch(() => false)) {
        await button.click().catch(() => {});
        await page.waitForTimeout(3000);
        break;
      }
    }
    await page.waitForTimeout(12000);
    await Promise.all(responses.map(row => row.json).filter(Boolean));
    for (const row of responses) delete row.json;
    report.finalUrl = page.url();
    report.responseCount = responses.length;
    report.dataResponseCount = responses.filter(row => row.payload).length;
    report.dataPayloads = responses.filter(row => row.payload).map(row => ({
      url: row.url, method: row.method, status: row.status, contentType: row.contentType,
      payload: row.payload,
    }));
    report.responses = responses.map(({ payload, ...row }) => row);
  } finally {
    if (browserContext) await browserContext.close();
    try { tunnel('disconnect'); } catch (error) { disconnectError = error.message; }
    report.disconnectError = disconnectError;
    try { report.afterMB = tunnel('meter').remainingMB; } catch (error) { report.meterError = error.message; }
    report.finishedAt = new Date().toISOString();
    report.deltaMB = Number.isFinite(report.beforeMB) && Number.isFinite(report.afterMB)
      ? report.beforeMB - report.afterMB : null;
    fs.writeFileSync(outputFile, JSON.stringify(report, null, 2));
  }
  console.log(JSON.stringify({ outputFile, navigationStatus: report.navigationStatus,
    responseCount: report.responseCount, dataResponseCount: report.dataResponseCount,
    websockets: websockets.length, beforeMB: report.beforeMB, afterMB: report.afterMB,
    deltaMB: report.deltaMB, disconnectError: report.disconnectError }));
  if (report.disconnectError) throw new Error(report.disconnectError);
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
