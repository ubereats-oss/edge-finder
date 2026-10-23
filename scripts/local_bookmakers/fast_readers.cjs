// Direct bookmaker feeds using the persistent Edge context's cookie jar.
// Page readers remain bounded fallbacks when a feed is unavailable.
const cheerio = require('cheerio');
const axios = require('axios');
const https = require('node:https');
const dns = require('node:dns');
const net = require('node:net');
const fs = require('node:fs');
const path = require('node:path');
const { PRIORITY, competition, localClock, ordered } = require('./local_competitions.cjs');
const { readSelections, adaptTotalsAndHandicaps } = require('../../pipeline/local_betano_reader.js');
const { eligibleTotals } = require('./bwin_reader.cjs');
const { parseMarkets: retabetMarkets } = require('./retabet_reader.cjs');
const { parseMarkets: lebullMarkets } = require('./lebull_reader.cjs');
const { parseTotals } = require('./esc_online_reader.cjs');
const { parseEvent } = require('./goldenpark_reader.cjs');
const { parseMarkets: betclicMarkets } = require('./betclic_reader.cjs');
const { namesEqual } = require('../../functions/placard_value.js');

const BETANO = 'https://www.betano.pt';
const BETANO_LEAGUES = [
  ['basketball_nba', 'BASK', '441g'],
  ['soccer_uefa_europa_league', 'FOOT', '433g'],
  ['soccer_uefa_champs_league', 'FOOT', '432g'],
  ['soccer_portugal_primeira_liga', 'FOOT', '17083'],
  ['soccer_epl', 'FOOT', '1'],
  ['soccer_spain_la_liga', 'FOOT', '5'],
  ['soccer_italy_serie_a', 'FOOT', '1635'],
  ['soccer_germany_bundesliga', 'FOOT', '216'],
  ['soccer_france_ligue_one', 'FOOT', '215'],
  ['soccer_netherlands_eredivisie', 'FOOT', '17067'],
  ['soccer_efl_champ', 'FOOT', '2'],
];
const betanoPath = ([, sport, id]) => `/api/sports/${sport}/hot/trending/leagues/${id}/events/?req=s,stnf,c,mb`;
const BWIN_URL = 'https://www.bwin.pt/cds-api/bettingoffer/fixtures?x-bwin-accessid=YmQwNTFkNDAtNzM3Yi00YWIyLThkNDYtYWFmNGY2N2Y1OWIx&lang=pt&country=PT&userCountry=PT&fixtureTypes=Standard&state=Latest&offerMapping=Filtered&offerCategories=Gridable&fixtureCategories=Gridable,NonGridable,Other&sportIds=4&isPriceBoost=false&statisticsModes=None&skip=0&take=200&sortBy=Tags';
const BWIN_BASKETBALL_URL = BWIN_URL.replace('sportIds=4', 'sportIds=7');
const RETABET_INDEX = 'https://www.retabet.pt/desportos/futebol/1';
const RETABET_BASKETBALL_INDEX = 'https://www.retabet.pt/desportos/basquetebol/5';
const LEBULL_FEED = 'https://lebullpt-ssr.boxwebcdn.work/pt';
const ESC_INDEX = 'https://www.estorilsolcasinos.pt/pt/betting/sport/futebol-844/matches/date-0';
const ESC_NBA = 'https://www.estorilsolcasinos.pt/pt/betting/league/basquetebol-850/65584/nba-815111577';
const ESC_ALL_LEAGUES = 'https://www.estorilsolcasinos.pt/pt/betting/sport/futebol-844/all-leagues';
const GOLDEN_INDEX = 'https://apostas.goldenpark.pt/competicao/6675-liga-europa?jogar=si';
const GOLDEN_SPORT = 'https://apostas.goldenpark.pt/desporte/13-futebol';
const GOLDEN_KNOWN_LEAGUES = [
  'https://apostas.goldenpark.pt/competicao/206-nba',
  GOLDEN_INDEX,
  'https://apostas.goldenpark.pt/competicao/154-primeira-liga',
  'https://apostas.goldenpark.pt/competicao/94-premier-league',
  'https://apostas.goldenpark.pt/competicao/306-laliga',
  'https://apostas.goldenpark.pt/competicao/305-serie-a',
  'https://apostas.goldenpark.pt/competicao/268-bundesliga',
  'https://apostas.goldenpark.pt/competicao/96-ligue-1-mcdonald-s-r',
];
const BETCLIC_HOME = 'https://www.betclic.pt/futebol-s1';
const BETCLIC_EUROPA = 'https://www.betclic.pt/futebol-sfootball/liga-europa-c3453';
const BETCLIC_NBA = 'https://www.betclic.pt/basketball-sbasketball/nba-c13';
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

const diagnosticPruned = new Set();
function saveDiscard(house, url, html, reason) {
  const dir = path.resolve(__dirname, '../../.local_logs/betano/diagnostics', house);
  fs.mkdirSync(dir, { recursive: true });
  if (!diagnosticPruned.has(house)) {
    const oldest = Date.now() - 3 * 86400000;
    for (const name of fs.readdirSync(dir)) {
      const file = path.join(dir, name);
      if (fs.statSync(file).isFile() && fs.statSync(file).mtimeMs < oldest) fs.unlinkSync(file);
    }
    diagnosticPruned.add(house);
  }
  const $ = cheerio.load(String(html || ''));
  const markets = $('[data-qa="market-box"],.container-event,.line-container.new').toArray()
    .map(element => ({ title: $(element).find('[data-qa="market-title"],.question-header p').first().text().trim(),
      text: $(element).text().trim() }));
  const stem = `${new Date().toISOString().replace(/[:.]/g, '-')}-${Math.random().toString(36).slice(2, 8)}`;
  fs.writeFileSync(path.join(dir, `${stem}.html`), String(html || ''));
  fs.writeFileSync(path.join(dir, `${stem}.json`), JSON.stringify({ at: new Date().toISOString(),
    url, reason, markets }, null, 2));
}

