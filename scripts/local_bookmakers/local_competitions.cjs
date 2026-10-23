const PRIORITY = [
  ['soccer_uefa_europa_league', 'Liga Europa', ['liga europa', 'europa league', 'uefa europa league']],
  ['soccer_uefa_champs_league', 'Liga dos Campeões', ['liga dos campeoes', 'champions league', 'uefa champions league']],
  ['soccer_portugal_primeira_liga', 'Primeira Liga', ['primeira liga', 'liga portugal', 'portugal - 1a liga']],
  ['soccer_epl', 'Premier League', ['premier league', 'inglaterra - premier league']],
  ['soccer_spain_la_liga', 'La Liga', ['la liga', 'laliga', 'espanha - 1a liga']],
  ['soccer_italy_serie_a', 'Serie A', ['serie a', 'italia - serie a']],
  ['soccer_germany_bundesliga', 'Bundesliga', ['bundesliga', 'alemanha - bundesliga']],
  ['soccer_france_ligue_one', 'Ligue 1', ['ligue 1', 'franca - ligue 1']],
  ['soccer_netherlands_eredivisie', 'Eredivisie', ['eredivisie', 'paises baixos - eredivisie']],
  ['soccer_efl_champ', 'Championship', ['championship', 'efl championship', 'inglaterra - championship']],
  ['basketball_nba', 'NBA', ['nba', 'eua - nba']],
];

const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

function competition(label) {
  const text = normalize(label);
  if (!text) return null;
  for (const [apiSport, name, aliases] of PRIORITY) {
    if (aliases.some(alias => text === normalize(alias) || text.includes(` ${normalize(alias)} `)
      || text.startsWith(`${normalize(alias)} `) || text.endsWith(` ${normalize(alias)}`))) {
      return { apiSport, competition: name };
    }
  }
  return null;
}

function timeParts(date, zone) {
  return Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date).filter(part => part.type !== 'literal').map(part => [part.type, Number(part.value)]));
}

function localClock(value, zone, now = new Date()) {
  const shown = String(value || '').match(/(Hoje|Amanh[ãa])\s*[-,]?\s*(\d{1,2}):(\d{2})\b/i);
  if (!shown) return null;
  const current = timeParts(now, zone);
  const day = Date.UTC(current.year, current.month - 1, current.day
    + (/^amanh/i.test(shown[1]) ? 1 : 0));
  const date = new Date(day);
  const wall = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(),
    Number(shown[2]), Number(shown[3]));
  const observed = timeParts(new Date(wall), zone);
  const observedWall = Date.UTC(observed.year, observed.month - 1, observed.day,
    observed.hour, observed.minute);
  const instant = new Date(wall + wall - observedWall);
  const confirm = timeParts(instant, zone);
  return confirm.year === date.getUTCFullYear() && confirm.month === date.getUTCMonth() + 1
    && confirm.day === date.getUTCDate() && confirm.hour === Number(shown[2])
    && confirm.minute === Number(shown[3]) ? instant.toISOString() : null;
}

function ordered(games) {
  const ranks = new Map(PRIORITY.map(([key], index) => [key, index]));
  return games.filter(game => ranks.has(game.apiSport)).sort((a, b) =>
    ranks.get(a.apiSport) - ranks.get(b.apiSport)
    || Date.parse(a.commenceTime) - Date.parse(b.commenceTime));
}

module.exports = { PRIORITY, competition, localClock, ordered };
