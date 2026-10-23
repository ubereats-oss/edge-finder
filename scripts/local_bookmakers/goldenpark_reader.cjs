const cheerio = require('cheerio');
const { matchRow } = require('./lebull_reader.cjs');

const URL = 'https://apostas.goldenpark.pt/competicao/6675-liga-europa?jogar=si';
const price = value => {
  const n = Number(String(value || '').trim().replace(',', '.'));
  return Number.isFinite(n) && n > 1 ? n : null;
};

function choices($, box) {
  return $(box).find('span.odd[title]').toArray().filter(element => !/display:\s*none/i.test($(element).attr('style') || ''))
    .map(element => ({ label: $(element).attr('title'), price: price($(element).find('.container-odd-and-trend').first().text()) }))
    .filter(item => item.price);
}

function parseEvent(html, game, url, sourceEventId) {
  const $ = cheerio.load(html);
  const markets = [];
  for (const container of $('.container-event').toArray()) {
    const title = $(container).find('.question-header p').first().text().trim();
    const items = choices($, container);
    if (game.apiSport === 'basketball_nba') {
      if (/^(Vencedor|Vencedor do jogo)$/i.test(title) && items.length === 2)
        markets.push({ type: 'H2HT', title, selections: items.map((item, index) => ({
          name: index === 0 ? '1' : '2', fullName: item.label,
          price: item.price, line: null, unavailable: false })) });
      if (/Total de Pontos/i.test(title)) {
        const lines = new Map();
        for (const item of items) {
          const found = item.label.match(/^(Mais|Menos) de (\d+(?:[,.]\d+)?)$/i);
          if (!found) continue;
          const line = Number(found[2].replace(',', '.'));
          if (!lines.has(line)) lines.set(line, {});
          lines.get(line)[/^mais/i.test(found[1]) ? 'Over' : 'Under'] = item.price;
        }
        for (const [line, both] of lines) if (both.Over && both.Under)
          markets.push({ type: 'TPOT', title: `${title} ${line}`,
            selections: ['Over', 'Under'].map(name => ({ name, fullName: `${name} ${line}`,
              price: both[name], line, unavailable: false })) });
      }
      continue;
    }
    if (title === 'Resultado do jogo' && items.length >= 3) {
      const selections = items.slice(0, 3).map((item, index) => ({
        name: ['1', 'X', '2'][index], fullName: ['1', 'X', '2'][index], price: item.price,
        line: null, unavailable: false,
      }));
      if (selections.length === 3) markets.push({ type: 'MRES', title, selections });
    }
    if (title === 'Total de Golos') {
      const lines = new Map();
      for (const item of items) {
        const found = item.label.match(/^(Mais|Menos) de (\d+[,.]5)$/i);
        if (!found) continue;
        const line = Number(found[2].replace(',', '.'));
        if (line < 0.5 || line > 4.5) continue;
        if (!lines.has(line)) lines.set(line, {});
        lines.get(line)[found[1] === 'Mais' ? 'Over' : 'Under'] = item.price;
      }
      for (const [line, both] of lines) {
        if (!both.Over || !both.Under) continue;
        markets.push({ type: 'HCTG', title: `${title} ${line}`, selections: ['Over', 'Under'].map(name => ({
          name, fullName: `${name} ${line}`, price: both[name], line, unavailable: false,
        })) });
      }
    }
  }
  return markets.length ? { apiSport: game.apiSport, teams: game.teams, competition: game.competition,
    commenceTime: game.commenceTime, observedAt: new Date().toISOString(), sourceUrl: url,
    sourceEventId, sourceEventName: game.teams.join(' - '),
    sourceMarket: 'GoldenPark HTML pré-jogo: Resultado do jogo e Total de Golos', markets } : null;
}

async function readGoldenpark(context, footballGames, limit = 9) {
  const page = await context.newPage();
  const games = [];
  const diagnostics = [];
  try {
    const response = await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
    if (response?.status() !== 200) throw new Error(`GoldenPark: HTTP ${response?.status()}`);
    await page.locator('.line-container.new').first().waitFor({ timeout: 20000 });
    const $ = cheerio.load(await page.content());
    const rows = $('.line-container.new').toArray().map(element => ({
      teams: $(element).find('.actor-1,.actor-2').map((_, e) => $(e).text().trim()).get(),
      clock: $(element).find('.date-event').text().trim(),
      href: $(element).find('a.snc-link-to-event').attr('href'),
    }));
    const matched = rows.map(row => ({ row, game: matchRow(row, footballGames) })).filter(item => item.game && item.row.href);
    diagnostics.push({ rows: rows.length, matched: matched.length });
    for (const { row, game } of matched.slice(0, limit)) {
      const url = new globalThis.URL(row.href, URL).href;
      const eventResponse = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      if (eventResponse?.status() !== 200) { diagnostics.push({ url, status: eventResponse?.status() }); continue; }
      await page.locator('.container-event').first().waitFor({ timeout: 15000 });
      const parsed = parseEvent(await page.content(), game, url, row.href.match(/\/evento\/(\d+)/)?.[1] || row.href);
      if (parsed) games.push(parsed);
    }
  } finally { await page.close().catch(() => {}); }
  return { games, diagnostics };
}

module.exports = { readGoldenpark, parseEvent };
