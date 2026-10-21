const { chromium } = require('playwright');

const targets = [
  { name: 'ESC Online', url: 'https://www.estorilsolcasinos.pt/pt/betting/home' },
  { name: 'Casino Portugal', url: 'https://www.casinoportugal.pt/' },
  { name: 'LeBull', url: 'https://www.lebull.pt/apostas-desportivas/' },
  { name: 'GoldenPark', url: 'https://www.goldenpark.pt/' },
  { name: 'Retabet', url: 'https://www.retabet.pt/' },
];

async function probe(browser, target) {
  const page = await browser.newPage({ locale: 'pt-PT', timezoneId: 'Europe/Lisbon' });
  const responses = [];
  const failures = [];
  page.on('response', response => {
    const request = response.request();
    if (responses.length < 300 && (request.resourceType() === 'xhr' || request.resourceType() === 'fetch'
      || /odds|sport|event|market|bet/i.test(response.url()))) {
      responses.push({ status: response.status(), type: request.resourceType(), url: response.url().slice(0, 350) });
    }
  });
  page.on('requestfailed', request => {
    if (failures.length < 100) failures.push({ url: request.url().slice(0, 300), error: request.failure()?.errorText });
  });
  const result = { ...target, testedAt: new Date().toISOString(), responses, failures };
  try {
    const response = await page.goto(target.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    result.httpStatus = response?.status() ?? null;
    result.finalUrl = page.url();
    await page.waitForTimeout(10000);
    result.title = await page.title();
    result.text = (await page.locator('body').innerText({ timeout: 10000 }).catch(() => '')).slice(0, 12000);
    result.scripts = await page.locator('script[src]').evaluateAll(items => items.map(item => item.src).slice(0, 80));
    result.iframes = await page.locator('iframe[src]').evaluateAll(items => items.map(item => item.src).slice(0, 40));
    result.oddsLikeNumbers = await page.locator('body').evaluate(body => {
      const text = body.innerText || '';
      return [...new Set(text.match(/\b[1-9]\d?\.\d{2,3}\b/g) || [])].slice(0, 80);
    });
  } catch (error) {
    result.error = error.message;
    result.finalUrl = page.url();
  } finally {
    await page.close();
  }
  result.responses = responses;
  result.failures = failures;
  return result;
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const results = [];
    for (const target of targets) {
      results.push(await probe(browser, target));
      console.log(`${target.name}: HTTP ${results.at(-1).httpStatus ?? 'falhou'}; ${results.at(-1).oddsLikeNumbers?.length ?? 0} odds numéricas`);
    }
    require('fs').writeFileSync('bookmaker_access_probe.json', JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2));
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
