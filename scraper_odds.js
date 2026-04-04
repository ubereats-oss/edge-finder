const { chromium } = require('playwright');
const fs = require('fs');

async function scrapeWithAPI() {
  console.log('[1] Iniciando navegador...');

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  const results = [];

  // 🔥 INTERCEPTAÇÃO REAL
  page.on('response', async (response) => {
    const url = response.url();

    if (url.includes('odds') || url.includes('match')) {
      try {
        const data = await response.json();

        console.log('[2] API capturada:', url);

        results.push({
          url,
          data
        });
      } catch {}
    }
  });

  const target = 'https://www.flashscore.com/tennis/';

  console.log('[3] Acessando:', target);

  await page.goto(target, { waitUntil: 'networkidle' });

  await page.waitForTimeout(8000);

  fs.writeFileSync('raw_api_data.json', JSON.stringify(results, null, 2));

  console.log('[4] APIs salvas:', results.length);

  await browser.close();
}

scrapeWithAPI();
