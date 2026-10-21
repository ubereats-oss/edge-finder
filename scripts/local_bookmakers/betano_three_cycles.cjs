const { chromium } = require('playwright');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const tunnelScript = path.join(__dirname, 'tunnelbear.ps1');
const outputDir = path.join(root, '.tmp_bookmaker_probe');
const outputFile = path.join(outputDir, 'betano_three_cycles.json');
const profileDir = path.join(process.env.LOCALAPPDATA, 'odds_app', 'chrome_betano_persistent');
const startUrl = 'https://www.betano.pt/sport/basquetebol/eua/nba';
const eventPath = '/api/sports/BASK/hot/trending/leagues/441g/events';

function tunnel(action) {
  const result = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', tunnelScript, action], {
    encoding: 'utf8', timeout: 240000,
  });
  if (result.status !== 0) throw new Error((result.stderr || result.stdout || `TunnelBear ${action} falhou`).trim());
  return JSON.parse(result.stdout.trim());
}

function normalizeResponse(payload) {
  const events = payload?.data?.events || [];
  return events.flatMap(event => {
    const blocks = (event.sixPackBlocks || []).flatMap(block => block.columns || []);
    return blocks.flatMap(column => {
      const market = column.type === 'H2HT' ? 'h2h' : column.type === 'FHOT' ? 'spreads'
        : column.type === 'FTPO' ? 'totals' : null;
      if (!market) return [];
      return (column.selections || []).filter(selection => Number.isFinite(Number(selection.price))
        && Number(selection.price) > 1).map(selection => ({
        eventId: String(event.id), event: event.shortName,
        commenceTime: new Date(event.startTime).toISOString(), market,
        marketType: column.type, line: selection.handicap ?? null,
        selectionId: String(selection.id), selection: selection.name,
        odds: Number(selection.price),
      }));
    });
  });
}

async function main() {
  fs.mkdirSync(outputDir, { recursive: true });
  const cycles = [];
  let context;
  let page;
  let endpoint;
  let disconnectError = null;
  try {
    context = await chromium.launchPersistentContext(profileDir, {
      channel: 'chrome', headless: false, locale: 'pt-PT', timezoneId: 'Europe/Lisbon',
      viewport: { width: 1440, height: 960 },
    });
    page = await context.newPage();
    await page.route('**/*', route => ['image', 'media'].includes(route.request().resourceType())
      ? route.abort() : route.continue());

    for (let index = 1; index <= 3; index++) {
      const before = tunnel('meter').remainingMB;
      const connection = tunnel('connect');
      const cycle = { index, startedAt: new Date().toISOString(), beforeMB: before, connection };
      try {
        let payload;
        if (index === 1) {
          const captured = new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('Resposta JSON de eventos NBA não chegou em 45s.')), 45000);
            page.on('response', async response => {
              if (!response.url().includes(eventPath) || !/json/i.test(response.headers()['content-type'] || '')) return;
              try {
                const data = await response.json();
                if (Array.isArray(data?.data?.events) && data.data.events.length) {
                  clearTimeout(timer);
                  endpoint = new URL(response.url()).pathname + new URL(response.url()).search;
                  resolve(data);
                }
              } catch (_) { /* respostas JSON sem eventos são ignoradas */ }
            });
          });
          const navigation = await page.goto(startUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
          cycle.navigationStatus = navigation?.status() ?? null;
          cycle.finalUrl = page.url();
          cycle.payload = await captured;
          cycle.source = 'navegação inicial; resposta JSON original da página';
          for (const name of [/rejeitar todos/i, /recusar tudo/i, /reject all/i, /aceitar todos/i, /accept all/i]) {
            const button = page.getByRole('button', { name }).first();
            if (await button.isVisible().catch(() => false)) {
              await button.click().catch(() => {});
              break;
            }
          }
        } else {
          const result = await page.evaluate(async url => {
            const response = await fetch(url, { credentials: 'include', cache: 'no-store' });
            return { status: response.status, payload: await response.json() };
          }, endpoint);
          if (result.status !== 200) throw new Error(`Fetch dentro da sessão retornou HTTP ${result.status}.`);
          payload = result.payload;
          cycle.payload = payload;
          cycle.source = 'fetch same-origin na página existente, sem reload';
          cycle.navigationCount = await page.evaluate(() => performance.getEntriesByType('navigation').length);
        }
        if (!cycle.payload) cycle.payload = payload;
        cycle.endpoint = endpoint;
        cycle.events = cycle.payload?.data?.events?.length || 0;
        cycle.selections = normalizeResponse(cycle.payload);
        cycle.normalizedSelectionCount = cycle.selections.length;
        cycle.finishedReadAt = new Date().toISOString();
      } catch (error) {
        cycle.error = error.message;
      } finally {
        try { tunnel('disconnect'); } catch (error) { disconnectError = error.message; }
        try { cycle.afterMB = tunnel('meter').remainingMB; }
        catch (error) { cycle.meterError = error.message; }
        cycle.deltaMB = Number.isFinite(cycle.beforeMB) && Number.isFinite(cycle.afterMB)
          ? cycle.beforeMB - cycle.afterMB : null;
        cycle.endedAt = new Date().toISOString();
        cycles.push(cycle);
        fs.writeFileSync(outputFile, JSON.stringify({ profileDir, startUrl, endpoint, cycles,
          disconnectError, updatedAt: new Date().toISOString() }, null, 2));
      }
      if (cycle.error) break;
    }
  } finally {
    if (context) await context.close();
    try { tunnel('disconnect'); } catch (error) { disconnectError ||= error.message; }
  }
  const summary = cycles.map(({ index, beforeMB, afterMB, deltaMB, navigationStatus,
    source, events, normalizedSelectionCount, error, meterError }) => ({ index, beforeMB, afterMB,
    deltaMB, navigationStatus, source, events, normalizedSelectionCount, error, meterError }));
  console.log(JSON.stringify({ outputFile, summary, disconnectError }));
  if (cycles.length !== 3 || cycles.some(cycle => cycle.error || !Number.isFinite(cycle.afterMB))) process.exitCode = 1;
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
