const { chromium } = require('playwright');
const fs = require('fs');

async function scrapeOddsPortal() {
  console.log('[1] Iniciando...');

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  // 🔥 URL CORRETA (TORNEIO)
  const url = 'https://www.oddsportal.com/tennis/atp-marrakech/';

  console.log('[2] Acessando:', url);

  await page.goto(url, { waitUntil: 'networkidle' });

  try {
    await page.click('#onetrust-accept-btn-handler', { timeout: 3000 });
    console.log('[3] Cookie aceito');
  } catch {}

  await page.waitForTimeout(5000);

  console.log('[4] Extraindo dados...');

  const matches = await page.evaluate(() => {
    const rows = document.querySelectorAll('table tbody tr');
    const data = [];

    rows.forEach(row => {
      const cols = row.querySelectorAll('td');

      if (cols.length < 3) return;

      const playersText = cols[1]?.innerText || '';

      if (!playersText.includes('-')) return;

      const [playerA, playerB] = playersText.split('-').map(p => p.trim());

      const oddA = parseFloat(cols[2]?.innerText);
      const oddB = parseFloat(cols[3]?.innerText);

      if (playerA && playerB && !isNaN(oddA) && !isNaN(oddB)) {
        data.push({
          playerA,
          playerB,
          oddA,
          oddB
        });
      }
    });

    return data;
  });

  console.log('[5] Total jogos:', matches.length);

  matches.slice(0, 10).forEach((m, i) => {
    console.log(`[6] ${i + 1}: ${m.playerA} x ${m.playerB} | ${m.oddA} / ${m.oddB}`);
  });

  fs.writeFileSync('oddsportal_matches.json', JSON.stringify(matches, null, 2));

  console.log('[7] Arquivo salvo');

  await browser.close();
}

scrapeOddsPortal();
