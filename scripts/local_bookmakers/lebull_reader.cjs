const cheerio = require('cheerio');
const URL = 'https://www.lebull.pt/apostas-desportivas';
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

function matchRow(row, games) {
  if (row.teams.length !== 2) return null;
  const shown = row.clock.match(/(\d{1,2}):(\d{2})/);
  if (!shown) return null;
  const candidates = games.filter(game => game.apiSport === 'soccer_uefa_europa_league'
    && Date.parse(game.commenceTime) > Date.now() + 600000
    && game.teams.every((team, index) => teamScore(team, row.teams[index]) >= 0.5)
    && new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit',
      hourCycle: 'h23' }).format(new Date(game.commenceTime)) === `${shown[1].padStart(2, '0')}:${shown[2]}`);
  return candidates.length === 1 ? candidates[0] : null;
}

function parsePrice(value) {
  const price = Number(String(value || '').trim().replace(',', '.'));
  return Number.isFinite(price) && price > 1 ? price : null;
}

function parseMarkets(oddsItems) {
  const winner = oddsItems.find(item => item.title === '1X2');
  if (!winner) return null;
  const sides = ['1', 'X', '2'].map(label => winner.cells.find(cell => cell.label === label));
  if (sides.some(side => !side || parsePrice(side.price) === null)) return null;
  const markets = [{ type: 'MRES', title: '1X2', selections: sides.map(side => ({
    name: side.label, fullName: side.label, price: parsePrice(side.price), line: null, unavailable: false,
  })) }];
  const total = oddsItems.find(item => item.title === 'Total de Golos Mais/Menos');
  const lines = new Map();
  for (const cell of total?.cells || []) {
    const found = cell.label.match(/^([OU])\s*\((\d+(?:[,.]\d+)?)\)$/i);
    const price = parsePrice(cell.price);
    if (!found || price === null) continue;
    const line = Number(found[2].replace(',', '.'));
    if (line < 0.5 || line > 4.5 || line % 1 !== 0.5) continue;
    if (!lines.has(line)) lines.set(line, {});
    lines.get(line)[found[1].toUpperCase() === 'O' ? 'Over' : 'Under'] = price;
  }
  for (const [line, sidesForLine] of lines) {
    if (!sidesForLine.Over || !sidesForLine.Under) continue;
    markets.push({ type: 'HCTG', title: `Total de Golos Mais/Menos ${line}`,
      selections: ['Over', 'Under'].map(name => ({ name, fullName: `${name} ${line}`,
        price: sidesForLine[name], line, unavailable: false })) });
  }
  return markets.length > 1 ? markets : null;
}

async function readLebull(context, footballGames, limit = 8) {
  const page = await context.newPage();
  const games = [];
  const diagnostics = [];
  try {
    let frame;
    for (let attempt = 1; attempt <= 2 && !frame; attempt++) {
      await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
      frame = page.frames().find(candidate => candidate.url().includes('lebullpt-ssr.boxwebcdn.work/pt'));
      if (!frame) {
        await page.waitForTimeout(3000);
        frame = page.frames().find(candidate => candidate.url().includes('lebullpt-ssr.boxwebcdn.work/pt'));
      }
      if (frame) await frame.locator('.game-row').first().waitFor({ state: 'attached', timeout: 25000 }).catch(() => { frame = null; });
    }
    if (!frame) {
      const direct = await page.goto('https://lebullpt-ssr.boxwebcdn.work/pt',
        { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => null);
      if (direct?.status() === 200) {
        await page.locator('.game-row').first().waitFor({ state: 'attached', timeout: 25000 }).catch(() => {});
        if (await page.locator('.game-row').count()) frame = page.mainFrame();
      }
    }
    if (!frame) throw new Error('LeBull: iframe de odds não carregou.');
    await page.waitForTimeout(10000);
    const html = cheerio.load(await frame.content());
    const rows = html('.game-row').toArray().map(element => ({
      teams: html(element).find('.team-column-name').toArray().map(team => html(team).attr('title') || html(team).text().trim()),
      clock: html(element).find('.betting-table-link').first().text(),
      oddsItems: html(element).find('.game-row-odds-item').toArray().map(item => ({
        title: html(item).find('.market-name').first().text().trim(),
        cells: html(item).find('.odd-cell').toArray().filter(cell => !/disabled|suspended/.test(html(cell).attr('class') || ''))
          .map(cell => ({ label: html(cell).find('.odd-cell-label').first().text().trim(),
            price: html(cell).find('.odd-cell-value .rank-arrow').first().text().trim() })),
      })),
    }));
    const matched = rows.map(row => ({ row, game: matchRow(row, footballGames) })).filter(entry => entry.game);
    if (!matched.length) diagnostics.push({ rows: rows.length,
      firstRows: rows.slice(0, 5).map(row => ({ teams: row.teams, clock: row.clock.slice(0, 40) })),
      reason: 'Nenhum jogo pré-jogo correspondeu aos times e horários Betano.' });
    for (const { row, game } of matched.slice(0, limit)) {
      const markets = parseMarkets(row.oddsItems);
      if (!markets) { diagnostics.push({ teams: row.teams, reason: '1X2 e totais completos indisponíveis.' }); continue; }
      games.push({ apiSport: game.apiSport, teams: game.teams, competition: game.competition,
        commenceTime: game.commenceTime, observedAt: new Date().toISOString(), sourceUrl: frame.url(),
        sourceEventId: `${tokens(row.teams[0]).join('-')}-${tokens(row.teams[1]).join('-')}-${Date.parse(game.commenceTime)}`,
        sourceEventName: row.teams.join(' - '), sourceMarket: 'LeBull iframe HTML: 1X2 e Total de Golos Mais/Menos', markets });
    }
  } finally { await page.close().catch(() => {}); }
  return { games, diagnostics };
}

module.exports = { readLebull, parseMarkets, matchRow };
