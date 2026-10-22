const URL = 'https://www.estorilsolcasinos.pt/pt/betting/sport/futebol-844/matches/date-0';
const IGNORE = new Set(['fc', 'sc', 'ac', 'afc', 'pfc', 'gnk', 'nk', 'kks', 'rsc', 'de', 'do', 'da', 'the']);

function tokens(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).filter(token => token.length >= 2 && !IGNORE.has(token));
}

function teamScore(left, right) {
  const a = new Set(tokens(left));
  const b = new Set(tokens(right));
  return a.size && b.size ? [...a].filter(token => b.has(token)).length / Math.max(a.size, b.size) : 0;
}

function matchLink(link, games) {
  const names = link.label.split(/\n+/).map(value => value.trim()).filter(Boolean);
  if (names.length !== 2) return null;
  const candidates = games.filter(game => game.apiSport === 'soccer_uefa_europa_league'
    && Date.parse(game.commenceTime) > Date.now() + 600000
    && game.teams.every((team, index) => teamScore(team, names[index]) >= 0.5));
  return candidates.length === 1 ? candidates[0] : null;
}

function parseTotals(rows) {
  const lines = new Map();
  for (const row of rows) {
    if (row.locked) continue;
    const match = row.line.match(/^\((\d+(?:[,.]\d+)?)\)$/);
    const price = Number(row.price);
    if (!match || !Number.isFinite(price) || price <= 1) continue;
    const line = Number(match[1].replace(',', '.'));
    if (line < 1.5 || line > 4.5 || line % 1 !== 0.5) continue;
    if (!lines.has(line)) lines.set(line, {});
    lines.get(line)[row.name === 'Mais' ? 'Over' : row.name === 'Menos' ? 'Under' : 'unknown'] = price;
  }
  return [...lines].filter(([, sides]) => sides.Over && sides.Under).map(([line, sides]) => ({
    type: 'HCTG', title: `Total de Golos ${line}`, selections: ['Over', 'Under'].map(name => ({
      name, fullName: `${name} ${line}`, price: sides[name], line, unavailable: false,
    })),
  }));
}

async function readEscOnline(context, footballGames, limit = 8) {
  const page = await context.newPage();
  const games = [];
  const diagnostics = [];
  try {
    await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.locator('a[href*="/betting/event/futebol-844/"][href*="liga-europa"]')
      .first().waitFor({ state: 'attached', timeout: 25000 });
    const links = await page.locator('a[href*="/betting/event/futebol-844/"][href*="liga-europa"]')
      .evaluateAll(elements => [...new Map(elements.map(element => [element.href,
        { href: element.href, label: element.innerText.trim() }])).values()]);
    const matched = links.map(link => ({ link, game: matchLink(link, footballGames) })).filter(row => row.game);
    for (const { link, game } of matched.slice(0, limit)) {
      try {
        await page.goto(link.href, { waitUntil: 'domcontentloaded', timeout: 45000 });
        await page.waitForFunction(() => [...document.querySelectorAll('p')]
          .some(element => element.textContent.trim() === 'Total de Golos'), { timeout: 25000 });
        const observed = await page.evaluate(() => {
          const market = [...document.querySelectorAll('p')]
            .find(element => element.textContent.trim() === 'Total de Golos')
            ?.closest('[data-testid="collapsible-market"]');
          if (!market) return null;
          return { header: document.body.innerText.slice(0, 1300) };
        });
        if (!observed) throw new Error('Mercado Total de Golos ausente.');
        await page.waitForFunction(() => {
          const market = [...document.querySelectorAll('p')]
            .find(element => element.textContent.trim() === 'Total de Golos')
            ?.closest('[data-testid="collapsible-market"]');
          return market && market.querySelectorAll('[data-testid="event-details-outcome"]').length >= 10;
        }, null, { timeout: 5000 }).catch(() => {});
        const expanded = await page.evaluate(() => {
          const market = [...document.querySelectorAll('p')]
            .find(element => element.textContent.trim() === 'Total de Golos')
            ?.closest('[data-testid="collapsible-market"]');
          if (!market || market.querySelectorAll('[data-testid="event-details-outcome"]').length >= 10) return false;
          const button = market.querySelector('[data-testid="toggle-see-all"]');
          if (!button || !/ver tudo/i.test(button.textContent || '')) return false;
          button.click();
          return true;
        });
        if (expanded) await page.waitForFunction(() => {
          const market = [...document.querySelectorAll('p')]
            .find(element => element.textContent.trim() === 'Total de Golos')
            ?.closest('[data-testid="collapsible-market"]');
          return market && market.querySelectorAll('[data-testid="event-details-outcome"]').length >= 10;
        }, null, { timeout: 5000 }).catch(() => {});
        const rows = await page.evaluate(() => {
          const market = [...document.querySelectorAll('p')]
            .find(element => element.textContent.trim() === 'Total de Golos')
            .closest('[data-testid="collapsible-market"]');
          return [...market.querySelectorAll('[data-testid="event-details-outcome"]')].map(element => ({
            name: element.querySelector('[class*="OutcomeName"]')?.textContent?.trim() || '',
            line: element.querySelector('[class*="OutcomeBaseEventDetails"]')?.textContent?.trim() || '',
            price: element.querySelector('[data-testid="event-details-outcome-odds"]')?.textContent?.trim() || '',
            locked: element.getAttribute('data-locked') === 'true',
          }));
        });
        const shown = observed.header.match(/Hoje\s*-\s*(\d{1,2}):(\d{2})/);
        const expected = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Sao_Paulo', hour: '2-digit',
          minute: '2-digit', hourCycle: 'h23' }).format(new Date(game.commenceTime));
        if (!shown || `${shown[1].padStart(2, '0')}:${shown[2]}` !== expected) throw new Error('Horário ESC não confere com Betano.');
        const markets = parseTotals(rows);
        if (!markets.length) throw new Error('Totais regulamentares completos indisponíveis.');
        games.push({ apiSport: game.apiSport, teams: game.teams, competition: game.competition,
          commenceTime: game.commenceTime, observedAt: new Date().toISOString(), sourceUrl: link.href,
          sourceEventId: link.href.match(/-(\d+)$/)?.[1] || null, sourceEventName: link.label.replace(/\n+/g, ' - '),
          sourceMarket: 'ESC Online Total de Golos; Resultado Final 2Up excluído', markets });
      } catch (error) { diagnostics.push({ event: link.label, error: error.message }); }
    }
  } finally { await page.close().catch(() => {}); }
  return { games, diagnostics };
}

module.exports = { readEscOnline, parseTotals, matchLink };
