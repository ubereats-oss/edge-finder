const cheerio = require('cheerio');
const URL = 'https://www.betclic.pt/futebol-sfootball/liga-europa-c3453';
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

function matchCard(card, games) {
  const names = card.label.split(' - ');
  if (names.length !== 2) return null;
  const clock = card.text.match(/\b(\d{1,2}):(\d{2})\b/);
  if (!clock) return null;
  const candidates = games.filter(game => game.apiSport === 'soccer_uefa_europa_league'
    && game.teams.every((team, index) => teamScore(team, names[index]) >= 0.5)
    && new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit',
      hourCycle: 'h23' }).format(new Date(game.commenceTime)) === `${clock[1].padStart(2, '0')}:${clock[2]}`);
  return candidates.length === 1 ? candidates[0] : null;
}

function parsePrice(text) {
  const price = Number(String(text || '').trim().replace(',', '.'));
  return Number.isFinite(price) && price > 1 ? price : null;
}

function parseMarkets(boxes) {
  const winner = boxes.find(box => box.title === 'Resultado (Tempo Regulamentar)');
  const total = boxes.find(box => box.title === 'Total de golos - acima/abaixo');
  if (!winner || winner.rows.length !== 3) return null;
  const prices = winner.rows.map(row => parsePrice(row.price));
  if (prices.some(price => price === null)) return null;
  const markets = [{ type: 'MRES', title: winner.title, selections: prices.map((price, index) => ({
    name: ['1', 'X', '2'][index], fullName: winner.rows[index].label,
    price, line: null, unavailable: false,
  })) }];
  const lines = new Map();
  for (const row of total?.rows || []) {
    const found = row.label.match(/^(Acima|Abaixo) de (\d+(?:[,.]\d+)?)$/i);
    const price = parsePrice(row.price);
    if (!found || price === null) continue;
    const line = Number(found[2].replace(',', '.'));
    if (line < 0.5 || line > 4.5 || line % 1 !== 0.5) continue;
    if (!lines.has(line)) lines.set(line, {});
    lines.get(line)[/^acima$/i.test(found[1]) ? 'Over' : 'Under'] = price;
  }
  for (const [line, sides] of lines) {
    if (!sides.Over || !sides.Under) continue;
    markets.push({ type: 'HCTG', title: `${total.title} ${line}`, selections: ['Over', 'Under'].map(name => ({
      name, fullName: `${name} ${line}`, price: sides[name], line, unavailable: false,
    })) });
  }
  return markets.length > 1 ? markets : null;
}

async function readBetclic(context, footballGames, limit = 10) {
  const page = await context.newPage();
  const games = [];
  const diagnostics = [];
  try {
    let cards = [];
    for (let attempt = 1; attempt <= 2 && !cards.length; attempt++) {
      const response = await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
      if (response?.status() !== 200) continue;
      const html = cheerio.load(await response.text());
      cards = html('a.cardEvent').toArray().map(element => ({
        label: html(element).attr('aria-label') || '',
        href: new URL(html(element).attr('href'), URL).toString(), text: html(element).text(),
      }));
    }
    if (!cards.length) throw new Error('Betclic: página da Liga Europa sem eventos pré-jogo no HTML.');
    const matched = cards.map(card => ({ card, game: matchCard(card, footballGames) })).filter(row => row.game);
    for (const { card, game } of matched.slice(0, limit)) {
      try {
        let boxes = [];
        for (let attempt = 1; attempt <= 2 && !boxes.length; attempt++) {
          const response = await page.goto(card.href, { waitUntil: 'domcontentloaded', timeout: 45000 });
          if (response?.status() !== 200) continue;
          const html = cheerio.load(await response.text());
          boxes = html('[data-qa="market-box"]').toArray().map(box => ({
            title: html(box).find('[data-qa="market-title"]').first().text().trim(),
            rows: html(box).find('.marketBox_lineSelection').toArray().map(row => ({
              label: html(row).find('.marketBox_label').first().text().trim()
                || html(row).find('bc-button-label').first().text().trim(),
              price: html(row).find('[data-qa="market-selection"] bcdk-bet-button-odds-animated').first().text().trim(),
            })),
          }));
        }
        if (!boxes.length) throw new Error('Mercados da página não carregaram após duas navegações.');
        const markets = parseMarkets(boxes);
        if (!markets) throw new Error('Resultado regulamentar e total de golos completos não encontrados.');
        games.push({ apiSport: game.apiSport, teams: game.teams, competition: game.competition,
          commenceTime: game.commenceTime, observedAt: new Date().toISOString(), sourceUrl: card.href,
          sourceEventId: card.href.match(/-m(\d+)$/)?.[1] || null, sourceEventName: card.label,
          sourceMarket: 'Betclic HTML pré-jogo: resultado regulamentar e total de golos', markets });
      } catch (error) { diagnostics.push({ event: card.label, error: error.message }); }
    }
  } finally { await page.close().catch(() => {}); }
  return { games, diagnostics };
}

module.exports = { readBetclic, parseMarkets, matchCard };