async function responseText(context, url, timeout = 8000, diagnosticHouse = null) {
  let response;
  try { response = await axios.get(url, { timeout, proxy: false, httpsAgent,
    maxRedirects: 4, validateStatus: () => true,
    headers: { 'cache-control': 'no-cache' }, responseType: 'text' }); }
  catch (error) {
    if (diagnosticHouse) saveDiscard(diagnosticHouse, url, '', error.message);
    throw error;
  }
  context.report?.({ phase: 'http', url, httpStatus: response.status });
  if (response.status !== 200) {
    if (diagnosticHouse) saveDiscard(diagnosticHouse, url, response.data, `HTTP ${response.status}`);
    throw new Error(`HTTP ${response.status}: ${url}`);
  }
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
  const direct = await Promise.allSettled(BETANO_LEAGUES.map(league =>
    responseJson(context, BETANO + betanoPath(league), 20000)));
  for (const [index, result] of direct.entries()) {
    const league = BETANO_LEAGUES[index];
    if (result.status === 'fulfilled' && Array.isArray(result.value?.data?.events))
      payloads.push({ league, payload: result.value, url: BETANO + betanoPath(league), status: 200 });
    else {
      missingPaths.push(league);
      diagnostics.push({ phase: 'direct_feed', league: league[0],
        error: result.reason?.message || 'Feed sem eventos.' });
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
    await Promise.all(pending);
    const urls = missingPaths.map(league => BETANO + betanoPath(league));
    const responses = await browserHtml(page, urls, 20000);
    for (let index = 0; index < missingPaths.length; index++) {
      const league = missingPaths[index], response = responses[index];
      try {
        if (response.status !== 200) throw new Error(`HTTP ${response.status ?? 'desconhecido'}: ${response.url}`);
        const data = JSON.parse(response.html);
        if (!Array.isArray(data?.data?.events)) throw new Error(`Betano: JSON sem eventos: ${response.url}`);
        payloads.push({ league, payload: data, url: response.url, status: 200 });
        diagnostics.push({ phase: 'edge_feed', status: 200, events: data.data.events.length, path: response.url });
      } catch (error) { diagnostics.push({ phase: 'edge_feed', league: league[0], error: error.message }); }
    }
  } catch (error) { diagnostics.push({ phase: 'own_listing', error: error.message }); }
  finally { await page.close().catch(() => {}); }
  const byEvent = new Map();
  for (const { league, payload, url, status } of payloads) {
    const parsed = readSelections(payload);
    const accepted = new Map(parsed.map(game => [String(game.sourceEventId), game]));
    const events = payload.data.events.map(event => {
      const game = accepted.get(String(event.id));
      const teams = (event.participants || []).map(participant => participant.name).filter(Boolean);
      const start = Number(event.startTime);
      const rawMarkets = Array.isArray(event.markets) ? event.markets
        : (event.sixPackBlocks || []).flatMap(block => block.columns || []);
      const identity = competition(event.leagueName || event.leagueDescription || '');
      const reason = teams.length !== 2 ? 'times incompletos'
        : !Number.isFinite(start) ? 'horário inválido'
          : !identity ? 'liga não reconhecida no evento'
            : !rawMarkets.length ? 'mercados ausentes no evento'
              : !game ? 'mercados sem seleções completas ou código não suportado'
        : game.apiSport !== league[0] ? 'competição diferente da liga consultada'
          : start <= Date.now() + 600000 || start > Date.now() + 12 * 3600000
            ? 'fora da janela de 12 horas' : 'aceito';
      if (reason === 'aceito') byEvent.set(`${game.apiSport}|${game.sourceEventId}`,
        adaptTotalsAndHandicaps(game));
      return { teams, commenceTime: Number.isFinite(start) ? new Date(start).toISOString() : null,
        reason, eventId: String(event.id), leagueName: event.leagueName,
        marketTypes: rawMarkets.map(market => market.type) };
    });
    context.report?.({ phase: 'league', league: league[0], url, httpStatus: status,
      seen: events.length, events });
  }
  for (const league of BETANO_LEAGUES.filter(item => !payloads.some(row => row.league === item)))
    context.report?.({ phase: 'league', league: league[0], url: BETANO + betanoPath(league),
      httpStatus: null, seen: 0, events: [], reason: 'feed indisponível' });
  const games = ordered(future([...byEvent.values()]));
  if (!games.length) throw new Error(`Betano sem odds elegíveis nas próximas 12 horas: ${
    diagnostics.map(row => row.error || `${row.phase} HTTP ${row.status}, ${row.events} eventos`).join('; ') || 'listagens sem eventos das ligas alvo'}`);
  return { games, diagnostics, method: 'own_listing', source: 'Betano JSON da própria listagem' };
}

function bwinBasketballMarkets(fixture) {
  if (Array.isArray(fixture.games) && fixture.games.length) {
    const teams = (fixture.participants || []).slice(0, 2);
    if (teams.length !== 2 || teams.some(team => !team.name?.value)) return null;
    const valid = result => result.visibility === 'Visible' && Number(result.odds) > 1;
    const selection = (result, index, line = null) => ({ name: String(index + 1),
      fullName: result.name?.value || '', price: Number(result.odds), line, unavailable: false });
    const moneyline = fixture.games.find(game => /^Money Line(?: \(EUA\))?$/i.test(game.name?.value || ''));
    const sides = teams.map((team, index) => moneyline?.results?.find(result => valid(result)
      && (result.sourceName?.value === String(index + 1)
        || result.name?.value === team.name?.short)));
    if (sides.some(side => !side) || sides[0] === sides[1]) return null;
    const markets = [{ type: 'H2HT', title: moneyline.name.value,
      selections: sides.map((side, index) => selection(side, index)) }];
    const spread = fixture.games.find(game => /^Diferença de pontos$/i.test(game.name?.value || ''));
    const spreadSides = teams.map(team => spread?.results?.find(result => valid(result)
      && result.playerId === team.participantId));
    const spreadLines = spreadSides.map(side => Number(side?.attr));
    if (spreadSides.every(Boolean) && spreadLines.every(Number.isFinite)
      && spreadLines[0] === -spreadLines[1]) markets.push({ type: 'HCOT', title: spread.name.value,
      selections: spreadSides.map((side, index) => selection(side, index, spreadLines[index])) });
    const total = fixture.games.find(game => /^Totais$/i.test(game.name?.value || ''));
    const totals = ['Over', 'Under'].map(side => total?.results?.find(result => valid(result)
      && new RegExp(side === 'Over' ? '^Mais de ' : '^Menos de ', 'i').test(result.name?.value || '')));
    const totalLines = totals.map(side => Number(side?.name?.value?.match(/(\d+(?:[,.]\d+)?)/)?.[1]?.replace(',', '.')));
    if (totals.every(Boolean) && totalLines.every(Number.isFinite) && totalLines[0] === totalLines[1])
      markets.push({ type: 'TPOT', title: total.name.value,
        selections: totals.map((side, index) => ({ ...selection(side, index, totalLines[index]),
          name: index ? 'Under' : 'Over' })) });
    return markets;
  }
  const winner = (fixture.optionMarkets || []).find(market => /vencedor|winner/i.test(market.name?.value || '')
    && (market.options || []).filter(option => option.status === 'Visible' && Number(option.price?.odds) > 1).length === 2);
  if (!winner) return null;
  const options = winner.options.filter(option => option.status === 'Visible' && Number(option.price?.odds) > 1);
  const teams = String(fixture.name?.value || '').split(' - ').map(name => name.trim());
  if (teams.length !== 2) return null;
  const selected = teams.map((team, index) => options.find(option =>
    namesEqual(option.name?.value, team) || option.name?.value === String(index + 1)));
  if (selected.some(option => !option) || selected[0] === selected[1]) return null;
  return [{ type: 'H2HT', title: winner.name.value,
    selections: selected.map((option, index) => ({ name: index === 0 ? '1' : '2',
      fullName: option.name?.value || '', price: Number(option.price.odds), line: null,
      unavailable: false })) }];
}

function parseBwinFeed(feed, sourceUrl = BWIN_URL) {
  if (!Array.isArray(feed.fixtures)) throw new Error('Bwin: feed sem fixtures.');
  const games = [];
  const diagnostics = [];
  const audit = [];
  for (const fixture of feed.fixtures) {
    const identity = competition(fixture.competition?.name?.value);
    const teams = identity?.apiSport === 'basketball_nba' && fixture.participants?.length >= 2
      ? fixture.participants.slice(0, 2).map(team => team.name?.value || '')
      : String(fixture.name?.value || '').split(' - ').map(name => name.trim());
    const start = Date.parse(fixture.startDate);
    const markets = identity?.apiSport === 'basketball_nba'
      ? bwinBasketballMarkets(fixture) : eligibleTotals(fixture);
    const reason = !identity ? 'liga não configurada' : !fixture.isOpenForBetting
      ? 'apostas fechadas' : teams.length !== 2 || teams.some(name => !name)
        ? 'times incompletos' : !Number.isFinite(start) ? 'horário inválido'
          : !(start > Date.now() + 600000 && start <= Date.now() + 12 * 3600000)
            ? 'fora da janela de 12 horas' : !markets ? 'mercado completo indisponível' : 'aceito';
    audit.push({ league: identity?.apiSport || null, teams,
      commenceTime: Number.isFinite(start) ? new Date(start).toISOString() : null,
      eventId: String(fixture.id), reason });
    if (reason !== 'aceito') { diagnostics.push({ event: fixture.name?.value, reason }); continue; }
    games.push({ ...identity, teams,
      commenceTime: new Date(start).toISOString(), observedAt: new Date().toISOString(), sourceUrl,
      sourceEventId: String(fixture.id), sourceEventName: fixture.name.value,
      sourceMarket: identity.apiSport === 'basketball_nba' ? 'Bwin NBA: Money Line, Diferença de pontos e Totais'
        : 'Bwin Total golos (2GV excluído)', markets });
  }
  return { games: ordered(games), diagnostics, audit };
}

async function bwin(context) {
  try {
    const urls = [BWIN_BASKETBALL_URL, BWIN_URL];
    const feeds = await Promise.allSettled(urls.map(url => responseJson(context, url, 20000)
      .then(feed => parseBwinFeed(feed, url))));
    if (feeds[0].status === 'rejected' || !feeds[0].value.games.length) {
      const page = await context.newPage();
      try {
        await page.goto('https://www.bwin.pt/pt/sports/basquetebol-7/apostar',
          { waitUntil: 'commit', timeout: 30000 });
        const response = (await browserHtml(page, [BWIN_BASKETBALL_URL], 20000))[0];
        context.report?.({ phase: 'http', url: BWIN_BASKETBALL_URL, httpStatus: response.status || null });
        if (response.status === 200 && response.html) feeds[0] = { status: 'fulfilled',
          value: parseBwinFeed(JSON.parse(response.html), BWIN_BASKETBALL_URL) };
      } catch (error) { context.report?.({ phase: 'nba_edge_failed', error: error.message }); }
      finally { await page.close().catch(() => {}); }
    }
    for (const [key] of PRIORITY) {
      const index = key === 'basketball_nba' ? 0 : 1;
      const result = feeds[index];
      const events = result.status === 'fulfilled' ? result.value.audit.filter(row => row.league === key) : [];
      context.report?.({ phase: 'league', league: key, url: urls[index],
        httpStatus: result.status === 'fulfilled' ? 200 : null, seen: events.length, events,
        reason: result.status === 'rejected' ? result.reason.message : null });
    }
    const direct = { games: ordered(feeds.flatMap(result => result.status === 'fulfilled' ? result.value.games : [])),
      diagnostics: feeds.flatMap(result => result.status === 'rejected' ? [result.reason.message]
        : result.value.diagnostics) };
    if (!direct.games.length) throw new Error('Bwin direto sem jogos elegíveis.');
    return { ...direct, method: 'direct_feed', source: 'Bwin fixtures JSON: resultado e totais' };
  } catch (directError) {
    context.report?.({ phase: 'direct_failed', error: directError.message });
    const page = await context.newPage();
    let result;
    try {
      const pending = page.waitForResponse(response => response.status() === 200
        && response.url().includes('/cds-api/bettingoffer/fixtures?')
        && response.url().includes('sportIds=4'), { timeout: 45000 }).catch(() => null);
      await page.goto('https://www.bwin.pt/pt/sports/futebol-4/apostar',
        { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
      const response = await pending;
      if (!response) throw new Error('Bwin: página sem resposta do feed de futebol em 45 s.');
      result = parseBwinFeed(await response.json());
      for (const [key] of PRIORITY.filter(([sport]) => sport !== 'basketball_nba')) {
        const events = result.audit.filter(row => row.league === key);
        context.report?.({ phase: 'league', league: key, url: BWIN_URL, httpStatus: 200,
          seen: events.length, events });
      }
    } finally { await page.close().catch(() => {}); }
    return { ...result, method: 'page_fallback', source: 'Bwin fixtures JSON: Total golos; 2GV excluído',
      diagnostics: [{ directError: directError.message }, ...result.diagnostics] };
  }
}

function lebullBasketballMarkets(items) {
  const price = value => Number(String(value || '').replace(',', '.'));
  const winner = items.find(item => item.title === 'Vencedor');
  const sides = ['1', '2'].map(label => winner?.cells.find(cell => cell.label === label));
  const markets = [];
  if (sides.every(side => side && price(side.price) > 1)) markets.push({ type: 'H2HT',
    title: 'Vencedor', selections: sides.map(side => ({ name: side.label,
      fullName: side.label, price: price(side.price), line: null, unavailable: false })) });
  const total = items.find(item => item.title === 'Total de Pontos Mais/Menos');
  const lines = new Map();
  for (const cell of total?.cells || []) {
    const found = cell.label.match(/^([OU])\s*\((\d+(?:[,.]\d+)?)\)$/i);
    if (!found || !(price(cell.price) > 1)) continue;
    const line = Number(found[2].replace(',', '.'));
    if (!lines.has(line)) lines.set(line, {});
    lines.get(line)[found[1].toUpperCase() === 'O' ? 'Over' : 'Under'] = price(cell.price);
  }
  for (const [line, sidesForLine] of lines) if (sidesForLine.Over && sidesForLine.Under)
    markets.push({ type: 'TPOT', title: `Total de Pontos ${line}`,
      selections: ['Over', 'Under'].map(name => ({ name, fullName: `${name} ${line}`,
        price: sidesForLine[name], line, unavailable: false })) });
  return markets.length ? markets : null;
}

function parseLebullHtml(source, limit = Infinity) {
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
  const audit = [];
  const games = [];
  for (const row of rows) {
    const identity = competition(row.league);
    const commenceTime = localClock(row.clock, 'America/Sao_Paulo');
    const validWindow = commenceTime && Date.parse(commenceTime) > Date.now() + 600000
      && Date.parse(commenceTime) <= Date.now() + 12 * 3600000;
    const markets = identity?.apiSport === 'basketball_nba'
      ? lebullBasketballMarkets(row.oddsItems) : lebullMarkets(row.oddsItems);
    const reason = !identity ? 'liga não configurada' : row.teams.length !== 2
      ? 'times incompletos' : !commenceTime ? 'horário não reconhecido'
        : !validWindow ? 'fora da janela de 12 horas'
          : !markets ? 'mercados completos indisponíveis'
            : games.length >= limit ? 'limite de jogos da casa' : 'aceito';
    audit.push({ league: identity?.apiSport || null, teams: row.teams, commenceTime,
      rawClock: row.clock.trim(), reason });
    if (reason === 'aceito') games.push({ ...identity, teams: row.teams,
        commenceTime, observedAt: new Date().toISOString(), sourceUrl: LEBULL_FEED,
        sourceEventId: `${row.teams.join('-')}-${Date.parse(commenceTime)}`,
        sourceEventName: row.teams.join(' - '), sourceMarket: 'LeBull iframe HTML: resultado e totais', markets });
  }
  return { games: ordered(games), diagnostics: [{ rows: rows.length }], audit };
}

async function lebull(context) {
  try {
    const html = await responseText(context, LEBULL_FEED, 20000);
    const direct = parseLebullHtml(html);
    if (!direct.games.length) throw new Error('LeBull direto sem jogos elegíveis.');
    for (const [key] of PRIORITY) context.report?.({ phase: 'league', league: key, url: LEBULL_FEED,
      httpStatus: 200, seen: direct.audit.filter(row => row.league === key).length,
      events: direct.audit.filter(row => row.league === key) });
    return { ...direct, method: 'direct_feed', source: 'LeBull iframe HTML pré-jogo: resultado e totais' };
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
      for (const [key] of PRIORITY) context.report?.({ phase: 'league', league: key, url: frame.url(),
        httpStatus: 200, seen: result.audit.filter(row => row.league === key).length,
        events: result.audit.filter(row => row.league === key) });
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
  const parsed = identity.apiSport === 'basketball_nba'
    ? retabetBasketballMarkets(markets) : retabetMarkets(markets);
  if (!parsed) return null;
  return { ...identity, teams: names,
    commenceTime, observedAt: new Date().toISOString(), sourceUrl: url,
    sourceEventId: new URL(url).pathname.split('/').at(-1), sourceEventName: title,
    sourceMarket: 'HTML pré-jogo Retabet', markets: parsed };
}

function retabetBasketballMarkets(markets) {
  const price = row => Number(String(row.price || '').replace(',', '.'));
  const winner = markets.find(market => /^(Vencedor|Vencedor do jogo)$/i.test(market.title));
  const sides = ['1', '2'].map(label => winner?.options.find(row => row.label === label
    && !row.locked && price(row) > 1));
  const result = [];
  if (sides.every(Boolean)) result.push({ type: 'H2HT', title: winner.title,
    selections: sides.map(row => ({ name: row.label, fullName: row.label,
      price: price(row), line: null, unavailable: false })) });
  const total = markets.find(market => /Mais\/menos pontos/i.test(market.title));
  const lines = new Map();
  for (const row of total?.options || []) {
    const found = row.label.match(/^([+-])\s*de\s*(\d+(?:[,.]\d+)?)$/i);
    if (!found || row.locked || !(price(row) > 1)) continue;
    const line = Number(found[2].replace(',', '.'));
    if (!lines.has(line)) lines.set(line, {});
    lines.get(line)[found[1] === '+' ? 'Over' : 'Under'] = price(row);
  }
  for (const [line, sidesForLine] of lines) if (sidesForLine.Over && sidesForLine.Under)
    result.push({ type: 'TPOT', title: `Mais/menos pontos ${line}`,
      selections: ['Over', 'Under'].map(name => ({ name, fullName: `${name} ${line}`,
        price: sidesForLine[name], line, unavailable: false })) });
  return result.length ? result : null;
}

const RETABET_ROUTES = new Map([
  ['europa/liga-europa', 'soccer_uefa_europa_league'],
  ['europa/liga-dos-campe-es', 'soccer_uefa_champs_league'],
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
  if (parts[1] !== 'desportos' || !/^\d{7,}$/.test(parts.at(-1))) return null;
  if (parts[2] === 'basquetebol' && parts.some(part => /nba/i.test(part)))
    return { apiSport: 'basketball_nba', competition: 'NBA' };
  if (parts[2] !== 'futebol') return null;
  const key = RETABET_ROUTES.get(`${parts[3]}/${parts[4]}`);
  const entry = PRIORITY.find(([apiSport]) => apiSport === key);
  return entry ? { apiSport: entry[0], competition: entry[1] } : null;
}

async function retabet(context) {
  try {
    const catalogs = await Promise.allSettled([RETABET_INDEX, RETABET_BASKETBALL_INDEX]
      .map(url => responseText(context, url, 20000, 'esc_online')));
    const footballHtml = catalogs[0].status === 'fulfilled' ? catalogs[0].value : '';
    const $ = cheerio.load(footballHtml);
    const leagueUrls = [...new Set($('a[href]').toArray().map(x => new URL($(x).attr('href'), RETABET_INDEX).href)
      .filter(url => /\/desportos\/futebol\/[^/]+\/[^/]+\/\d{1,6}$/.test(url)
        && RETABET_ROUTES.has(new URL(url).pathname.split('/').slice(3, 5).join('/'))))];
    const indexes = [RETABET_BASKETBALL_INDEX, ...leagueUrls]
      .sort((a, b) => {
        const identify = url => url === RETABET_BASKETBALL_INDEX ? { apiSport: 'basketball_nba' }
          : { apiSport: RETABET_ROUTES.get(new URL(url).pathname.split('/').slice(3, 5).join('/')) };
        return rank(identify(a)) - rank(identify(b));
      });
    const listings = await Promise.allSettled(indexes.map(url => url === RETABET_BASKETBALL_INDEX
      && catalogs[1].status === 'fulfilled' ? Promise.resolve(catalogs[1].value)
      : responseText(context, url, 20000)));
    const candidates = [];
    for (let i = 0; i < indexes.length; i++) {
      const url = indexes[i], result = listings[i];
      const key = url === RETABET_BASKETBALL_INDEX ? 'basketball_nba'
        : RETABET_ROUTES.get(new URL(url).pathname.split('/').slice(3, 5).join('/'));
      const page = result.status === 'fulfilled' ? cheerio.load(result.value) : null;
      const links = page ? [...new Set(page('a[href]').toArray()
        .map(x => new URL(page(x).attr('href'), url).href)
        .filter(href => retabetLeague(href)?.apiSport === key))] : [];
      context.report?.({ phase: 'league', league: key, url,
        httpStatus: result.status === 'fulfilled' ? 200 : null, seen: links.length,
        events: links.map(href => ({ url: href, teams: null, commenceTime: null,
          reason: 'aguarda página do jogo' })),
        reason: result.status === 'rejected' ? result.reason.message : null });
      candidates.push(...links.map(href => ({ href, league: key, indexUrl: url })));
    }
    if (!candidates.length) throw new Error('Retabet direto sem eventos listados.');
    const settled = await Promise.allSettled(candidates.map(async candidate => {
      try {
        const html = await responseText(context, candidate.href, 20000);
        const game = parseRetabetEvent(html, candidate.href);
        const page = cheerio.load(html);
        const title = page('title').text().match(/^Aposte no (.+) com Retabet$/i)?.[1] || '';
        context.report?.({ phase: 'event_decision', league: candidate.league,
          indexUrl: candidate.indexUrl, url: candidate.href,
          teams: title.split(/\s+-\s+/), commenceTime: game?.commenceTime ||
            localClock(page('body').text().replace(/\s+/g, ' '), 'Europe/Lisbon'),
          reason: game ? 'aceito' : 'times, horário, liga ou mercados incompletos' });
        return game;
      } catch (error) {
        context.report?.({ phase: 'event_decision', league: candidate.league,
          indexUrl: candidate.indexUrl, url: candidate.href,
          reason: error.message });
        throw error;
      }
    }));
    const games = ordered(settled.filter(x => x.status === 'fulfilled' && x.value).map(x => x.value));
    if (!games.length) throw new Error('Retabet direto sem mercados completos.');
    return { games, diagnostics: settled.filter(x => x.status === 'rejected').map(x => x.reason.message),
      method: 'direct_feed', source: 'Retabet HTML pré-jogo' };
  } catch (directError) {
    context.report?.({ phase: 'direct_failed', error: directError.message });
    const page = await context.newPage();
    try {
      const indexResponse = await page.goto(RETABET_INDEX, { waitUntil: 'commit', timeout: 30000 });
      await page.waitForTimeout(4000);
      const $ = cheerio.load(await page.content());
      const catalogLeagues = [...new Set($('a[href]').toArray()
        .map(x => new URL($(x).attr('href'), RETABET_INDEX).href)
        .filter(url => /\/desportos\/futebol\/[^/]+\/[^/]+\/\d{1,6}$/.test(url)
          && RETABET_ROUTES.has(new URL(url).pathname.split('/').slice(3, 5).join('/'))))];
      const requested = [{ url: RETABET_BASKETBALL_INDEX, key: 'basketball_nba' },
        ...catalogLeagues.map(url => ({ url, key: RETABET_ROUTES.get(new URL(url).pathname.split('/').slice(3, 5).join('/')) }))]
        .sort((a, b) => rank({ apiSport: a.key }) - rank({ apiSport: b.key }));
      const listingResponses = await browserHtml(page, requested.map(item => item.url), 15000);
      const candidates = [];
      for (const [index, item] of requested.entries()) {
        const response = listingResponses[index];
        const list = cheerio.load(response.html || '');
        const links = [...new Set(list('a[href]').toArray().map(x => new URL(list(x).attr('href'), item.url).href)
          .filter(url => retabetLeague(url)?.apiSport === item.key))];
        context.report?.({ phase: 'league', league: item.key, url: item.url,
          httpStatus: response.status || null, seen: links.length,
          events: links.map(url => ({ url, reason: 'aguarda página do jogo' })),
          reason: response.error || (response.status !== 200 ? `HTTP ${response.status ?? 'desconhecido'}` : null) });
        candidates.push(...links);
      }
      for (const [key] of PRIORITY.filter(([key]) => !requested.some(item => item.key === key)))
        context.report?.({ phase: 'league', league: key, url: RETABET_INDEX,
          httpStatus: indexResponse?.status() || null, seen: 0, events: [],
          reason: indexResponse?.status() === 200 ? 'liga não encontrada' : 'catálogo indisponível' });
      const unique = [...new Set(candidates)];
      const responses = await browserHtml(page, unique, 15000);
      const games = ordered(unique.map((url, index) => {
        const game = responses[index].html && parseRetabetEvent(responses[index].html, url);
        context.report?.({ phase: 'event_decision', league: retabetLeague(url)?.apiSport,
          url, teams: game?.teams || null, commenceTime: game?.commenceTime || null,
          reason: game ? 'aceito' : responses[index].error || `HTTP ${responses[index].status ?? 'desconhecido'} ou dados incompletos` });
        return game;
      }).filter(Boolean));
      if (!games.length) throw new Error(`Retabet: ${responses.length} jogos consultados, nenhum com liga, horário e mercados completos; ${JSON.stringify(responses.map(x => ({ status: x.status, error: x.error })))}`);
      return { games, method: 'page_fallback', source: 'Retabet HTML pré-jogo',
        diagnostics: [{ directError: directError.message }] };
    } finally { await page.close().catch(() => {}); }
  }
}

function parseEscEvent(source, url, label, league = null) {
  const $ = cheerio.load(source);
  $('style,script,noscript').remove();
  const identity = league || competition(url);
  const teams = label.split(/\n+|\s+-\s+/).map(value => value.trim()).filter(Boolean);
  const commenceTime = localClock($('body').text().replace(/\s+/g, ' '),
    'America/Sao_Paulo');
  if (!identity || teams.length !== 2
    || !commenceTime || Date.parse(commenceTime) <= Date.now() + 600000
    || Date.parse(commenceTime) > Date.now() + 12 * 3600000) return null;
  const marketName = identity.apiSport === 'basketball_nba' ? 'Total de Pontos' : 'Total de Golos';
  const market = $('p').filter((_, x) => $(x).text().trim() === marketName)
    .first().closest('[data-testid="collapsible-market"]');
  if (!market.length) return null;
  const rows = market.find('[data-testid="event-details-outcome"]').toArray().map(x => ({
    name: $(x).find('[class*="OutcomeName"]').first().text().trim(),
    line: $(x).find('[class*="OutcomeBaseEventDetails"]').first().text().trim(),
    price: $(x).find('[data-testid="event-details-outcome-odds"]').first().text().trim(),
    locked: $(x).attr('data-locked') === 'true',
  }));
  const markets = identity.apiSport === 'basketball_nba' ? escBasketballTotals(rows) : parseTotals(rows);
  if (!markets.length) return null;
  return { ...identity, teams,
    commenceTime, observedAt: new Date().toISOString(), sourceUrl: url,
    sourceEventId: url.match(/-(\d+)$/)?.[1] || null, sourceEventName: label,
    sourceMarket: 'ESC Online Total de Golos; Resultado Final 2Up excluído', markets };
}

function escBasketballTotals(rows) {
  const lines = new Map();
  for (const row of rows) {
    if (row.locked) continue;
    const found = `${row.name} ${row.line}`.match(/(Mais|Menos|Over|Under)\s*(\d+(?:[,.]\d+)?)/i);
    const price = Number(String(row.price).replace(',', '.'));
    if (!found || !(price > 1)) continue;
    const line = Number(found[2].replace(',', '.'));
    if (!lines.has(line)) lines.set(line, {});
    lines.get(line)[/mais|over/i.test(found[1]) ? 'Over' : 'Under'] = price;
  }
  return [...lines].filter(([, side]) => side.Over && side.Under)
    .map(([line, side]) => ({ type: 'TPOT', title: `Total de Pontos ${line}`,
      selections: ['Over', 'Under'].map(name => ({ name, fullName: `${name} ${line}`,
        price: side[name], line, unavailable: false })) }));
}

async function escOnline(context) {
  try {
    const catalog = await Promise.allSettled([ESC_ALL_LEAGUES, ESC_INDEX]
      .map(url => responseText(context, url, 20000)));
    const leaguePages = [{ url: ESC_NBA,
      identity: { apiSport: 'basketball_nba', competition: 'NBA' } }];
    for (const [catalogIndex, result] of catalog.entries()) if (result.status === 'fulfilled') {
      const $ = cheerio.load(result.value);
      if (!$('a[href*="/betting/league/"]').length)
        saveDiscard('esc_online', [ESC_ALL_LEAGUES, ESC_INDEX][catalogIndex], result.value,
          'catálogo sem links de ligas');
      for (const element of $('a[href*="/betting/league/"]').toArray()) {
        const key = competition($(element).text()) || competition($(element).attr('href'));
        if (key) leaguePages.push({ url: new URL($(element).attr('href'), ESC_INDEX).href,
          identity: key });
      }
    }
    const indexes = [...new Map(leaguePages.map(item => [item.url, item])).values()]
      .sort((a, b) => rank(a.identity) - rank(b.identity));
    const pages = await Promise.allSettled(indexes.map(item => responseText(context, item.url, 20000, 'esc_online')));
    const matched = [];
    for (let index = 0; index < indexes.length; index++) {
      const { url, identity } = indexes[index], result = pages[index];
      if (!identity) continue;
      const $ = cheerio.load(result.status === 'fulfilled' ? result.value : '');
      const seen = [...new Map($('a[href*="/betting/event/"]').toArray().map(x => {
        const href = new URL($(x).attr('href'), url).href;
        return [href, { href, label: $(x).find('[class*="TeamName"]')
          .toArray().map(y => $(y).text().trim()).join('\n'), identity, indexUrl: url }];
      })).values()];
      if (result.status === 'fulfilled' && !seen.length)
        saveDiscard('esc_online', url, result.value, 'página da liga sem links de jogos');
      for (const link of seen.filter(link => link.label.split('\n').length !== 2))
        saveDiscard('esc_online', link.href, result.value, 'jogo descartado: times incompletos');
      context.report?.({ phase: 'league', league: identity.apiSport, url,
        httpStatus: result.status === 'fulfilled' ? 200 : null, seen: seen.length,
        events: seen.map(link => ({ url: link.href, teams: link.label.split('\n'),
          commenceTime: null, reason: 'aguarda página do jogo' })),
        reason: result.status === 'rejected' ? result.reason.message : null });
      matched.push(...seen.filter(link => link.label.split('\n').length === 2));
    }
    if (!matched.length) throw new Error('ESC direto sem eventos listados nas ligas alvo.');
    const settled = await Promise.allSettled(matched.map(async link => {
      try {
        const html = await responseText(context, link.href, 20000, 'esc_online');
        const game = parseEscEvent(html, link.href, link.label, link.identity);
        if (!game) saveDiscard('esc_online', link.href, html, 'horário ou mercado incompleto');
        context.report?.({ phase: 'event_decision', league: link.identity.apiSport,
          indexUrl: link.indexUrl, url: link.href, teams: link.label.split('\n'),
          commenceTime: game?.commenceTime || localClock(cheerio.load(html)('body').text(),
            'America/Sao_Paulo'), reason: game ? 'aceito' : 'horário ou mercado incompleto' });
        return game;
      } catch (error) {
        context.report?.({ phase: 'event_decision', league: link.identity.apiSport,
          indexUrl: link.indexUrl, url: link.href, teams: link.label.split('\n'),
          reason: error.message });
        throw error;
      }
    }));
    const games = ordered(settled.filter(x => x.status === 'fulfilled' && x.value).map(x => x.value));
    if (!games.length) throw new Error('ESC direto sem totais completos.');
    return { games, diagnostics: settled.filter(x => x.status === 'rejected').map(x => x.reason.message),
      method: 'direct_feed', source: 'ESC Online Total de Golos; 2Up excluído' };
  } catch (directError) {
    context.report?.({ phase: 'direct_failed', error: directError.message });
    const page = await context.newPage();
    try {
      const catalogResponse = await page.goto(ESC_ALL_LEAGUES,
        { waitUntil: 'commit', timeout: 30000 });
      await page.waitForTimeout(4000);
      const catalogHtml = await page.content();
      const $ = cheerio.load(catalogHtml);
      const leaguePages = [{ url: ESC_NBA,
        identity: { apiSport: 'basketball_nba', competition: 'NBA' } },
      ...$('a[href*="/betting/league/"]').toArray().map(x => ({
        url: new URL($(x).attr('href'), ESC_ALL_LEAGUES).href,
        identity: competition($(x).text()) || competition($(x).attr('href')),
      })).filter(x => x.identity)];
      const indexes = [...new Map(leaguePages.map(x => [x.url, x])).values()]
        .sort((a, b) => rank(a.identity) - rank(b.identity));
      if (indexes.length === 1) saveDiscard('esc_online', ESC_ALL_LEAGUES,
        catalogHtml, 'catálogo Edge sem links de ligas configuradas');
      const listings = await browserHtml(page, indexes.map(x => x.url), 15000);
      const links = [];
      for (const [index, item] of indexes.entries()) {
        const result = listings[index], html = cheerio.load(result.html || '');
        const events = [...new Map(html('a[href*="/betting/event/"]').toArray().map(x => {
          const href = new URL(html(x).attr('href'), item.url).href;
          return [href, { href, label: html(x).find('[class*="TeamName"]')
            .toArray().map(y => html(y).text().trim()).join('\n'), identity: item.identity }];
        })).values()];
        if (!events.length) saveDiscard('esc_online', item.url, result.html || '',
          result.error || `HTTP ${result.status ?? 'desconhecido'} ou sem jogos`);
        for (const link of events.filter(link => link.label.split('\n').length !== 2))
          saveDiscard('esc_online', link.href, result.html || '', 'jogo descartado: times incompletos');
        context.report?.({ phase: 'league', league: item.identity.apiSport, url: item.url,
          httpStatus: result.status || null, seen: events.length,
          events: events.map(x => ({ url: x.href, teams: x.label.split('\n'),
            reason: 'aguarda página do jogo' })),
          reason: result.error || (result.status !== 200 ? `HTTP ${result.status ?? 'desconhecido'}` : null) });
        links.push(...events.filter(x => x.label.split('\n').length === 2));
      }
      for (const [key] of PRIORITY.filter(([key]) => !indexes.some(x => x.identity.apiSport === key)))
        context.report?.({ phase: 'league', league: key, url: ESC_ALL_LEAGUES,
          httpStatus: catalogResponse?.status() || null, seen: 0, events: [],
          reason: catalogResponse?.status() === 200 ? 'liga não encontrada' : 'catálogo indisponível' });
      const unique = [...new Map(links.map(x => [x.href, x])).values()];
      const responses = await browserHtml(page, unique.map(x => x.href), 15000);
      const games = ordered(unique.map((link, index) => {
        const game = responses[index].html && parseEscEvent(responses[index].html,
          link.href, link.label, link.identity);
        if (!game) saveDiscard('esc_online', link.href, responses[index].html || '',
          responses[index].error || `HTTP ${responses[index].status ?? 'desconhecido'} ou horário/mercado incompleto`);
        context.report?.({ phase: 'event_decision', league: link.identity.apiSport,
          url: link.href, teams: link.label.split('\n'), commenceTime: game?.commenceTime || null,
          reason: game ? 'aceito' : responses[index].error || `HTTP ${responses[index].status ?? 'desconhecido'} ou horário/mercado incompleto` });
        return game;
      }).filter(Boolean));
      if (!games.length) throw new Error(`ESC: ${unique.length} jogos das ligas alvo, nenhum com horário e totais completos; ${JSON.stringify(responses.map(x => ({ status: x.status, error: x.error })))}`);
      return { games, method: 'page_fallback', source: 'ESC Online Total de Golos; 2Up excluído',
        diagnostics: [{ directError: directError.message }] };
    } finally { await page.close().catch(() => {}); }
  }
}

function goldenparkClock(value, now = new Date()) {
  const relative = String(value || '').match(/LIVE em\s*(\d+)\s*min/i);
  if (relative) return new Date(now.getTime() + Number(relative[1]) * 60000).toISOString();
  const shown = String(value || '').match(/\b(\d{1,2})\s+(jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)\s+(\d{1,2}):(\d{2})/i);
  if (!shown) return localClock(value, 'America/Sao_Paulo', now);
  const months = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  const date = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Sao_Paulo',
    day: '2-digit', month: '2-digit', year: 'numeric' }).formatToParts(now);
  const parts = Object.fromEntries(date.filter(part => part.type !== 'literal')
    .map(part => [part.type, Number(part.value)]));
  const month = months.indexOf(shown[2].toLowerCase()) + 1;
  const dayOffset = (Date.UTC(parts.year, month - 1, Number(shown[1]))
    - Date.UTC(parts.year, parts.month - 1, parts.day)) / 86400000;
  if (dayOffset !== 0 && dayOffset !== 1) return null;
  return localClock(`${dayOffset ? 'Amanhã' : 'Hoje'} ${shown[3]}:${shown[4]}`,
    'America/Sao_Paulo', now);
}

function goldenparkRows(html, indexUrl) {
  const $ = cheerio.load(html);
  const identity = competition(indexUrl);
  if (!identity) return [];
  return $('.line-container.new').toArray().map(element => ({
    teams: $(element).find('.actor-1,.actor-2').map((_, x) => $(x).text().trim()).get(),
    clock: $(element).find('.date-event').text().trim(),
    href: $(element).find('a.snc-link-to-event').attr('href'),
  })).map(row => ({ ...row, ...identity,
    commenceTime: goldenparkClock(row.clock) }))
    .map(row => ({ ...row, reason: row.teams.length !== 2 ? 'times incompletos'
      : !row.href ? 'link do jogo ausente' : !row.commenceTime ? 'horário não reconhecido'
        : Date.parse(row.commenceTime) <= Date.now() + 600000
          || Date.parse(row.commenceTime) > Date.now() + 12 * 3600000
          ? 'fora da janela de 12 horas' : 'aceito' }));
}

async function goldenpark(context) {
  let indexes = GOLDEN_KNOWN_LEAGUES;
  try {
    try {
      const catalogs = await Promise.allSettled([GOLDEN_SPORT, GOLDEN_INDEX,
        'https://apostas.goldenpark.pt/desporte/3-basquetebol']
        .map(url => responseText(context, url, 20000, 'goldenpark')));
      indexes = [...new Set([...indexes, ...catalogs.flatMap(result => {
        if (result.status !== 'fulfilled') return [];
        const $ = cheerio.load(result.value);
        return $('a[href*="/competicao/"]').toArray()
          .map(element => new URL($(element).attr('href'), GOLDEN_INDEX).href)
          .filter(url => competition(url));
      })])]
        .sort((a, b) => rank(competition(a)) - rank(competition(b)));
    } catch (error) { context.report?.({ phase: 'goldenpark_catalog_failed', error: error.message }); }
    const pages = await Promise.allSettled(indexes.map(url => responseText(context, url, 20000, 'goldenpark')
      .then(html => ({ html, rows: goldenparkRows(html, url) }))));
    const matched = pages.flatMap((result, index) => {
      const events = result.status === 'fulfilled' ? result.value.rows : [];
      if (result.status === 'fulfilled' && !events.length)
        saveDiscard('goldenpark', indexes[index], result.value.html, 'liga sem jogos');
      for (const row of events.filter(row => row.reason !== 'aceito'))
        saveDiscard('goldenpark', indexes[index], result.value.html,
          `${row.teams.join(' x ')}: ${row.reason}`);
      context.report?.({ phase: 'league', league: competition(indexes[index])?.apiSport,
        url: indexes[index], httpStatus: result.status === 'fulfilled' ? 200 : null,
        seen: events.length, events: events.map(row => ({ teams: row.teams,
          commenceTime: row.commenceTime, rawClock: row.clock, reason: row.reason })),
        reason: result.status === 'rejected' ? result.reason.message : null });
      return events.filter(row => row.reason === 'aceito');
    }).sort((a, b) => rank(a) - rank(b) || Date.parse(a.commenceTime) - Date.parse(b.commenceTime));
    if (!matched.length) throw new Error('GoldenPark direto sem eventos listados.');
    const settled = await Promise.allSettled(matched.map(async row => {
      const url = new URL(row.href, GOLDEN_INDEX).href;
      try {
        const html = await responseText(context, url, 20000, 'goldenpark');
        const game = parseEvent(html, row, url,
          row.href.match(/\/evento\/(\d+)/)?.[1] || row.href);
        if (!game) {
          saveDiscard('goldenpark', url, html, 'mercados completos indisponíveis');
          context.report?.({ phase: 'event_discard', league: row.apiSport,
            url, teams: row.teams, commenceTime: row.commenceTime, reason: 'mercados completos indisponíveis' });
        }
        return game;
      } catch (error) {
        context.report?.({ phase: 'event_discard', league: row.apiSport,
          url, teams: row.teams, commenceTime: row.commenceTime, reason: error.message });
        throw error;
      }
    }));
    const games = ordered(settled.filter(x => x.status === 'fulfilled' && x.value).map(x => x.value));
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
      for (const indexUrl of indexes) {
        if (Date.now() >= deadline) break;
        try {
          const response = await page.goto(indexUrl, { waitUntil: 'domcontentloaded',
            timeout: Math.min(12000, deadline - Date.now()) });
          await page.locator('.line-container.new').first().waitFor({
            timeout: Math.min(4000, Math.max(1, deadline - Date.now())) }).catch(() => {});
          const html = await page.content();
          const rows = goldenparkRows(html, indexUrl);
          if (!rows.length) saveDiscard('goldenpark', indexUrl, html,
            `HTTP ${response?.status() ?? 'desconhecido'} ou liga sem jogos`);
          for (const row of rows.filter(row => row.reason !== 'aceito'))
            saveDiscard('goldenpark', indexUrl, html, `${row.teams.join(' x ')}: ${row.reason}`);
          context.report?.({ phase: 'league', league: competition(indexUrl)?.apiSport,
            url: indexUrl, httpStatus: response?.status(), seen: rows.length,
            events: rows.map(row => ({ teams: row.teams, commenceTime: row.commenceTime,
              rawClock: row.clock, reason: row.reason })) });
          if (rows.some(row => row.reason === 'aceito'))
            matched.push(...rows.filter(row => row.reason === 'aceito'));
          else empty.push({ liga: competition(indexUrl)?.competition, status: response?.status(), motivo: 'sem jogos na janela' });
        } catch (error) {
          saveDiscard('goldenpark', indexUrl, '', error.message);
          empty.push({ liga: competition(indexUrl)?.competition, motivo: error.message });
        }
      }
      context.report?.({ phase: 'goldenpark_leagues', details: empty });
      const urls = matched.map(row => new URL(row.href, GOLDEN_INDEX).href);
      const responses = await browserHtml(page, urls);
      const games = ordered(matched.map((row, index) => {
        const game = responses[index].html && parseEvent(responses[index].html, row, urls[index],
          row.href.match(/\/evento\/(\d+)/)?.[1] || row.href);
        if (!game) saveDiscard('goldenpark', urls[index], responses[index].html || '',
          responses[index].error || `HTTP ${responses[index].status ?? 'desconhecido'} ou mercados incompletos`);
        return game;
      }).filter(Boolean));
      if (!games.length) throw new Error(`GoldenPark: nenhuma liga prioritária com jogos e mercados completos; ${JSON.stringify(empty)}; ${JSON.stringify(responses.map(x => ({ status: x.status, error: x.error })))}`);
      return { games, method: 'page_fallback', source: 'GoldenPark HTML pré-jogo: 1X2 e Total de Golos',
        diagnostics: [{ directError: directError.message }] };
    } finally { await page.close().catch(() => {}); }
  }
}

function betclicClock(day, clock, now = new Date()) {
  if (!/^\d{1,2}:\d{2}$/.test(String(clock || ''))) return null;
  const heading = String(day || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const months = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  const explicit = heading.match(/\b(\d{1,2})\s*(?:de\s*)?(jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)/);
  let relative = /amanha/.test(heading) ? 'Amanhã' : 'Hoje';
  if (explicit) {
    const current = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Lisbon',
      day: '2-digit', month: '2-digit', year: 'numeric' }).formatToParts(now);
    const parts = Object.fromEntries(current.filter(item => item.type !== 'literal')
      .map(item => [item.type, Number(item.value)]));
    const difference = (Date.UTC(parts.year, months.indexOf(explicit[2]) , Number(explicit[1]))
      - Date.UTC(parts.year, parts.month - 1, parts.day)) / 86400000;
    if (difference !== 0 && difference !== 1) return null;
    relative = difference ? 'Amanhã' : 'Hoje';
  }
  let result = localClock(`${relative} ${clock}`, 'Europe/Lisbon', now);
  if (relative === 'Hoje' && result && Date.parse(result) <= now.getTime() + 600000)
    result = localClock(`Amanhã ${clock}`, 'Europe/Lisbon', now);
  return result;
}

function betclicCards(html, url) {
  const $ = cheerio.load(html);
  return $('a.cardEvent').toArray().map(element => {
    const card = $(element);
    const label = card.attr('aria-label') || '';
    const teams = label.split(/\s+-\s+/).map(name => name.trim());
    const identity = competition(card.text()) || competition(url);
    const day = card.closest('.groupEvents').find('.groupEvents_head').first().text().trim();
    const clock = card.find('[data-qa="scoreboard-hour"]').first().text().trim()
      || card.text().match(/\b\d{1,2}:\d{2}\b/)?.[0];
    const commenceTime = betclicClock(day, clock);
    const href = card.attr('href');
    const reason = !identity ? 'liga não configurada' : teams.length !== 2 || teams.some(name => !name)
      ? 'times incompletos' : !href ? 'link do jogo ausente' : !commenceTime
        ? 'horário não reconhecido' : Date.parse(commenceTime) <= Date.now() + 600000
          || Date.parse(commenceTime) > Date.now() + 12 * 3600000
          ? 'fora da janela de 12 horas' : 'aceito';
    return { ...identity, teams, commenceTime, label, rawDay: day, rawClock: clock || null,
      href: href ? new URL(href, url).href : null, reason };
  });
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
  const markets = card.apiSport === 'basketball_nba'
    ? betclicBasketballMarkets(boxes) : betclicMarkets(boxes);
  return markets && { apiSport: card.apiSport, competition: card.competition,
    teams: card.teams, commenceTime: card.commenceTime, observedAt: new Date().toISOString(),
    sourceUrl: card.href, sourceEventId: card.href.match(/-m(\d+)$/)?.[1] || null,
    sourceEventName: card.label,
    sourceMarket: 'Betclic HTML pré-jogo: resultado regulamentar e total de golos', markets };
}

function betclicBasketballMarkets(boxes) {
  const price = value => Number(String(value || '').replace(',', '.'));
  const winner = boxes.find(box => /^(Vencedor|Vencedor do jogo)$/i.test(box.title));
  const result = [];
  if (winner?.rows.length === 2 && winner.rows.every(row => price(row.price) > 1))
    result.push({ type: 'H2HT', title: winner.title,
      selections: winner.rows.map((row, index) => ({ name: index === 0 ? '1' : '2',
        fullName: row.label, price: price(row.price), line: null, unavailable: false })) });
  const total = boxes.find(box => /Total de pontos.*(acima|abaixo)/i.test(box.title));
  const lines = new Map();
  for (const row of total?.rows || []) {
    const found = row.label.match(/^(Acima|Abaixo) de (\d+(?:[,.]\d+)?)$/i);
    if (!found || !(price(row.price) > 1)) continue;
    const line = Number(found[2].replace(',', '.'));
    if (!lines.has(line)) lines.set(line, {});
    lines.get(line)[/^acima$/i.test(found[1]) ? 'Over' : 'Under'] = price(row.price);
  }
  for (const [line, sides] of lines) if (sides.Over && sides.Under)
    result.push({ type: 'TPOT', title: `Total de pontos ${line}`,
      selections: ['Over', 'Under'].map(name => ({ name, fullName: `${name} ${line}`,
        price: sides[name], line, unavailable: false })) });
  return result.length ? result : null;
}

async function betclic(context) {
  let catalog;
  try { catalog = await responseText(context, BETCLIC_HOME, 20000); }
  catch (error) {
    for (const [key] of PRIORITY) context.report?.({ phase: 'league', league: key,
      url: BETCLIC_HOME, httpStatus: null, seen: 0, events: [],
      reason: `catálogo indisponível: ${error.message}` });
    throw new Error(`Betclic: catálogo próprio indisponível: ${error.message}`);
  }
  const $ = cheerio.load(catalog);
  const leagues = [...new Set([BETCLIC_NBA, BETCLIC_EUROPA, ...$('a[href]').toArray()
    .map(element => new URL($(element).attr('href'), BETCLIC_HOME).href)
    .filter(url => url.startsWith('https://www.betclic.pt/') && competition(url))])]
    .sort((a, b) => rank(competition(a)) - rank(competition(b)));
  const lists = await Promise.allSettled(leagues.map(url => responseText(context, url, 20000)
    .then(html => betclicCards(html, url))));
  const cards = lists.flatMap((result, index) => {
    const rows = result.status === 'fulfilled' ? result.value : [];
    context.report?.({ phase: 'league', league: competition(leagues[index])?.apiSport,
      url: leagues[index], httpStatus: result.status === 'fulfilled' ? 200 : null,
      seen: rows.length, events: rows.map(row => ({ url: row.href, teams: row.teams,
        commenceTime: row.commenceTime, rawDay: row.rawDay, rawClock: row.rawClock, reason: row.reason })),
      reason: result.status === 'rejected' ? result.reason.message : null });
    return rows.filter(row => row.reason === 'aceito');
  }).sort((a, b) => rank(a) - rank(b) || Date.parse(a.commenceTime) - Date.parse(b.commenceTime));
  for (const [key] of PRIORITY.filter(([key]) => !leagues.some(url => competition(url)?.apiSport === key)))
    context.report?.({ phase: 'league', league: key, url: BETCLIC_HOME,
      httpStatus: 200, seen: 0, events: [], reason: 'liga não encontrada' });
  if (!cards.length) throw new Error('Betclic: listagem própria sem jogos das ligas alvo nas próximas 12 horas.');
  const events = await Promise.allSettled(cards.map(async card => {
    try {
      const html = await responseText(context, card.href, 20000);
      const game = parseBetclicEvent(html, card);
      context.report?.({ phase: 'event_decision', league: card.apiSport, url: card.href,
        teams: card.teams, commenceTime: card.commenceTime,
        reason: game ? 'aceito' : 'mercados completos indisponíveis' });
      return game;
    } catch (error) {
      context.report?.({ phase: 'event_decision', league: card.apiSport, url: card.href,
        teams: card.teams, commenceTime: card.commenceTime, reason: error.message });
      throw error;
    }
  }));
  const games = ordered(events.filter(result => result.status === 'fulfilled' && result.value)
    .map(result => result.value));
  if (!games.length) throw new Error('Betclic: jogos listados sem mercados completos.');
  return { games, method: 'direct_feed', source: 'Betclic HTML pré-jogo: resultado e total de golos',
    diagnostics: [...lists, ...events].filter(result => result.status === 'rejected')
      .map(result => result.reason.message) };
}

module.exports = { betano, bwin, retabet, lebull, escOnline, goldenpark, betclic,
  parseBwinFeed, parseLebullHtml, parseRetabetEvent, parseEscEvent,
  betclicCards, betclicClock, parseBetclicEvent, retabetLeague, goldenparkClock, count, responseText };
