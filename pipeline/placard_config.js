// Chaves de competições usadas pela The Odds API. O coletor só aceita jogos
// que apareçam também no catálogo atual do Placard e tenham Pinnacle.
module.exports = [
  // Futebol
  { key: 'soccer_portugal_primeira_liga', label: 'Portugal - Primeira Liga', sport: 'soccer' },
  { key: 'soccer_epl', label: 'Premier League', sport: 'soccer' },
  { key: 'soccer_spain_la_liga', label: 'La Liga', sport: 'soccer' },
  { key: 'soccer_italy_serie_a', label: 'Serie A', sport: 'soccer' },
  { key: 'soccer_germany_bundesliga', label: 'Bundesliga', sport: 'soccer' },
  { key: 'soccer_uefa_champs_league', label: 'Liga dos Campeões', sport: 'soccer' },
  { key: 'soccer_efl_champ', label: 'Championship', aliases: ['EFL Championship', 'English Championship'], sport: 'soccer' },
  { key: 'soccer_netherlands_eredivisie', label: 'Eredivisie', sport: 'soccer' },
  { key: 'soccer_france_ligue_one', label: 'Ligue 1', sport: 'soccer' },
  { key: 'soccer_uefa_europa_league', label: 'Liga Europa', aliases: ['Europa League', 'UEFA Europa League'], sport: 'soccer' },
  // Basquete e esportes norte-americanos
  { key: 'basketball_nba', label: 'NBA', sport: 'basketball' },
  { key: 'basketball_euroleague', label: 'EuroLeague', aliases: ['Euroleague', 'Turkish Airlines EuroLeague'], sport: 'basketball' },
  { key: 'icehockey_nhl', label: 'NHL', sport: 'icehockey' },
  { key: 'americanfootball_nfl', label: 'NFL', sport: 'americanfootball' },
  { key: 'americanfootball_ncaaf', label: 'NCAA Football', aliases: ['NCAAF', 'NCAA'], sport: 'americanfootball' },
  { key: 'baseball_mlb', label: 'MLB', sport: 'baseball' },
  // Chave ativa no catálogo no momento desta verificação; ampliada pelo alias
  // Ningbo/China quando a temporada ativa da WTA mudar.
  { key: 'tennis_wta_ningbo_open', label: 'Ningbo - Individual', aliases: ['Ningbo', 'Ningbo Open'], sport: 'tennis', markets: ['h2h', 'spreads', 'totals'] },
  { key: 'mma_mixed_martial_arts', label: 'UFC', aliases: ['UFC - Ultimate Fighting Championship', 'Ultimate Fighting Championship'], sport: 'mma', markets: ['h2h'] },
];
