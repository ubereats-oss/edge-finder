// Direct bookmaker feeds using the persistent Edge context's cookie jar.
// Page readers remain bounded fallbacks when a feed is unavailable.
const cheerio = require('cheerio');
const axios = require('axios');
const https = require('node:https');
const dns = require('node:dns');
const net = require('node:net');
const { PRIORITY, competition, localClock, ordered } = require('./local_competitions.cjs');
const { readSelections, adaptTotalsAndHandicaps } = require('../../pipeline/local_betano_reader.js');
const { eligibleTotals } = require('./bwin_reader.cjs');
const { parseMarkets: retabetMarkets } = require('./retabet_reader.cjs');
const { parseMarkets: lebullMarkets } = require('./lebull_reader.cjs');
const { parseTotals } = require('./esc_online_reader.cjs');
const { parseEvent } = require('./goldenpark_reader.cjs');
const { parseMarkets: betclicMarkets } = require('./betclic_reader.cjs');

const BETANO = 'https://www.betano.pt';
const NBA_PATH = '/api/sports/BASK/hot/trending/leagues/441g/events/?req=s,stnf,c,mb';
const FOOTBALL_PATH = '/api/sports/FOOT/hot/trending/leagues/433g/events/?req=s,stnf,c,mb';
const BWIN_URL = 'https://www.bwin.pt/cds-api/bettingoffer/fixtures?x-bwin-accessid=YmQwNTFkNDAtNzM3Yi00YWIyLThkNDYtYWFmNGY2N2Y1OWIx&lang=pt&country=PT&userCountry=PT&fixtureTypes=Standard&state=Latest&offerMapping=Filtered&offerCategories=Gridable&fixtureCategories=Gridable,NonGridable,Other&sportIds=4&isPriceBoost=false&statisticsModes=None&skip=0&take=50&sortBy=Tags';
const RETABET_INDEX = 'https://www.retabet.pt/desportos/futebol/1';
const LEBULL_FEED = 'https://lebullpt-ssr.boxwebcdn.work/pt';
const ESC_INDEX = 'https://www.estorilsolcasinos.pt/pt/betting/sport/futebol-844/matches/date-0';
const GOLDEN_INDEX = 'https://apostas.goldenpark.pt/competicao/6675-liga-europa?jogar=si';
const GOLDEN_SPORT = 'https://apostas.goldenpark.pt/desporte/13-futebol';
const BETCLIC_HOME = 'https://www.betclic.pt/futebol-s1';
const BETCLIC_EUROPA = 'https://www.betclic.pt/futebol-sfootball/liga-europa-c3453';
const count = games => games.reduce((sum, game) => sum + game.markets.reduce((n, market) => n + market.selections.length, 0), 0);
const rank = identity => PRIORITY.findIndex(([key]) => key === identity?.apiSport);
const resolver = new dns.promises.Resolver();
resolver.setServers(['1.1.1.1', '8.8.8.8']);
const httpsAgent = new https.Agent({ keepAlive: true, lookup(host, options, callback) {
  const ipFamily = net.isIP(host);
  if (ipFamily) return options.all
    ? callback(null, [{ address: host, family: ipFamily }])
    : callback(null, host, ipFamily);
  resolver.resolve4(host).then(addresses => options.all
    ? callback(null, addresses.map(address => ({ address, family: 4 })))
    : callback(null, addresses[0], 4), callback);
} });

async function responseText(context, url, timeout = 8000) {
  const response = await axios.get(url, { timeout, proxy: false, httpsAgent,
    maxRedirects: 4, validateStatus: () => true,
    headers: { 'cache-control': 'no-cache' }, responseType: 'text' });
  if (response.status !== 200) throw new Error(`HTTP ${response.status}: ${url}`);
  return response.data;
}

async function responseJson(context, url, timeout = 8000) {
  const text = await responseText(context, url, timeout);
  return typeof text === 'string' ? JSON.parse(text) : text;
}

async function browserHtml(page, urls, timeout = 8000) {
  return page.evaluate(async ({ targets, timeoutMs }) => Promise.all(targets.map(async url => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { credentials: 'include', cache: 'no-store', signal: controller.signal });
      return { url, status: response.status, html: response.ok ? await response.text() : null };
    } catch (error) { return { url, error: String(error) }; }
    finally { clearTimeout(timer); }
  })), { targets: urls, timeoutMs: timeout });
}

