const cheerio = require('cheerio');
const clean = value => String(value || '').replace(/\s+/g, ' ').trim();

function pageTeams(house, source) {
  const $ = cheerio.load(source);
  $('script,style,noscript,title').remove();
  if (house === 'esc_online') {
    const headers = $('h1').toArray().map(node => clean($(node).text()))
      .filter(text => /^Apostar em /i.test(text));
    return headers.length === 1 ? headers[0].replace(/^Apostar em /i, '').split(/\s+:\s+/) : [];
  }
  if (house === 'goldenpark') return $('h1.default .container-vertical').toArray().map(node => clean($(node).text()));
  if (house === 'betclic') {
    const home = $('.event_scoreboard [data-qa="contestant-1-label"]');
    const away = $('.event_scoreboard [data-qa="contestant-2-label"]');
    return home.length === 1 && away.length === 1 ? [clean(home.text()), clean(away.text())] : [];
  }
  // Only participants outside listing rows can be evidence of an individual LeBull event.
  if (house === 'lebull') return $('.team-column-name').toArray()
    .filter(node => !$(node).closest('.game-row').length).map(node => clean($(node).text()));
  return [];
}
function verifyIdentity(house, source, listingTeams) {
  const teams = pageTeams(house, source);
  const verified = teams.length === 2 && listingTeams?.length === 2 && teams.every(Boolean)
    && teams.every((name, index) => name === clean(listingTeams[index]));
  return { verified, teams, listingTeams,
    reason: verified ? null : teams.length !== 2 || teams.some(name => !name)
      ? 'identidade da página do jogo ausente ou ambígua'
      : 'nomes da página do jogo divergem da listagem' };
}
function requireIdentity(house, source, listingTeams) {
  const result = verifyIdentity(house, source, listingTeams);
  if (!result.verified) throw new Error(`${house}: ${result.reason}`);
  return { teams: result.teams, listingTeams: result.listingTeams, sourceIdentityVerified: true };
}
module.exports = { pageTeams, verifyIdentity, requireIdentity };
