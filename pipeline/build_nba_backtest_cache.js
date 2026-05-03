const fs = require('fs');

// Lê nba_player_stats.json e gera nba_boxscores_cache.json no formato game-centric
// esperado pelo backtest_nba_props_v2.js
//
// Agrupamento: date + opponent + location → cada entrada tem todos os jogadores
// daquele time naquele jogo (home e away ficam em entradas separadas, o que é
// suficiente para o backtest pois ele processa cada jogador individualmente).

const STAT_KEYS = ['points', 'rebounds', 'assists', 'steals', 'fouls', 'threes'];
// Mapeamento de temporada ESPN → label do backtest
const SEASON_LABEL = { 2025: 'base', 2026: 'walk' };

function main() {
  if (!fs.existsSync('nba_player_stats.json')) {
    console.error('ERRO: nba_player_stats.json não encontrado.');
    process.exit(1);
  }

  const playerStats = JSON.parse(fs.readFileSync('nba_player_stats.json', 'utf8'));
  const playerTeam  = fs.existsSync('nba_player_team.json')
    ? JSON.parse(fs.readFileSync('nba_player_team.json', 'utf8'))
    : {};

  const games = {};

  for (const [playerName, seasonsData] of Object.entries(playerStats)) {
    const currentTeam = playerTeam[playerName] || 'Unknown';

    for (const [seasonStr, seasonData] of Object.entries(seasonsData)) {
      const season = SEASON_LABEL[parseInt(seasonStr)];
      if (!season) continue;

      for (const gameTypeData of Object.values(seasonData)) {
        for (const loc of ['home', 'away']) {
          const ctx = gameTypeData[loc];
          if (!ctx || !ctx.points || ctx.points.length === 0) continue;

          const n = ctx.points.length;
          for (let i = 0; i < n; i++) {
            const base = ctx.points[i];
            const { date, opponent } = base;
            if (!date || !opponent) continue;

            const gameKey = date.slice(0, 10) + '|' + opponent + '|' + loc;

            if (!games[gameKey]) {
              games[gameKey] = {
                date,
                season,
                homeTeam: loc === 'home' ? currentTeam : opponent,
                awayTeam: loc === 'away' ? currentTeam : opponent,
                players: [],
              };
            }

            const stats = {};
            for (const stat of STAT_KEYS) {
              const arr = ctx[stat];
              stats[stat] = arr && arr[i] !== undefined ? (arr[i].value ?? 0) : 0;
            }

            games[gameKey].players.push({ playerName, location: loc, stats });
          }
        }
      }
    }
  }

  const gameCount      = Object.keys(games).length;
  const playerGames    = Object.values(games).reduce((s, g) => s + g.players.length, 0);
  const withThrees     = Object.values(games).flatMap(g => g.players).filter(p => p.stats.threes > 0).length;
  const baseCount      = Object.values(games).filter(g => g.season === 'base').length;
  const walkCount      = Object.values(games).filter(g => g.season === 'walk').length;

  console.log(`Games: ${gameCount} (base: ${baseCount} | walk: ${walkCount})`);
  console.log(`Player-games: ${playerGames} | com threes > 0: ${withThrees}`);

  fs.writeFileSync('nba_boxscores_cache.json', JSON.stringify(games));
  console.log('nba_boxscores_cache.json salvo.');
}

main();