function future(games) {
  return games.filter(game => {
    const delta = Date.parse(game.commenceTime) - Date.now();
    return delta > 600000 && delta <= 12 * 3600000;
  });
}

async function betano(context) {
  const payloads = [];
  const diagnostics = [];
  const missingPaths = [];
  const direct = await Promise.allSettled([FOOTBALL_PATH, NBA_PATH].map(path =>
    responseJson(context, BETANO + path, 20000)));
  for (const [index, result] of direct.entries()) {
    if (result.status === 'fulfilled' && Array.isArray(result.value?.data?.events))
      payloads.push(result.value);
    else {
      missingPaths.push([FOOTBALL_PATH, NBA_PATH][index]);
      diagnostics.push({ phase: 'direct_feed', error: result.reason?.message || 'Feed sem eventos.' });
    }
  }
  const page = await context.newPage();
  try {
    const pending = [];
    page.on('response', response => {
      if (response.status() === 200 && /\/api\/sports\/(FOOT|BASK)\/.*\/events/.test(response.url()))
        pending.push(response.json().catch(() => null));
    });
    await page.goto('https://www.betano.pt/sport/futebol',
      { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(3000);
    payloads.push(...(await Promise.all(pending)).filter(data => Array.isArray(data?.data?.events)));
    for (const path of missingPaths) {
      try {
        const response = await page.goto(BETANO + path,
          { waitUntil: 'domcontentloaded', timeout: 20000 });
        if (response?.status() !== 200) throw new Error(`HTTP ${response?.status()}: ${response?.url()}`);
        const data = await response.json();
        if (!Array.isArray(data?.data?.events)) throw new Error(`Betano: JSON sem eventos: ${path}`);
        payloads.push(data);
      } catch (error) { diagnostics.push({ phase: 'edge_feed', error: error.message }); }
    }
  } catch (error) { diagnostics.push({ phase: 'own_listing', error: error.message }); }
  finally { await page.close().catch(() => {}); }
  const byEvent = new Map();
  for (const payload of payloads) for (const game of readSelections(payload))
    byEvent.set(`${game.apiSport}|${game.sourceEventId}`, adaptTotalsAndHandicaps(game));
  const games = ordered(future([...byEvent.values()]));
  if (!games.length) throw new Error(`Betano sem odds elegíveis nas próximas 12 horas: ${
    diagnostics.map(row => row.error).join('; ') || 'listagens sem eventos das ligas alvo'}`);
  return { games, diagnostics, method: 'own_listing', source: 'Betano JSON da própria listagem' };
}

function parseBwinFeed(feed) {
  if (!Array.isArray(feed.fixtures)) throw new Error('Bwin: feed sem fixtures.');
  const games = [];
  const diagnostics = [];
  for (const fixture of feed.fixtures) {
    if (!fixture.isOpenForBetting) continue;
    const identity = competition(fixture.competition?.name?.value);
    if (!identity || identity.apiSport === 'basketball_nba') continue;
    const teams = String(fixture.name?.value || '').split(' - ').map(name => name.trim());
    if (teams.length !== 2 || teams.some(name => !name)) continue;
    const start = Date.parse(fixture.startDate);
    if (!(start > Date.now() + 600000 && start <= Date.now() + 12 * 3600000)) continue;
    const markets = eligibleTotals(fixture);
    if (!markets) { diagnostics.push({ event: fixture.name?.value, reason: 'Total de golos indisponível.' }); continue; }
    games.push({ ...identity, teams,
      commenceTime: new Date(start).toISOString(), observedAt: new Date().toISOString(), sourceUrl: BWIN_URL,
      sourceEventId: String(fixture.id), sourceEventName: fixture.name.value,
      sourceMarket: 'Bwin Total golos (2GV excluído)', markets });
  }
  return { games: ordered(games), diagnostics };
}

async function bwin(context) {
  try {
    const feed = await responseJson(context, BWIN_URL, 20000);
    const direct = parseBwinFeed(feed);
    if (!direct.games.length) throw new Error('Bwin direto sem jogos elegíveis.');
    return { ...direct, method: 'direct_feed', source: 'Bwin fixtures JSON: Total golos; 2GV excluído' };
  } catch (directError) {
    context.report?.({ phase: 'direct_failed', error: directError.message });
    const page = await context.newPage();
    let result;
    try {
      const pending = page.waitForResponse(response => response.status() === 200
        && response.url().includes('/cds-api/bettingoffer/fixtures?')
        && response.url().includes('sportIds=4'), { timeout: 45000 });
      await page.goto('https://www.bwin.pt/pt/sports/futebol-4/apostar',
        { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
      result = parseBwinFeed(await (await pending).json());
    } finally { await page.close().catch(() => {}); }
    return { ...result, method: 'page_fallback', source: 'Bwin fixtures JSON: Total golos; 2GV excluído',
      diagnostics: [{ directError: directError.message }, ...result.diagnostics] };
  }
}

function parseLebullHtml(source, limit = 8) {
  const $ = cheerio.load(source);
  const rows = $('.game-row').toArray().map(element => ({
    league: $(element).parent().children().first().text().trim(),
    teams: $(element).find('.team-column-name').toArray().map(team => $(team).attr('title') || $(team).text().trim()),
    clock: $(element).find('.betting-table-link').first().text(),
    oddsItems: $(element).find('.game-row-odds-item').toArray().map(item => ({
      title: $(item).find('.market-name').first().text().trim(),
      cells: $(item).find('.odd-cell').toArray().filter(cell => !/disabled|suspended/.test($(cell).attr('class') || ''))
        .map(cell => ({ label: $(cell).find('.odd-cell-label').first().text().trim(),
          price: $(cell).find('.odd-cell-value .rank-arrow').first().text().trim() })),
    })),
  }));
  const games = rows.map(row => ({ row, identity: competition(row.league),
    commenceTime: localClock(row.clock, 'America/Sao_Paulo') }))
    .filter(item => item.identity && item.identity.apiSport.startsWith('soccer_')
      && item.row.teams.length === 2 && item.commenceTime
      && Date.parse(item.commenceTime) > Date.now() + 600000
      && Date.parse(item.commenceTime) <= Date.now() + 12 * 3600000)
    .map(({ row, identity, commenceTime }) => {
      const markets = lebullMarkets(row.oddsItems);
      return markets && { ...identity, teams: row.teams,
        commenceTime, observedAt: new Date().toISOString(), sourceUrl: LEBULL_FEED,
        sourceEventId: `${row.teams.join('-')}-${Date.parse(commenceTime)}`,
        sourceEventName: row.teams.join(' - '), sourceMarket: 'LeBull iframe HTML: 1X2 e totais', markets };
    }).filter(Boolean);
  return { games: ordered(games).slice(0, limit), diagnostics: [{ rows: rows.length }] };
}

async function lebull(context) {
  try {
    const html = await responseText(context, LEBULL_FEED, 20000);
    const direct = parseLebullHtml(html);
    if (!direct.games.length) throw new Error('LeBull direto sem jogos elegíveis.');
    return { ...direct, method: 'direct_feed', source: 'LeBull iframe HTML pré-jogo: 1X2 e totais' };
  } catch (directError) {
    context.report?.({ phase: 'direct_failed', error: directError.message });
    const page = await context.newPage();
    let result;
    try {
      await page.goto('https://www.lebull.pt/apostas-desportivas',
        { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.frameLocator('iframe[src*="lebullpt-ssr.boxwebcdn.work"]')
        .locator('.game-row .team-column-name').first().waitFor({ timeout: 50000 });
      const frame = page.frames().find(item => item.url().includes('lebullpt-ssr.boxwebcdn.work/pt'));
      if (!frame) throw new Error('LeBull: iframe de odds não carregou em 50 s.');
      result = parseLebullHtml(await frame.content());
      if (!result.games.length) throw new Error('LeBull: quadro carregado, sem jogos elegíveis nas ligas e janela configuradas.');
    } finally { await page.close().catch(() => {}); }
    return { ...result, method: 'page_fallback', source: 'LeBull iframe HTML pré-jogo: 1X2 e totais',
      diagnostics: [{ directError: directError.message }, ...result.diagnostics] };
  }
}

function parseRetabetEvent(source, url) {
  const $ = cheerio.load(source);
  $('style,script,noscript').remove();
  const title = $('title').text().match(/^Aposte no (.+) com Retabet$/i)?.[1];
  const names = title?.split(/\s+-\s+/);
  const header = $('body').text().replace(/\s+/g, ' ');
  const leagueText = $('[class*="breadcrumb"], [class*="competition-name"], [class*="league-name"]')
    .toArray().map(element => $(element).text().trim()).find(text => competition(text));
  const identity = retabetLeague(url);
  const commenceTime = localClock(header, 'Europe/Lisbon');
  if (names?.length !== 2 || !identity || (leagueText && competition(leagueText)?.apiSport !== identity.apiSport)
    || !commenceTime || Date.parse(commenceTime) <= Date.now() + 600000
    || Date.parse(commenceTime) > Date.now() + 12 * 3600000) return null;
  const markets = $('.bets__wrapper.jbet').toArray().map(wrapper => ({
    title: $(wrapper).find('.mt').first().text().trim(),
    options: $(wrapper).find('li.jopc').toArray().map(option => ({
      label: $(option).find('.jqt').first().text().trim(), price: $(option).find('.jpr').first().text().trim(),
      locked: $(option).find('.icon-lock:not(.none)').length > 0,
    })),
  }));
  const parsed = retabetMarkets(markets);
  if (!parsed) return null;
  return { ...identity, teams: names,
    commenceTime, observedAt: new Date().toISOString(), sourceUrl: url,
    sourceEventId: new URL(url).pathname.split('/').at(-1), sourceEventName: title,
    sourceMarket: 'HTML pré-jogo Retabet', markets: parsed };
}

const RETABET_ROUTES = new Map([
  ['internacional/liga-europa', 'soccer_uefa_europa_league'],
  ['internacional/liga-dos-campeoes', 'soccer_uefa_champs_league'],
  ['portugal/primeira-liga', 'soccer_portugal_primeira_liga'],
  ['inglaterra/premier-league', 'soccer_epl'],
  ['espanha/laliga', 'soccer_spain_la_liga'],
  ['italia/serie-a', 'soccer_italy_serie_a'],
  ['alemanha/bundesliga', 'soccer_germany_bundesliga'],
  ['fran-a/ligue-1', 'soccer_france_ligue_one'],
  ['paises-baixos/eredivisie', 'soccer_netherlands_eredivisie'],
  ['inglaterra/inglaterra-championship', 'soccer_efl_champ'],
]);
function retabetLeague(url) {
  const parts = new URL(url).pathname.split('/');
  if (parts[1] !== 'desportos' || parts[2] !== 'futebol' || !/^\d{7,}$/.test(parts.at(-1))) return null;
  const key = RETABET_ROUTES.get(`${parts[3]}/${parts[4]}`);
  const entry = PRIORITY.find(([apiSport]) => apiSport === key);
  return entry ? { apiSport: entry[0], competition: entry[1] } : null;
}

async function retabet(context) {
  try {
    const html = await responseText(context, RETABET_INDEX, 20000);
    const $ = cheerio.load(html);
    const links = [...new Set($('a[href]').toArray().map(x => new URL($(x).attr('href'), RETABET_INDEX).href)
      .filter(url => url.startsWith('https://www.retabet.pt/') && retabetLeague(url)))];
    if (!links.length) throw new Error('Retabet direto sem eventos listados.');
    const settled = await Promise.allSettled(links.slice(0, 12).map(async url => parseRetabetEvent(
      await responseText(context, url, 20000), url)));
    const games = ordered(settled.filter(x => x.status === 'fulfilled' && x.value).map(x => x.value)).slice(0, 4);
    if (!games.length) throw new Error('Retabet direto sem mercados completos.');
    return { games, diagnostics: settled.filter(x => x.status === 'rejected').map(x => x.reason.message),
      method: 'direct_feed', source: 'Retabet HTML pré-jogo' };
  } catch (directError) {
    context.report?.({ phase: 'direct_failed', error: directError.message });
    const page = await context.newPage();
    try {
      await page.goto(RETABET_INDEX, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.locator('a[href*="/desportos/futebol/"]').first().waitFor({ timeout: 20000 });
      const $ = cheerio.load(await page.content());
      const links = [...new Set($('a[href]').toArray().map(x => new URL($(x).attr('href'), RETABET_INDEX).href)
        .filter(url => url.startsWith('https://www.retabet.pt/') && retabetLeague(url)))];
      const candidates = links.slice(0, 12);
      const responses = await browserHtml(page, candidates, 20000);
      const games = ordered(candidates.map((url, index) => responses[index].html
        && parseRetabetEvent(responses[index].html, url)).filter(Boolean)).slice(0, 4);
      if (!games.length) throw new Error(`Retabet: ${responses.length} páginas consultadas, nenhuma com liga, horário e mercados completos; ${JSON.stringify(responses.map(x => ({ status: x.status, error: x.error })))}`);
      return { games, method: 'page_fallback', source: 'Retabet HTML pré-jogo',
        diagnostics: [{ directError: directError.message }] };
    } finally { await page.close().catch(() => {}); }
  }
}

function parseEscEvent(source, url, label) {
  const $ = cheerio.load(source);
  $('style,script,noscript').remove();
  const identity = competition(url);
  const teams = label.split(/\n+|\s+-\s+/).map(value => value.trim()).filter(Boolean);
  const commenceTime = localClock($('body').text().replace(/\s+/g, ' ').slice(0, 1300),
    'America/Sao_Paulo');
  if (!identity || !identity.apiSport.startsWith('soccer_') || teams.length !== 2
    || !commenceTime || Date.parse(commenceTime) <= Date.now() + 600000
    || Date.parse(commenceTime) > Date.now() + 12 * 3600000) return null;
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
  return { ...identity, teams,
    commenceTime, observedAt: new Date().toISOString(), sourceUrl: url,
    sourceEventId: url.match(/-(\d+)$/)?.[1] || null, sourceEventName: label,
    sourceMarket: 'ESC Online Total de Golos; Resultado Final 2Up excluído', markets };
}

async function escOnline(context) {
  try {
    const html = await responseText(context, ESC_INDEX, 20000);
    const $ = cheerio.load(html);
    const links = $('a[href*="/betting/event/futebol-844/"]').toArray().map(x => ({
      href: new URL($(x).attr('href'), ESC_INDEX).href,
      label: $(x).find('[class*="TeamName"]').toArray().map(y => $(y).text().trim()).join('\n'),
    }));
    const matched = [...new Map(links.map(x => [x.href, x])).values()]
      .filter(link => competition(link.href) && link.label.split('\n').length === 2).slice(0, 8);
    if (!matched.length) throw new Error('ESC direto sem eventos listados nas ligas alvo.');
    const settled = await Promise.allSettled(matched.map(link => responseText(context, link.href, 20000)
      .then(html => parseEscEvent(html, link.href, link.label))));
    const games = ordered(settled.filter(x => x.status === 'fulfilled' && x.value).map(x => x.value)).slice(0, 4);
    if (!games.length) throw new Error('ESC direto sem totais completos.');
    return { games, diagnostics: settled.filter(x => x.status === 'rejected').map(x => x.reason.message),
      method: 'direct_feed', source: 'ESC Online Total de Golos; 2Up excluído' };
  } catch (directError) {
    context.report?.({ phase: 'direct_failed', error: directError.message });
    const page = await context.newPage();
    try {
      await page.goto(ESC_INDEX, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.locator('a[href*="/betting/event/futebol-844/"]')
        .first().waitFor({ timeout: 20000 });
      const $ = cheerio.load(await page.content());
      const links = $('a[href*="/betting/event/futebol-844/"]').toArray().map(x => ({
        href: new URL($(x).attr('href'), ESC_INDEX).href,
        label: $(x).find('[class*="TeamName"]').toArray().map(y => $(y).text().trim()).join('\n'),
      }));
      const matched = [...new Map(links.map(x => [x.href, x])).values()]
        .filter(link => competition(link.href) && link.label.split('\n').length === 2)
        .sort((a, b) => rank(competition(a.href)) - rank(competition(b.href))).slice(0, 4);
      const settled = await Promise.allSettled(matched.map(async link => {
        const eventPage = await context.newPage();
        try {
          await eventPage.goto(link.href, { waitUntil: 'domcontentloaded', timeout: 45000 });
          await eventPage.locator('[data-testid="event-details-outcome"]').first()
            .waitFor({ timeout: 25000 });
          return parseEscEvent(await eventPage.content(), link.href, link.label);
        } finally { await eventPage.close().catch(() => {}); }
      }));
      const games = ordered(settled.filter(x => x.status === 'fulfilled' && x.value)
        .map(x => x.value));
      if (!games.length) throw new Error(`ESC: ${JSON.stringify(settled.map(x => x.status === 'rejected'
        ? x.reason.message : 'Mercado ou horário indisponível'))}`);
      return { games, method: 'page_fallback', source: 'ESC Online Total de Golos; 2Up excluído',
        diagnostics: [{ directError: directError.message }] };
    } finally { await page.close().catch(() => {}); }
  }
}

function goldenparkRows(html, indexUrl) {
  const $ = cheerio.load(html);
  const identity = competition(indexUrl);
  if (!identity || !identity.apiSport.startsWith('soccer_')) return [];
  return $('.line-container.new').toArray().map(element => ({
    teams: $(element).find('.actor-1,.actor-2').map((_, x) => $(x).text().trim()).get(),
    clock: $(element).find('.date-event').text().trim(),
    href: $(element).find('a.snc-link-to-event').attr('href'),
  })).map(row => ({ ...row, ...identity,
    commenceTime: localClock(row.clock, 'America/Sao_Paulo') }))
    .filter(row => row.teams.length === 2 && row.href && row.commenceTime
      && Date.parse(row.commenceTime) > Date.now() + 600000
      && Date.parse(row.commenceTime) <= Date.now() + 12 * 3600000);
}

async function goldenpark(context) {
  let indexes = [GOLDEN_INDEX];
  try {
    try {
      const catalogs = await Promise.allSettled([GOLDEN_SPORT, GOLDEN_INDEX]
        .map(url => responseText(context, url, 20000)));
      indexes = [...new Set([...indexes, ...catalogs.flatMap(result => {
        if (result.status !== 'fulfilled') return [];
        const $ = cheerio.load(result.value);
        return $('a[href*="/competicao/"]').toArray()
          .map(element => new URL($(element).attr('href'), GOLDEN_INDEX).href)
          .filter(url => competition(url)?.apiSport.startsWith('soccer_'));
      })])]
        .sort((a, b) => rank(competition(a)) - rank(competition(b)));
    } catch (error) { context.report?.({ phase: 'goldenpark_catalog_failed', error: error.message }); }
    const pages = await Promise.allSettled(indexes.slice(0, 10).map(url => responseText(context, url, 20000)
      .then(html => goldenparkRows(html, url))));
    const matched = pages.flatMap(result => result.status === 'fulfilled' ? result.value : [])
      .sort((a, b) => rank(a) - rank(b) || Date.parse(a.commenceTime) - Date.parse(b.commenceTime)).slice(0, 8);
    if (!matched.length) throw new Error('GoldenPark direto sem eventos listados.');
    const settled = await Promise.allSettled(matched.map(async row => {
      const url = new URL(row.href, GOLDEN_INDEX).href;
      return parseEvent(await responseText(context, url, 20000), row, url,
        row.href.match(/\/evento\/(\d+)/)?.[1] || row.href);
    }));
    const games = ordered(settled.filter(x => x.status === 'fulfilled' && x.value).map(x => x.value)).slice(0, 4);
    if (!games.length) throw new Error('GoldenPark direto sem mercados completos.');
    return { games, diagnostics: settled.filter(x => x.status === 'rejected').map(x => x.reason.message),
      method: 'direct_feed', source: 'GoldenPark HTML pré-jogo: 1X2 e Total de Golos' };
  } catch (directError) {
    context.report?.({ phase: 'direct_failed', error: directError.message });
    const page = await context.newPage();
    try {
      const deadline = Date.now() + 105000;
      const matched = [];
      const empty = [];
      for (const indexUrl of indexes.slice(0, 10)) {
        if (Date.now() >= deadline || matched.length >= 8) break;
        try {
          const response = await page.goto(indexUrl, { waitUntil: 'domcontentloaded',
            timeout: Math.min(12000, deadline - Date.now()) });
          await page.locator('.line-container.new').first().waitFor({
            timeout: Math.min(4000, Math.max(1, deadline - Date.now())) }).catch(() => {});
          const rows = goldenparkRows(await page.content(), indexUrl);
          if (rows.length) matched.push(...rows.slice(0, 8 - matched.length));
          else empty.push({ liga: competition(indexUrl)?.competition, status: response?.status(), motivo: 'sem jogos na janela' });
        } catch (error) {
          empty.push({ liga: competition(indexUrl)?.competition, motivo: error.message });
        }
      }
      context.report?.({ phase: 'goldenpark_leagues', details: empty });
      const urls = matched.map(row => new URL(row.href, GOLDEN_INDEX).href);
      const responses = await browserHtml(page, urls);
      const games = ordered(matched.map((row, index) => responses[index].html
        && parseEvent(responses[index].html, row, urls[index],
          row.href.match(/\/evento\/(\d+)/)?.[1] || row.href)).filter(Boolean));
      if (!games.length) throw new Error(`GoldenPark: nenhuma liga prioritária com jogos e mercados completos; ${JSON.stringify(empty)}; ${JSON.stringify(responses.map(x => ({ status: x.status, error: x.error })))}`);
      return { games, method: 'page_fallback', source: 'GoldenPark HTML pré-jogo: 1X2 e Total de Golos',
        diagnostics: [{ directError: directError.message }] };
    } finally { await page.close().catch(() => {}); }
  }
}

function betclicCards(html, url) {
  const $ = cheerio.load(html);
  return $('a.cardEvent').toArray().map(element => {
    const card = $(element);
    const label = card.attr('aria-label') || '';
    const teams = label.split(/\s+-\s+/).map(name => name.trim());
    const identity = competition(card.text()) || competition(url);
    const day = card.closest('.groupEvents').find('.groupEvents_head').first().text().trim();
    const clock = card.text().match(/\b\d{1,2}:\d{2}\b/)?.[0];
    const commenceTime = localClock(`${day} ${clock || ''}`, 'Europe/Lisbon');
    const href = card.attr('href');
    return teams.length === 2 && teams.every(Boolean) && identity && commenceTime && href
      ? { ...identity, teams, commenceTime, label, href: new URL(href, url).href } : null;
  }).filter(row => row && Date.parse(row.commenceTime) > Date.now() + 600000
    && Date.parse(row.commenceTime) <= Date.now() + 12 * 3600000);
}

function parseBetclicEvent(html, card) {
  const $ = cheerio.load(html);
  const boxes = $('[data-qa="market-box"]').toArray().map(box => ({
    title: $(box).find('[data-qa="market-title"]').first().text().trim(),
    rows: $(box).find('.marketBox_lineSelection').toArray().map(row => ({
      label: $(row).find('.marketBox_label').first().text().trim()
        || $(row).find('bc-button-label').first().text().trim(),
      price: $(row).find('[data-qa="market-selection"] bcdk-bet-button-odds-animated').first().text().trim(),
    })),
  }));
  const markets = betclicMarkets(boxes);
  return markets && { apiSport: card.apiSport, competition: card.competition,
    teams: card.teams, commenceTime: card.commenceTime, observedAt: new Date().toISOString(),
    sourceUrl: card.href, sourceEventId: card.href.match(/-m(\d+)$/)?.[1] || null,
    sourceEventName: card.label,
    sourceMarket: 'Betclic HTML pré-jogo: resultado regulamentar e total de golos', markets };
}

async function betclic(context) {
  const catalog = await responseText(context, BETCLIC_HOME, 20000);
  const $ = cheerio.load(catalog);
  const leagues = [...new Set([BETCLIC_EUROPA, ...$('a[href]').toArray()
    .map(element => new URL($(element).attr('href'), BETCLIC_HOME).href)
    .filter(url => url.startsWith('https://www.betclic.pt/') && competition(url))])]
    .sort((a, b) => rank(competition(a)) - rank(competition(b))).slice(0, 10);
  const lists = await Promise.allSettled(leagues.map(url => responseText(context, url, 20000)
    .then(html => betclicCards(html, url))));
  const cards = lists.flatMap(result => result.status === 'fulfilled' ? result.value : [])
    .sort((a, b) => rank(a) - rank(b) || Date.parse(a.commenceTime) - Date.parse(b.commenceTime))
    .slice(0, 8);
  if (!cards.length) throw new Error('Betclic: listagem própria sem jogos das ligas alvo nas próximas 12 horas.');
  const events = await Promise.allSettled(cards.map(card => responseText(context, card.href, 20000)
    .then(html => parseBetclicEvent(html, card))));
  const games = ordered(events.filter(result => result.status === 'fulfilled' && result.value)
    .map(result => result.value));
  if (!games.length) throw new Error('Betclic: jogos listados sem mercados completos.');
  return { games, method: 'direct_feed', source: 'Betclic HTML pré-jogo: resultado e total de golos',
    diagnostics: [...lists, ...events].filter(result => result.status === 'rejected')
      .map(result => result.reason.message) };
}

module.exports = { betano, bwin, retabet, lebull, escOnline, goldenpark, betclic,
  parseBwinFeed, parseLebullHtml, parseRetabetEvent, parseEscEvent,
  betclicCards, parseBetclicEvent, retabetLeague, count, responseText };
