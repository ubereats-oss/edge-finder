const cheerio = require('cheerio');
const { exactTeams } = require('../../functions/market_integrity');
const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
function listingIdentities(source, baseUrl) {
  const $ = cheerio.load(source);
  const identities = new Map();
  for (const element of $('li.jev.event__item, [data-u].jev').toArray()) {
    const item = $(element);
    const anchor = item.find('a.event__players').first();
    const href = anchor.attr('href') || item.attr('data-u');
    if (!href) continue;
    const url = new URL(href, baseUrl).href;
    let teams = anchor.find('.event__players-name [data-p]').toArray().map(node => clean($(node).text()));
    if (teams.length !== 2) teams = clean(anchor.attr('title')).split(/\s+-\s+/);
    const sourceEventId = new URL(url).pathname.split('/').filter(Boolean).at(-1);
    if (teams.length === 2 && teams.every(Boolean) && (!item.attr('data-i') || item.attr('data-i') === sourceEventId))
      identities.set(url, { teams, sourceEventId });
  }
  return identities;
}
function verifyPageIdentity(source, url, listing) {
  const $ = cheerio.load(source);
  const id = new URL(url).pathname.split('/').filter(Boolean).at(-1);
  const headers = $('.breadcrumbs__event-title[data-id]').toArray()
    .filter(node => $(node).attr('data-id') === id);
  if (!listing || listing.sourceEventId !== id || listing.teams?.length !== 2)
    return { verified: false, reason: 'identidade da listagem Retabet ausente' };
  if (headers.length !== 1) return { verified: false, reason: 'ID do jogo na página Retabet ausente ou divergente' };
  const teams = clean($(headers[0]).find('h1').first().text()).split(/\s+-\s+/);
  if (!exactTeams(teams, listing.teams)) return { verified: false,
    reason: 'nomes da página Retabet divergem da listagem', pageTeams: teams, listingTeams: listing.teams };
  return { verified: true, teams, listingTeams: listing.teams, sourceEventId: id };
}
module.exports = { listingIdentities, verifyPageIdentity };
