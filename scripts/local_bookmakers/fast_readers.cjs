// Direct bookmaker feeds using the persistent Edge context's cookie jar.
// Page readers remain bounded fallbacks when a feed is unavailable.
const cheerio = require('cheerio');
const { readSelections, adaptTotalsAndHandicaps, initialJson, freshJson } = require('../../pipeline/local_betano_reader.js');
const { eligibleTotals, matchFixture, readBwin } = require('./bwin_reader.cjs');
const { matchLink, eventTimeMatches, teamScore: retabetTeamScore,
  parseMarkets: retabetMarkets } = require('./retabet_reader.cjs');
const { readLebull, matchRow, parseMarkets: lebullMarkets } = require('./lebull_reader.cjs');
const { matchLink: matchEscLink, parseTotals } = require('./esc_online_reader.cjs');
const { parseEvent } = require('./goldenpark_reader.cjs');

const BETANO = 'https://www.betano.pt';
const NBA_PATH = '/api/sports/BASK/hot/trending/leagues/441g/events?req=s,stnf,c,mb';
const FOOTBALL_PATH = '/api/sports/FOOT/hot/trending/leagues/433g/events?req=s,stnf,c,mb';
const BWIN_URL = 'https://www.bwin.pt/cds-api/bettingoffer/fixtures?x-bwin-accessid=YmQwNTFkNDAtNzM3Yi00YWIyLThkNDYtYWFmNGY2N2Y1OWIx&lang=pt&country=PT&userCountry=PT&fixtureTypes=Standard&state=Latest&offerMapping=Filtered&offerCategories=Gridable&fixtureCategories=Gridable,NonGridable,Other&sportIds=4&isPriceBoost=false&statisticsModes=None&skip=0&take=50&sortBy=Tags';
const RETABET_INDEX = 'https://www.retabet.pt/desportos/futebol/1';
const LEBULL_FEED = 'https://lebullpt-ssr.boxwebcdn.work/pt';
const ESC_INDEX = 'https://www.estorilsolcasinos.pt/pt/betting/sport/futebol-844/matches/date-0';
const GOLDEN_INDEX = 'https://apostas.goldenpark.pt/competicao/6675-liga-europa?jogar=si';
const count = games => games.reduce((sum, game) => sum + game.markets.reduce((n, market) => n + market.selections.length, 0), 0);

async function responseText(context, url, timeout = 8000) {
  const response = await context.request.get(url, { timeout, failOnStatusCode: false,
    headers: { 'cache-control': 'no-cache' } });
  if (response.status() !== 200) throw new Error(`HTTP ${response.status()}: ${url}`);
  return response.text();
}

async function responseJson(context, url, timeout = 8000) {
  const response = await context.request.get(url, { timeout, failOnStatusCode: false,
    headers: { 'cache-control': 'no-cache' } });
  if (response.status() !== 200) throw new Error(`HTTP ${response.status()}: ${url}`);
  return response.json();
}

async function browserHtml(page, urls) {
  return page.evaluate(async targets => Promise.all(targets.map(async url => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(url, { credentials: 'include', cache: 'no-store', signal: controller.signal });
      return { url, status: response.status, html: response.ok ? await response.text() : null };
    } catch (error) { return { url, error: String(error) }; }
    finally { clearTimeout(timer); }
  })), urls);
}

function future(games) {
  return games.filter(game => {
    const delta = Date.parse(game.commenceTime) - Date.now();
    return delta > 600000 && delta <= 12 * 3600000;
  });
}

async function betano(context) {
  let nba, football, method = 'direct_feed';
  try {
    [nba, football] = await Promise.all([NBA_PATH, FOOTBALL_PATH].map(path => responseJson(context, BETANO + path)));
    if (![nba, football].every(data => Array.isArray(data?.data?.events))) throw new Error('Feed Betano sem eventos.');
  } catch (directError) {
    context.report?.({ phase: 'direct_failed', error: directError.message });
    method = 'page_fallback';
    const page = await context.newPage();
    try {
      nba = await initialJson(page);
      football = await freshJson(page, FOOTBALL_PATH);
    } finally { await page.close().catch(() => {}); }
  }
  const games = future([...readSelections(nba), ...readSelections(football)].map(adaptTotalsAndHandicaps));
  if (!games.length) throw new Error('Betano sem odds elegíveis nas próximas 12 horas.');
  return { games, football: future(readSelections(football)), footballPayload: football,
    diagnostics: [], method, source: 'Betano JSON de eventos NBA e futebol' };
}

