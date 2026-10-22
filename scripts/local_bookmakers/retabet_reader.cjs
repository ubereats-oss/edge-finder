const BASE = 'https://www.retabet.pt';
const INDEX = `${BASE}/desportos/futebol/1`;
const STOP = new Set(['fc', 'fk', 'sk', 'ac', 'afc', 'pfc', 'gnk', 'nk', 'kks', 'sc', 'sl', 'tc', 'de', 'do', 'da', 'the']);

function tokens(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).filter(token => token.length >= 3 && !STOP.has(token));
}

function teamScore(team, slug) {
  const source = tokens(team);
  const target = new Set(tokens(slug));
  if (!source.length) return 0;
  const shared = source.filter(token => target.has(token)).length;
  return shared / source.length;
}

function matchLink(game, links) {
  const ranked = links.map(url => {
    const parts = new URL(url).pathname.split('/').filter(Boolean);
    const slug = parts.at(-2) || '';
    const scores = game.teams.map(team => teamScore(team, slug));
    return { url, scores, rank: Math.min(...scores) + scores.reduce((sum, score) => sum + score, 0) / 10 };
  }).filter(candidate => candidate.scores.every(score => score >= 0.5))
    .sort((a, b) => b.rank - a.rank);
  if (!ranked.length || ranked[1]?.rank === ranked[0].rank) return null;
  return ranked[0].url;
}

function lisbonDateParts(date) {
  return Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Lisbon', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date).filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
}

function eventTimeMatches(body, commenceTime, now = new Date()) {
  const shown = String(body).slice(0, 1200).match(/\b(Hoje|Amanh[ãa])\s+(\d{1,2}):(\d{2})\b/i);
  if (!shown) return false;
  const start = lisbonDateParts(new Date(commenceTime));
  const current = lisbonDateParts(now);
  const localStart = `${start.year}-${start.month}-${start.day}`;
  const localToday = `${current.year}-${current.month}-${current.day}`;
  const dayDifference = (Date.parse(`${localStart}T00:00:00Z`) - Date.parse(`${localToday}T00:00:00Z`)) / 86400000;
  return dayDifference === (/^hoje$/i.test(shown[1]) ? 0 : 1)
    && Number(shown[2]) === Number(start.hour) && Number(shown[3]) === Number(start.minute);
}

function parseMarkets(markets) {
  const price = row => Number(String(row.price || '').replace(',', '.'));
  const usable = row => !row.locked && Number.isFinite(price(row)) && price(row) > 1;
  const winner = markets.find(market => market.title.trim() === '1-X-2');
  const sides = ['1', 'X', '2'].map(label => winner?.options.find(row => row.label.trim() === label));
  if (sides.some(row => !row || !usable(row))) return null;
  const h2h = { type: 'MRES', title: '1-X-2', selections: sides.map(row => ({
    name: row.label.trim(), fullName: row.label.trim(), price: price(row), line: null, unavailable: false,
  })) };
  const total = markets.find(market => /^Mais\/menos golos$/i.test(market.title.trim()));
  const lines = new Map();
  for (const row of total?.options || []) {
    const match = row.label.trim().match(/^([+-])\s*de\s*(\d+(?:[,.]\d+)?)$/i);
    if (!match || !usable(row)) continue;
    const line = Number(match[2].replace(',', '.'));
    if (line % 1 !== 0.5) continue;
    if (!lines.has(line)) lines.set(line, {});
    lines.get(line)[match[1] === '+' ? 'Over' : 'Under'] = row;
  }
  const line = [...lines.keys()].filter(value => lines.get(value).Over && lines.get(value).Under)
    .sort((a, b) => Math.abs(a - 2.5) - Math.abs(b - 2.5))[0];
  if (!Number.isFinite(line)) return null;
  const totals = { type: 'HCTG', title: 'Mais/menos golos', selections: ['Over', 'Under'].map(name => ({
    name, fullName: name, price: price(lines.get(line)[name]), line, unavailable: false,
  })) };
  return [h2h, totals];
}

async function readRetabet(context, footballGames, limit = 4, preferredTeams = []) {
  const page = await context.newPage();
  const games = [];
  const diagnostics = [];
  try {
    await page.goto(INDEX, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.locator('a[href*="/desportos/futebol/"]').first().waitFor({ state: 'attached', timeout: 12000 });
    const links = [...new Set(await page.locator('a[href]').evaluateAll(elements => elements
      .map(element => element.href).filter(url => /^https:\/\/www\.retabet\.pt\/desportos\/futebol\/.*\/\d{7,}$/.test(url))))];
    const candidates = footballGames.filter(game => game.apiSport.startsWith('soccer_')
      && Date.parse(game.commenceTime) > Date.now() + 600000)
      .map(game => ({ game, url: matchLink(game, links) })).filter(candidate => candidate.url)
      .sort((a, b) => {
        const preferred = candidate => preferredTeams.some(teams => JSON.stringify(teams) === JSON.stringify(candidate.game.teams));
        return Number(preferred(b)) - Number(preferred(a))
          || Date.parse(a.game.commenceTime) - Date.parse(b.game.commenceTime);
      });
    const seen = new Set();
    for (const candidate of candidates) {
      if (games.length >= limit || seen.has(candidate.url)) continue;
      seen.add(candidate.url);
      let lastError;
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          await page.goto(candidate.url, { waitUntil: 'commit', timeout: 20000 });
          await page.locator('.bets__wrapper.jbet li.jopc').first().waitFor({ state: 'attached', timeout: 20000 });
          const observed = await page.evaluate(() => ({
            title: document.title,
            body: document.body.innerText.slice(0, 1200),
            markets: [...document.querySelectorAll('.bets__wrapper.jbet')].map(wrapper => ({
              title: wrapper.querySelector('.mt')?.textContent?.trim() || '',
              options: [...wrapper.querySelectorAll('li.jopc')].map(option => ({
                label: option.querySelector('.jqt')?.textContent?.trim() || '',
                price: option.querySelector('.jpr')?.textContent?.trim() || '',
                locked: !!option.querySelector('.icon-lock:not(.none)'),
              })),
            })),
          }));
          const title = observed.title.match(/^Aposte no (.+) com Retabet$/i)?.[1];
          const titleTeams = title?.split(/\s+-\s+/);
          if (titleTeams?.length !== 2 || titleTeams.some((team, index) => teamScore(candidate.game.teams[index], team) < 0.5)) {
            throw new Error('Times da página não conferem com o jogo Betano.');
          }
          if (!eventTimeMatches(observed.body, candidate.game.commenceTime)) {
            throw new Error('Horário Retabet não confere com o início do jogo.');
          }
          const markets = parseMarkets(observed.markets);
          if (!markets) throw new Error('Mercados 1-X-2 e total de golos completos não encontrados.');
          games.push({ apiSport: candidate.game.apiSport, teams: candidate.game.teams,
            competition: candidate.game.competition, commenceTime: candidate.game.commenceTime,
            observedAt: new Date().toISOString(), sourceUrl: candidate.url,
            sourceEventId: new URL(candidate.url).pathname.split('/').at(-1), sourceEventName: title,
            sourceMarket: 'HTML pré-jogo Retabet', markets });
          lastError = null;
          break;
        } catch (error) {
          lastError = error;
          if (attempt < 2) await page.waitForTimeout(500);
        }
      }
      if (lastError) diagnostics.push({ url: candidate.url, error: lastError.message });
    }
  } finally { await page.close().catch(() => {}); }
  return { games, diagnostics };
}

module.exports = { readRetabet, parseMarkets, matchLink, eventTimeMatches };
