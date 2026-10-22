const fs = require('node:fs');
const path = require('node:path');

const TARGETS = {
  bwin: 'https://www.bwin.pt/pt/sports/futebol-4/apostar',
  betclic: 'https://www.betclic.pt/futebol-s1',
  lebull: 'https://www.lebull.pt/apostas-desportivas/',
  esc_online: 'https://www.estorilsolcasinos.pt/pt/betting/home',
  goldenpark: 'https://www.goldenpark.pt/',
  casino_portugal: 'https://www.casinoportugal.pt/desporto/d_all/s_69',
  retabet_euroleague: 'https://www.retabet.pt/desportos/basquetebol/2',
};

async function probeTarget(context, outputDir, key) {
  if (!Object.hasOwn(TARGETS, key)) throw new Error(`Alvo de pesquisa desconhecido: ${key}`);
  const page = await context.newPage();
  const responses = [];
  const failures = [];
  const sockets = [];
  const result = { target: key, url: TARGETS[key], startedAt: new Date().toISOString(), responses, failures, sockets };
  page.on('websocket', socket => {
    const trace = { url: socket.url(), sent: [], received: [] };
    sockets.push(trace);
    socket.on('framesent', frame => {
      if (trace.sent.length < 15) trace.sent.push(String(frame.payload).slice(0, 1000));
    });
    socket.on('framereceived', frame => {
      if (trace.received.length < 30) trace.received.push(String(frame.payload).slice(0, 3000));
    });
  });
  page.on('response', async response => {
    if (responses.length >= 180) return;
    const type = response.headers()['content-type'] || '';
    if (/javascript|text\/css|image\/|font\//i.test(type)) return;
    const item = { status: response.status(), url: response.url().slice(0, 500), type };
    responses.push(item);
    if (!/json|text\/html|text\/plain|octet-stream|protobuf/i.test(type)
      && !/cds-api|sports\/api/i.test(item.url)) return;
    try {
      const body = await response.text();
      item.length = body.length;
      item.sample = body.slice(0, 1800);
      if (body.length <= 2500000) item.body = body;
    } catch (error) { item.error = error.message; }
  });
  page.on('requestfailed', request => {
    if (failures.length < 60) failures.push({ url: request.url().slice(0, 400), error: request.failure()?.errorText });
  });
  try {
    const response = await page.goto(TARGETS[key], { waitUntil: 'domcontentloaded', timeout: 45000 });
    result.httpStatus = response?.status() ?? null;
    await page.waitForTimeout(20000);
    result.finalUrl = page.url();
    result.title = await page.title();
    result.body = (await page.locator('body').innerText({ timeout: 10000 }).catch(() => '')).slice(0, 20000);
    result.oddsLikeNumbers = [...new Set(result.body.match(/\b\d{1,2}[,.]\d{2}\b/g) || [])].slice(0, 100);
    result.iframes = await page.locator('iframe[src]').evaluateAll(items => items.map(item => item.src).slice(0, 30));
    result.scripts = await page.locator('script[src]').evaluateAll(items => items.map(item => item.src).slice(0, 60));
    result.screenshot = path.join(outputDir, `feed-probe-${key}-${Date.now()}.png`);
    await page.screenshot({ path: result.screenshot, fullPage: false }).catch(error => { result.screenshotError = error.message; });
    for (const item of responses) {
      if (!item.body) continue;
      item.visibleOdds = result.oddsLikeNumbers.filter(price => item.body.includes(price)
        || item.body.includes(price.replace(',', '.'))).slice(0, 20);
      if ((/\/(?:sports\/api\/widget\/widgetdata|cds-api\/)/i.test(item.url)
        || /text\/html/i.test(item.type) && item.visibleOdds?.length) && item.length > 10000) {
        const feedFile = path.join(outputDir, `feed-probe-${key}-response-${Date.now()}.json`);
        fs.writeFileSync(feedFile, item.body);
        item.savedBody = feedFile;
      }
      delete item.body;
    }
  } catch (error) { result.error = error.message; result.finalUrl = page.url(); }
  finally {
    result.finishedAt = new Date().toISOString();
    fs.writeFileSync(path.join(outputDir, `feed-probe-${key}-${Date.now()}.json`), JSON.stringify(result, null, 2));
    await page.close().catch(() => {});
  }
  return { target: key, httpStatus: result.httpStatus, odds: result.oddsLikeNumbers?.length || 0,
    feedCandidates: responses.filter(item => item.visibleOdds?.length).length, error: result.error || null };
}

async function scheduledFeedProbe(context, outputDir) {
  const requestFile = path.join(outputDir, 'feed-probe-request.json');
  if (!fs.existsSync(requestFile)) return null;
  const request = JSON.parse(fs.readFileSync(requestFile, 'utf8'));
  try { return await probeTarget(context, outputDir, String(request.target || '')); }
  finally { fs.unlinkSync(requestFile); }
}

module.exports = { scheduledFeedProbe, probeTarget, TARGETS };