function parseBwinFeed(feed, football) {
  if (!Array.isArray(feed.fixtures)) throw new Error('Bwin: feed sem fixtures.');
  const games = [];
  const diagnostics = [];
  for (const fixture of feed.fixtures) {
    if (fixture.competition?.name?.value !== 'Liga Europa' || !fixture.isOpenForBetting) continue;
    const start = Date.parse(fixture.startDate);
    if (!(start > Date.now() + 600000 && start <= Date.now() + 12 * 3600000)) continue;
    const game = matchFixture(fixture, football);
    const markets = eligibleTotals(fixture);
    if (!game || !markets) { diagnostics.push({ event: fixture.name?.value, reason: 'Times, horário ou total sem correspondência.' }); continue; }
    games.push({ apiSport: game.apiSport, teams: game.teams, competition: game.competition,
      commenceTime: game.commenceTime, observedAt: new Date().toISOString(), sourceUrl: BWIN_URL,
      sourceEventId: String(fixture.id), sourceEventName: fixture.name.value,
      sourceMarket: 'Bwin Total golos (2GV excluído)', markets });
  }
  return { games, diagnostics };
}

async function bwin(context, footballSource) {
  try {
    const [football, feed] = await Promise.all([footballSource, responseJson(context, BWIN_URL)]);
    const direct = parseBwinFeed(feed, football);
    if (!direct.games.length) throw new Error('Bwin direto sem jogos elegíveis.');
    return { ...direct, method: 'direct_feed', source: 'Bwin fixtures JSON: Total golos; 2GV excluído' };
  } catch (directError) {
    context.report?.({ phase: 'direct_failed', error: directError.message });
    const football = await footballSource;
    const result = await readBwin(context, football);
    return { ...result, method: 'page_fallback', source: 'Bwin fixtures JSON: Total golos; 2GV excluído',
      diagnostics: [{ directError: directError.message }, ...result.diagnostics] };
  }
}

function parseLebullHtml(source, football, limit = 8) {
  const $ = cheerio.load(source);
  const rows = $('.game-row').toArray().map(element => ({
    teams: $(element).find('.team-column-name').toArray().map(team => $(team).attr('title') || $(team).text().trim()),
    clock: $(element).find('.betting-table-link').first().text(),
    oddsItems: $(element).find('.game-row-odds-item').toArray().map(item => ({
      title: $(item).find('.market-name').first().text().trim(),
      cells: $(item).find('.odd-cell').toArray().filter(cell => !/disabled|suspended/.test($(cell).attr('class') || ''))
        .map(cell => ({ label: $(cell).find('.odd-cell-label').first().text().trim(),
          price: $(cell).find('.odd-cell-value .rank-arrow').first().text().trim() })),
    })),
  }));
  const games = rows.map(row => ({ row, game: matchRow(row, football) })).filter(item => item.game)
    .slice(0, limit).map(({ row, game }) => {
      const markets = lebullMarkets(row.oddsItems);
      return markets && { apiSport: game.apiSport, teams: game.teams, competition: game.competition,
        commenceTime: game.commenceTime, observedAt: new Date().toISOString(), sourceUrl: LEBULL_FEED,
        sourceEventId: `${row.teams.join('-')}-${Date.parse(game.commenceTime)}`,
        sourceEventName: row.teams.join(' - '), sourceMarket: 'LeBull iframe HTML: 1X2 e totais', markets };
    }).filter(Boolean);
  return { games, diagnostics: [{ rows: rows.length }] };
}

