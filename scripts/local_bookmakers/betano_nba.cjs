const cheerio = require('cheerio');
const { normalize } = require('../../functions/placard_value.js');
const { readSelections, adaptTotalsAndHandicaps } = require('../../pipeline/local_betano_reader.js');

function initialState(html) {
  const $ = cheerio.load(String(html || ''));
  const scripts = $('script').toArray().map(node => $(node).html() || '');
  const script = scripts.find(text => /^\s*window\[['"]initial_state['"]\]\s*=/.test(text));
  if (!script) throw new Error('NBA: estado inicial da página ausente');
  const start = script.indexOf('{');
  let depth = 0, quoted = false, escaped = false;
  for (let i = start; start >= 0 && i < script.length; i++) {
    const c = script[i];
    if (quoted) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') quoted = false;
    } else if (c === '"') quoted = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) {
      try { return JSON.parse(script.slice(start, i + 1)); }
      catch { break; }
    }
  }
  throw new Error('NBA: estado inicial da página inválido');
}

function listingCard(event, now = Date.now()) {
  const teams = (event.participants || []).map(p => p.name).filter(Boolean);
  const start = Number(event.startTime);
  let url;
  try { url = new URL(event.url, 'https://www.betano.pt'); } catch { /* rejected below */ }
  const reason = teams.length !== 2 ? 'NBA: identidade da listagem incompleta'
    : event.sportId !== 'BASK' || event.leagueName !== 'NBA' ? 'NBA: competição da listagem divergente'
      : !Number.isFinite(start) || start <= now + 600000 || start > now + 12 * 3600000
        ? 'fora da janela de 12 horas'
        : !url || url.origin !== 'https://www.betano.pt'
          || !url.pathname.startsWith('/odds/') || url.pathname.split('/').filter(Boolean).at(-1) !== String(event.id)
          ? 'NBA: URL da página do jogo ausente ou divergente' : null;
  return { event, teams, sourceEventId: String(event.id),
    commenceTime: Number.isFinite(start) ? new Date(start).toISOString() : null,
    url: url?.href || null, reason };
}

function parseNbaPage(html, card) {
  const event = initialState(html)?.data?.event;
  const teams = (event?.participants || []).map(p => p.name).filter(Boolean);
  const sameTeams = teams.length === 2 && card.teams.length === 2
    && new Set(teams.map(normalize)).size === 2
    && teams.map(normalize).sort().join('|') === card.teams.map(normalize).sort().join('|');
  if (teams.length !== 2) throw new Error('NBA: identidade da página do jogo ausente');
  if (!sameTeams || String(event.id) !== card.sourceEventId)
    throw new Error('NBA: identidade da página diverge da listagem');
  if (Number(event.startTime) !== Number(card.event.startTime))
    throw new Error('NBA: horário da página diverge da listagem');
  const columns = event.sixPackLayout?.columns;
  if (!Array.isArray(columns) || !columns.length) throw new Error('NBA: página sem mercados principais');
  const markets = ['H2HT', 'FHOT', 'FTPO'].map(type => {
    const matches = columns.filter(m => m.type === type);
    const market = matches[0], selections = market?.selections;
    if (matches.length !== 1 || selections?.length !== 2 || selections.some(s =>
      !Number.isFinite(Number(s.price)) || Number(s.price) <= 1 || s.isSuspended === true || s.isAvailable === false))
      throw new Error(`NBA: mercado principal incompleto (${type})`);
    if (type === 'H2HT' && selections.map(s => normalize(s.fullName || s.name)).sort().join('|') !== teams.map(normalize).sort().join('|'))
      throw new Error('NBA: participantes do mercado vencedor divergentes');
    if (type === 'FHOT' && selections.map(s => normalize(s.fullName)).sort().join('|') !== teams.map(normalize).sort().join('|'))
      throw new Error('NBA: participantes do handicap divergentes');
    if (type !== 'H2HT' && (selections.some(s => s.handicap === null || s.handicap === undefined
        || !Number.isFinite(Number(s.handicap)))
      || (type === 'FHOT' && Number(selections[0].handicap) !== -Number(selections[1].handicap))
      || (type === 'FTPO' && (Number(selections[0].handicap) !== Number(selections[1].handicap)
        || !selections.some(s => /^mais\b/i.test(s.name)) || !selections.some(s => /^menos\b/i.test(s.name))))))
      throw new Error(`NBA: linhas do mercado principal incompletas (${type})`);
    return market;
  });
  const game = readSelections({ data: { events: [{ ...event, sportId: 'BASK', leagueName: 'NBA',
    url: card.url, markets }] } })[0];
  if (!game || game.markets.length !== 3) throw new Error('NBA: mercados principais não puderam ser lidos');
  return { ...adaptTotalsAndHandicaps(game), listingTeams: card.teams, sourceIdentityVerified: true };
}

async function readNbaPages(context, events, listingUrl, status, now = Date.now()) {
  const cards = events.map(event => listingCard(event, now));
  context.report?.({ phase: 'league', league: 'basketball_nba', url: listingUrl, httpStatus: status,
    seen: cards.length, events: cards.map(c => ({ url: c.url, eventId: c.sourceEventId,
      teams: c.teams, commenceTime: c.commenceTime, reason: c.reason || 'aguarda página NBA' })) });
  const results = await Promise.allSettled(cards.filter(c => !c.reason).map(async card => {
    let page, game, reason;
    try {
      page = await context.newPage();
      const response = await page.goto(card.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      if (!response?.ok()) throw new Error(`NBA: página do jogo HTTP ${response?.status() ?? 'desconhecido'}`);
      game = parseNbaPage(await page.content(), card);
      reason = 'aceito';
      return game;
    } catch (error) { reason = error.message; throw error; }
    finally {
      context.report?.({ phase: 'event_decision', league: 'basketball_nba', url: card.url,
        teams: card.teams, commenceTime: card.commenceTime, reason });
      await page?.close().catch(() => {});
    }
  }));
  return { games: results.filter(r => r.status === 'fulfilled').map(r => r.value),
    diagnostics: results.filter(r => r.status === 'rejected').map(r => ({ phase: 'nba_page', error: r.reason.message })) };
}

module.exports = { initialState, listingCard, parseNbaPage, readNbaPages };
