const axios = require('axios');
const fs = require('fs');

const TEAMS = [
  { id: '1',  name: 'Atlanta Hawks' },
  { id: '2',  name: 'Boston Celtics' },
  { id: '3',  name: 'New Orleans Pelicans' },
  { id: '4',  name: 'Chicago Bulls' },
  { id: '5',  name: 'Cleveland Cavaliers' },
  { id: '6',  name: 'Dallas Mavericks' },
  { id: '7',  name: 'Denver Nuggets' },
  { id: '8',  name: 'Detroit Pistons' },
  { id: '9',  name: 'Golden State Warriors' },
  { id: '10', name: 'Houston Rockets' },
  { id: '11', name: 'Indiana Pacers' },
  { id: '12', name: 'Los Angeles Clippers' },
  { id: '13', name: 'Los Angeles Lakers' },
  { id: '29', name: 'Memphis Grizzlies' },
  { id: '14', name: 'Miami Heat' },
  { id: '15', name: 'Milwaukee Bucks' },
  { id: '16', name: 'Minnesota Timberwolves' },
  { id: '17', name: 'Brooklyn Nets' },
  { id: '18', name: 'New York Knicks' },
  { id: '25', name: 'Oklahoma City Thunder' },
  { id: '19', name: 'Orlando Magic' },
  { id: '20', name: 'Philadelphia 76ers' },
  { id: '21', name: 'Phoenix Suns' },
  { id: '22', name: 'Portland Trail Blazers' },
  { id: '23', name: 'Sacramento Kings' },
  { id: '24', name: 'San Antonio Spurs' },
  { id: '28', name: 'Toronto Raptors' },
  { id: '26', name: 'Utah Jazz' },
  { id: '27', name: 'Washington Wizards' },
  { id: '30', name: 'Charlotte Hornets' },
];

// Agrupa posições ESPN em categorias funcionais
function positionGroup(abbr) {
  if (!abbr) return 'unknown';
  const pos = abbr.toUpperCase();
  if (['PG', 'SG', 'G'].includes(pos)) return 'guard';
  if (['SF', 'PF', 'F'].includes(pos)) return 'forward';
  if (['C'].includes(pos)) return 'center';
  return 'unknown';
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function getPlayerTeams() {
  const playerTeam = {};
  const playerPositions = {};

  for (const team of TEAMS) {
    try {
      const url = `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/${team.id}/roster`;
      const res = await axios.get(url);
      const athletes = res.data.athletes || [];
      for (const a of athletes) {
        playerTeam[a.fullName] = team.name;
        const abbr = a.position?.abbreviation ?? null;
        playerPositions[a.fullName] = {
          position: abbr,
          group: positionGroup(abbr),
        };
      }
      console.log(`${team.name}: ${athletes.length} jogadores`);
    } catch (e) {
      console.error(`Erro ${team.name}:`, e.message);
    }
    await sleep(100);
  }

  fs.writeFileSync('nba_player_team.json', JSON.stringify(playerTeam, null, 2));
  fs.writeFileSync('nba_player_positions.json', JSON.stringify(playerPositions, null, 2));
  console.log(`Mapeamento salvo: ${Object.keys(playerTeam).length} jogadores.`);
}

getPlayerTeams();