async function lebull(context, footballSource) {
  try {
    const [football, html] = await Promise.all([footballSource, responseText(context, LEBULL_FEED)]);
    const direct = parseLebullHtml(html, football);
    if (!direct.games.length) throw new Error('LeBull direto sem jogos elegíveis.');
    return { ...direct, method: 'direct_feed', source: 'LeBull iframe HTML pré-jogo: 1X2 e totais' };
  } catch (directError) {
    context.report?.({ phase: 'direct_failed', error: directError.message });
    const football = await footballSource;
    const result = await readLebull(context, football, 8);
    return { ...result, method: 'page_fallback', source: 'LeBull iframe HTML pré-jogo: 1X2 e totais',
      diagnostics: [{ directError: directError.message }, ...result.diagnostics] };
  }
}

function parseRetabetEvent(source, game, url) {
  const $ = cheerio.load(source);
  const title = $('title').text().match(/^Aposte no (.+) com Retabet$/i)?.[1];
  const names = title?.split(/\s+-\s+/);
  $('style,script,noscript').remove();
  if (names?.length !== 2 || names.some((name, index) => retabetTeamScore(game.teams[index], name) < 0.5)
    || !eventTimeMatches($('body').text().replace(/\s+/g, ' ').slice(0, 1200), game.commenceTime)) return null;
  const markets = $('.bets__wrapper.jbet').toArray().map(wrapper => ({
    title: $(wrapper).find('.mt').first().text().trim(),
    options: $(wrapper).find('li.jopc').toArray().map(option => ({
      label: $(option).find('.jqt').first().text().trim(), price: $(option).find('.jpr').first().text().trim(),
      locked: $(option).find('.icon-lock:not(.none)').length > 0,
    })),
  }));
  const parsed = retabetMarkets(markets);
  if (!parsed) return null;
  return { apiSport: game.apiSport, teams: game.teams, competition: game.competition,
    commenceTime: game.commenceTime, observedAt: new Date().toISOString(), sourceUrl: url,
    sourceEventId: new URL(url).pathname.split('/').at(-1), sourceEventName: title,
    sourceMarket: 'HTML pré-jogo Retabet', markets: parsed };
}

async function retabet(context, footballSource) {
  try {
    const [football, html] = await Promise.all([footballSource, responseText(context, RETABET_INDEX)]);
    const $ = cheerio.load(html);
    const links = [...new Set($('a[href]').toArray().map(x => new URL($(x).attr('href'), RETABET_INDEX).href)
      .filter(url => /^https:\/\/www\.retabet\.pt\/desportos\/futebol\/.*\/\d{7,}$/.test(url)))];
    const candidates = football.map(game => ({ game, url: matchLink(game, links) })).filter(x => x.url).slice(0, 4);
    if (!candidates.length) throw new Error('Retabet direto sem eventos correspondentes.');
    const settled = await Promise.allSettled(candidates.map(async item => parseRetabetEvent(
      await responseText(context, item.url, 10000), item.game, item.url)));
    const games = settled.filter(x => x.status === 'fulfilled' && x.value).map(x => x.value).slice(0, 4);
    if (!games.length) throw new Error('Retabet direto sem mercados completos.');
    return { games, diagnostics: settled.filter(x => x.status === 'rejected').map(x => x.reason.message),
      method: 'direct_feed', source: 'Retabet HTML pré-jogo' };
  } catch (directError) {
    context.report?.({ phase: 'direct_failed', error: directError.message });
    const football = await footballSource;
    const page = await context.newPage();
    try {
      await page.goto(RETABET_INDEX, { waitUntil: 'domcontentloaded', timeout: 25000 });
      await page.locator('a[href*="/desportos/futebol/"]').first().waitFor({ timeout: 8000 });
      const $ = cheerio.load(await page.content());
      const links = [...new Set($('a[href]').toArray().map(x => new URL($(x).attr('href'), RETABET_INDEX).href)
        .filter(url => /^https:\/\/www\.retabet\.pt\/desportos\/futebol\/.*\/\d{7,}$/.test(url)))];
      const candidates = football.map(game => ({ game, url: matchLink(game, links) }))
        .filter(x => x.url).slice(0, 4);
      const responses = await browserHtml(page, candidates.map(x => x.url));
      const games = candidates.map((item, index) => responses[index].html
        && parseRetabetEvent(responses[index].html, item.game, item.url)).filter(Boolean);
      if (!games.length) throw new Error(`Retabet: ${JSON.stringify(responses.map(x => ({ status: x.status, error: x.error })))}`);
      return { games, method: 'page_fallback', source: 'Retabet HTML pré-jogo',
        diagnostics: [{ directError: directError.message }] };
    } finally { await page.close().catch(() => {}); }
  }
}

