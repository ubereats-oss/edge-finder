const URL = 'https://www.bwin.pt/pt/sports/futebol-4/apostar';
const IGNORED = new Set(['fc', 'sc', 'ac', 'afc', 'pfc', 'gnk', 'nk', 'kks', 'rsc', 'jk', 'sk', 'tc', 'de', 'do', 'da', 'the']);

function tokens(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).filter(token => token.length >= 3 && !IGNORED.has(token));
}

function teamScore(a, b) {
  const left = new Set(tokens(a));
  const right = new Set(tokens(b));
  if (!left.size || !right.size) return 0;
  return [...left].filter(token => right.has(token)).length / Math.max(left.size, right.size);
}

function param(market, key) {
  return market.parameters?.find(row => row.key === key)?.value;
}

function eligibleTotals(fixture) {
  const markets = [];
  for (const line of [2.5, 1.5, 3.5, 4.5]) {
    const market = (fixture.optionMarkets || []).find(row => row.status === 'Visible'
      && row.name?.value === 'Total golos' && Number(param(row, 'DecimalValue')) === line
      && param(row, 'Happening') === 'Goal' && param(row, 'MarketType') === 'Over/Under'
      && param(row, 'Period') === 'RegularTime');
    if (!market || market.options?.length !== 2) continue;
    const selections = [`Mais ${line}`, `Menos ${line}`].map((label, index) => {
      const option = market.options.find(row => row.name?.value === label);
      const price = Number(option?.price?.odds);
      if (option?.status !== 'Visible' || !Number.isFinite(price) || price <= 1) return null;
      return { name: index === 0 ? 'Over' : 'Under', fullName: label, price, line, unavailable: false };
    });
    if (selections.every(Boolean)) markets.push({ type: 'HCTG', title: `Total golos ${line}`, selections });
  }
  return markets.length ? markets : null;
}

function matchFixture(fixture, footballGames) {
  const names = String(fixture.name?.value || '').split(' - ');
  if (names.length !== 2) return null;
  const start = Date.parse(fixture.startDate);
  if (!Number.isFinite(start)) return null;
  const candidates = footballGames.filter(game => game.apiSport === 'soccer_uefa_europa_league'
    && Math.abs(Date.parse(game.commenceTime) - start) <= 60000
    && game.teams.every((team, index) => teamScore(team, names[index]) >= 0.5));
  return candidates.length === 1 ? candidates[0] : null;
}

async function readBwin(context, footballGames) {
  const page = await context.newPage();
  const diagnostics = [];
  const games = [];
  try {
    let response = null;
    for (let attempt = 1; attempt <= 2 && !response; attempt++) {
      const pending = page.waitForResponse(candidate => candidate.status() === 200
        && candidate.url().includes('/cds-api/bettingoffer/fixtures?')
        && candidate.url().includes('sportIds=4'), { timeout: 45000 }).catch(() => null);
      await page.goto(attempt === 1 ? URL : `${URL}?refresh=${Date.now()}`,
        { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
      response = await pending;
    }
    if (!response) throw new Error('Bwin: feed de fixtures não respondeu após duas navegações.');
    const feed = await response.json();
    if (!Array.isArray(feed.fixtures)) throw new Error('Bwin: feed de fixtures não contém eventos.');
    for (const fixture of feed.fixtures) {
      if (fixture.competition?.name?.value !== 'Liga Europa' || !fixture.isOpenForBetting) continue;
      const start = Date.parse(fixture.startDate);
      if (!(start > Date.now() + 600000 && start <= Date.now() + 12 * 3600000)) continue;
      const game = matchFixture(fixture, footballGames);
      if (!game) { diagnostics.push({ event: fixture.name?.value, reason: 'Sem correspondência única de times e horário.' }); continue; }
      const markets = eligibleTotals(fixture);
      if (!markets) { diagnostics.push({ event: fixture.name?.value, reason: 'Total de golos 2,5 indisponível.' }); continue; }
      games.push({ apiSport: game.apiSport, teams: game.teams, competition: game.competition,
        commenceTime: game.commenceTime, observedAt: new Date().toISOString(), sourceUrl: URL,
        sourceEventId: String(fixture.id), sourceEventName: fixture.name.value,
        sourceMarket: 'Bwin Total golos (2GV excluído)', markets });
    }
  } finally { await page.close().catch(() => {}); }
  return { games, diagnostics };
}

module.exports = { readBwin, eligibleTotals, matchFixture };
