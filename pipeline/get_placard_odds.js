const { chromium } = require('playwright');
const competitions = require('./placard_config');

// Executado em navegador, sobre classes observadas no DOM real do Placard.
function readRows() {
  return [...document.querySelectorAll('.ta-EventListItem')].map(e => ({
    teams: [...e.querySelectorAll('.ta-participantName')].map(n => n.textContent.trim()),
    timeText: e.innerText.split('\n').map(s => s.trim()).find(Boolean),
    href: e.querySelector('a.ta-EventListItemDetails')?.getAttribute('href'),
    markets: [...e.querySelectorAll('.ta-Market')].map(m => ({
      type: [...m.classList].find(s => s.startsWith('ta-MarketType-'))?.slice(14),
      selections: [...m.querySelectorAll('.ta-SelectionButtonView')].map(s => ({
        price: s.querySelector('.ta-price_text')?.textContent.trim() ?? null,
        line: s.querySelector('.ta-infoTextHandicap')?.textContent.trim() ?? null,
        unavailable: !!s.querySelector('.ta-unavailable') || s.getAttribute('aria-disabled') === 'true',
      })),
    })),
  }));
}

function kickoff(text, now = Date.now()) {
  const m = String(text).match(/^(Hoje|Amanhã|\d{1,2} de [a-zç]+\.?),?\s+(\d{1,2}):(\d{2})$/i);
  if (!m) return null;
  const date = new Date(now);
  const day = m[1].toLowerCase();
  if (day === 'amanhã') date.setUTCDate(date.getUTCDate() + 1);
  else if (day !== 'hoje') {
    const parts = day.match(/(\d+) de ([a-zç]+)/);
    const month = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'].indexOf(parts[2]);
    if (month < 0) return null;
    date.setUTCMonth(month, Number(parts[1]));
    if (date.getTime() < now - 180 * 86400000) date.setUTCFullYear(date.getUTCFullYear() + 1);
  }
  date.setUTCHours(Number(m[2]), Number(m[3]), 0, 0);
  return date.toISOString();
}

async function scrapeCompetition(page, cfg, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.locator('.ta-EventListItem').first().waitFor({ state: 'attached', timeout: 20000 });
  // A lista pode ser virtualizada; percorrer o contêiner e unir por evento.
  const all = new Map();
  for (let i = 0; i < 30; i++) {
    for (const r of await page.evaluate(readRows)) {
      if (r.href && r.teams.length === 2 && !r.href.includes('/inplay/')) all.set(r.href, r);
    }
    const moved = await page.evaluate(() => {
      const row = document.querySelector('.ta-EventListItem');
      let scroller = row?.parentElement;
      while (scroller && !(scroller.scrollHeight > scroller.clientHeight + 10 && /auto|scroll/.test(getComputedStyle(scroller).overflowY))) scroller = scroller.parentElement;
      scroller ||= document.scrollingElement;
      const old = scroller.scrollTop;
      scroller.scrollTop += Math.max(scroller.clientHeight * 0.8, 500);
      return scroller.scrollTop !== old;
    });
    if (!moved) break;
    await page.waitForTimeout(150);
  }
  const observedAt = new Date().toISOString();
  return [...all.values()].map(r => ({ ...r, apiSport: cfg.key, competition: cfg.label,
    commenceTime: kickoff(r.timeText), observedAt, sourceUrl: url }));
}

async function createBrowser() {
  // DNS público apenas para diagnóstico local; sem IPs fixos em produção.
  const args = [];
  if (process.env.PLACARD_PUBLIC_DNS === '1') {
    const axios = require('axios');
    const hosts = ['www.placard.pt', 'sportswidget.placard.pt', 'sportswidget-cdn.placard.pt', 'oapi.placard.pt', 'communication-widgets.placard.pt'];
    const mappings = [];
    for (const host of hosts) {
      const { data } = await axios.get('https://dns.google/resolve', { params: { name: host, type: 'A' }, timeout: 10000 });
      const ip = data.Answer?.find(a => a.type === 1)?.data;
      if (!ip || !/^\d+\.\d+\.\d+\.\d+$/.test(ip)) throw new Error(`DNS indisponível: ${host}`);
      mappings.push(`MAP ${host} ${ip}`);
    }
    args.push(`--host-resolver-rules=${mappings.join(', ')}`);
  }
  return chromium.launch({ headless: true, args });
}

module.exports = { createBrowser, scrapeCompetition, readRows, kickoff };
if (require.main === module) {
  (async () => {
    const browser = await createBrowser();
    const output = { generatedAt: new Date().toISOString(), rows: [], errors: [] };
    try {
      const page = await browser.newPage({ locale: 'pt-PT', timezoneId: 'UTC' });
      for (const cfg of competitions) {
        try {
          const url = `https://www.placard.pt/apostas/sports/${cfg.sport}/competitions/${cfg.id}/matches`;
          const rows = await scrapeCompetition(page, cfg, url);
          output.rows.push(...rows);
          console.log(`${cfg.label}: ${rows.length} jogos`);
        } catch (e) { output.errors.push({ competition: cfg.label, error: e.message }); }
      }
    } finally { await browser.close(); }
    require('fs').writeFileSync('placard_odds.json', JSON.stringify(output, null, 2));
    if (output.errors.length) { console.error(output.errors); process.exitCode = 1; }
  })().catch(e => { console.error(e.message); process.exitCode = 1; });
}