function parseEscEvent(source, game, url, label) {
  const $ = cheerio.load(source);
  $('style,script,noscript').remove();
  const shown = $('body').text().replace(/\s+/g, ' ').slice(0, 1300).match(/Hoje\s*-\s*(\d{1,2}):(\d{2})/);
  const expected = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Sao_Paulo',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(game.commenceTime));
  if (!shown || `${shown[1].padStart(2, '0')}:${shown[2]}` !== expected) return null;
  const market = $('p').filter((_, x) => $(x).text().trim() === 'Total de Golos')
    .first().closest('[data-testid="collapsible-market"]');
  if (!market.length) return null;
  const rows = market.find('[data-testid="event-details-outcome"]').toArray().map(x => ({
    name: $(x).find('[class*="OutcomeName"]').first().text().trim(),
    line: $(x).find('[class*="OutcomeBaseEventDetails"]').first().text().trim(),
    price: $(x).find('[data-testid="event-details-outcome-odds"]').first().text().trim(),
    locked: $(x).attr('data-locked') === 'true',
  }));
  const markets = parseTotals(rows);
  if (!markets.length) return null;
  return { apiSport: game.apiSport, teams: game.teams, competition: game.competition,
    commenceTime: game.commenceTime, observedAt: new Date().toISOString(), sourceUrl: url,
    sourceEventId: url.match(/-(\d+)$/)?.[1] || null, sourceEventName: label,
    sourceMarket: 'ESC Online Total de Golos; Resultado Final 2Up excluído', markets };
}

async function escOnline(context, footballSource) {
  try {
    const [football, html] = await Promise.all([footballSource, responseText(context, ESC_INDEX)]);
    const $ = cheerio.load(html);
    const links = $('a[href*="/betting/event/futebol-844/"][href*="liga-europa"]').toArray().map(x => ({
      href: new URL($(x).attr('href'), ESC_INDEX).href,
      label: $(x).find('[class*="TeamName"]').toArray().map(y => $(y).text().trim()).join('\n'),
    }));
    const matched = [...new Map(links.map(x => [x.href, x])).values()]
      .map(link => ({ link, game: matchEscLink(link, football) })).filter(x => x.game).slice(0, 4);
    if (!matched.length) throw new Error('ESC direto sem eventos correspondentes.');
    const settled = await Promise.allSettled(matched.map(async ({ link, game }) => parseEscEvent(
      await responseText(context, link.href, 10000), game, link.href, link.label.replace(/\n/g, ' - '))));
    const games = settled.filter(x => x.status === 'fulfilled' && x.value).map(x => x.value);
    if (!games.length) throw new Error('ESC direto sem totais completos.');
    return { games, diagnostics: settled.filter(x => x.status === 'rejected').map(x => x.reason.message),
      method: 'direct_feed', source: 'ESC Online Total de Golos; 2Up excluído' };
  } catch (directError) {
    context.report?.({ phase: 'direct_failed', error: directError.message });
    const football = await footballSource;
    const page = await context.newPage();
    try {
      await page.goto(ESC_INDEX, { waitUntil: 'domcontentloaded', timeout: 25000 });
      await page.locator('a[href*="/betting/event/futebol-844/"][href*="liga-europa"]')
        .first().waitFor({ timeout: 8000 });
      const $ = cheerio.load(await page.content());
      const links = $('a[href*="/betting/event/futebol-844/"][href*="liga-europa"]').toArray().map(x => ({
        href: new URL($(x).attr('href'), ESC_INDEX).href,
        label: $(x).find('[class*="TeamName"]').toArray().map(y => $(y).text().trim()).join('\n'),
      }));
      const matched = [...new Map(links.map(x => [x.href, x])).values()]
        .map(link => ({ link, game: matchEscLink(link, football) })).filter(x => x.game).slice(0, 4);
      const responses = await browserHtml(page, matched.map(x => x.link.href));
      const games = matched.map(({ link, game }, index) => responses[index].html
        && parseEscEvent(responses[index].html, game, link.href, link.label.replace(/\n/g, ' - '))).filter(Boolean);
      if (!games.length) throw new Error(`ESC: ${JSON.stringify(responses.map(x => ({ status: x.status, error: x.error })))}`);
      return { games, method: 'page_fallback', source: 'ESC Online Total de Golos; 2Up excluído',
        diagnostics: [{ directError: directError.message }] };
    } finally { await page.close().catch(() => {}); }
  }
}

