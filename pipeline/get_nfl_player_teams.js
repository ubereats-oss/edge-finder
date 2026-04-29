const axios = require('axios');
const fs = require('fs');

const TEAMS = [
  { id: '1',  name: 'Atlanta Falcons' },
  { id: '2',  name: 'Buffalo Bills' },
  { id: '3',  name: 'Chicago Bears' },
  { id: '4',  name: 'Cincinnati Bengals' },
  { id: '5',  name: 'Cleveland Browns' },
  { id: '6',  name: 'Dallas Cowboys' },
  { id: '7',  name: 'Denver Broncos' },
  { id: '8',  name: 'Detroit Lions' },
  { id: '9',  name: 'Green Bay Packers' },
  { id: '10', name: 'Tennessee Titans' },
  { id: '11', name: 'Indianapolis Colts' },
  { id: '12', name: 'Kansas City Chiefs' },
  { id: '13', name: 'Las Vegas Raiders' },
  { id: '14', name: 'Los Angeles Rams' },
  { id: '15', name: 'Miami Dolphins' },
  { id: '16', name: 'Minnesota Vikings' },
  { id: '17', name: 'New England Patriots' },
  { id: '18', name: 'New Orleans Saints' },
  { id: '19', name: 'New York Giants' },
  { id: '20', name: 'New York Jets' },
  { id: '21', name: 'Philadelphia Eagles' },
  { id: '22', name: 'Arizona Cardinals' },
  { id: '23', name: 'Pittsburgh Steelers' },
  { id: '24', name: 'Los Angeles Chargers' },
  { id: '25', name: 'San Francisco 49ers' },
  { id: '26', name: 'Seattle Seahawks' },
  { id: '27', name: 'Tampa Bay Buccaneers' },
  { id: '28', name: 'Washington Commanders' },
  { id: '29', name: 'Carolina Panthers' },
  { id: '30', name: 'Jacksonville Jaguars' },
  { id: '33', name: 'Baltimore Ravens' },
  { id: '34', name: 'Houston Texans' },
];

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function getPlayerTeams() {
  const playerTeam = {};

  for (const team of TEAMS) {
    try {
      const url = `https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/${team.id}/roster`;
      const res = await axios.get(url);
      const groups = res.data.athletes || [];
      for (const group of groups) {
        for (const a of (group.items || group.athletes || [])) {
          if (a.fullName) playerTeam[a.fullName] = team.name;
        }
      }
      console.log(`${team.name}: OK`);
    } catch (e) {
      console.error(`Erro ${team.name}:`, e.message);
    }
    await sleep(150);
  }

  fs.writeFileSync('nfl_player_team.json', JSON.stringify(playerTeam, null, 2));
  console.log(`Mapeamento NFL salvo: ${Object.keys(playerTeam).length} jogadores.`);
}

getPlayerTeams();