async function goldenpark(context, footballSource) {
  try {
    const [football, html] = await Promise.all([footballSource, responseText(context, GOLDEN_INDEX)]);
    const $ = cheerio.load(html);
    const rows = $('.line-container.new').toArray().map(element => ({
      teams: $(element).find('.actor-1,.actor-2').map((_, x) => $(x).text().trim()).get(),
      clock: $(element).find('.date-event').text().trim(),
      href: $(element).find('a.snc-link-to-event').attr('href'),
    }));
    const matched = rows.map(row => ({ row, game: matchRow(row, football) }))
      .filter(x => x.game && x.row.href).slice(0, 4);
    if (!matched.length) throw new Error('GoldenPark direto sem eventos correspondentes.');
    const settled = await Promise.allSettled(matched.map(async ({ row, game }) => {
      const url = new URL(row.href, GOLDEN_INDEX).href;
      return parseEvent(await responseText(context, url, 10000), game, url,
        row.href.match(/\/evento\/(\d+)/)?.[1] || row.href);
    }));
    const games = settled.filter(x => x.status === 'fulfilled' && x.value).map(x => x.value);
    if (!games.length) throw new Error('GoldenPark direto sem mercados completos.');
    return { games, diagnostics: settled.filter(x => x.status === 'rejected').map(x => x.reason.message),
      method: 'direct_feed', source: 'GoldenPark HTML pré-jogo: 1X2 e Total de Golos' };
  } catch (directError) {
    context.report?.({ phase: 'direct_failed', error: directError.message });
    const football = await footballSource;
    const page = await context.newPage();
    try {
      await page.goto(GOLDEN_INDEX, { waitUntil: 'domcontentloaded', timeout: 25000 });
      await page.locator('.line-container.new').first().waitFor({ timeout: 8000 });
      const $ = cheerio.load(await page.content());
      const rows = $('.line-container.new').toArray().map(element => ({
        teams: $(element).find('.actor-1,.actor-2').map((_, x) => $(x).text().trim()).get(),
        clock: $(element).find('.date-event').text().trim(),
        href: $(element).find('a.snc-link-to-event').attr('href'),
      }));
      const matched = rows.map(row => ({ row, game: matchRow(row, football) }))
        .filter(x => x.game && x.row.href).slice(0, 4);
      const urls = matched.map(({ row }) => new URL(row.href, GOLDEN_INDEX).href);
      const responses = await browserHtml(page, urls);
      const games = matched.map(({ row, game }, index) => responses[index].html
        && parseEvent(responses[index].html, game, urls[index],
          row.href.match(/\/evento\/(\d+)/)?.[1] || row.href)).filter(Boolean);
      if (!games.length) throw new Error(`GoldenPark: ${JSON.stringify(responses.map(x => ({ status: x.status, error: x.error })))}`);
      return { games, method: 'page_fallback', source: 'GoldenPark HTML pré-jogo: 1X2 e Total de Golos',
        diagnostics: [{ directError: directError.message }] };
    } finally { await page.close().catch(() => {}); }
  }
}

module.exports = { betano, bwin, retabet, lebull, escOnline, goldenpark,
  parseBwinFeed, parseLebullHtml, parseRetabetEvent, parseEscEvent, count };
