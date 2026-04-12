const axios = require('axios');
const fs = require('fs');

// IDs ESPN para times MLB
const TEAMS = [
  { id: '1',  name: 'Baltimore Orioles' },
  { id: '2',  name: 'Boston Red Sox' },
  { id: '3',  name: 'Los Angeles Angels' },
  { id: '4',  name: 'Chicago White Sox' },
  { id: '5',  name: 'Cleveland Guardians' },
  { id: '6',  name: 'Detroit Tigers' },
  { id: '7',  name: 'Kansas City Royals' },
  { id: '8',  name: 'Minnesota Twins' },
  { id: '9',  name: 'New York Yankees' },
  { id: '10', name: 'Oakland Athletics' },
  { id: '11', name: 'Seattle Mariners' },
  { id: '12', name: 'Texas Rangers' },
  { id: '13', name: 'Toronto Blue Jays' },
  { id: '14', name: 'Atlanta Braves' },
  { id: '15', name: 'Chicago Cubs' },
  { id: '16', name: 'Cincinnati Reds' },
  { id: '17', name: 'Houston Astros' },
  { id: '18', name: 'Los Angeles Dodgers' },
  { id: '19', name: 'Washington Nationals' },
  { id: '20', name: 'New York Mets' },
  { id: '21', name: 'Philadelphia Phillies' },
  { id: '22', name: 'Pittsburgh Pirates' },
  { id: '23', name: 'St. Louis Cardinals' },
  { id: '24', name: 'San Diego Padres' },
  { id: '25', name: 'San Francisco Giants' },
  { id: '26', name: 'Colorado Rockies' },
  { id: '27', name: 'Milwaukee Brewers' },
  { id: '28', name: 'Arizona Diamondbacks' },
  { id: '29', name: 'Miami Marlins' },
  { id: '30', name: 'Tampa Bay Rays' },
];

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function getMlbPlayerTeams() {
  const playerTeam = {};

  for (const team of TEAMS) {
    try {
      const url = `https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/teams/${team.id}/roster`;
      const res = await axios.get(url);
      const athletes = res.data.athletes || [];
      for (const group of athletes) {
        for (const a of (group.items || [])) {
          if (a.fullName) playerTeam[a.fullName] = team.name;
        }
      }
      console.log(`${team.name}: OK`);
    } catch (e) {
      console.error(`Erro ${team.name}:`, e.message);
    }
    await sleep(100);
  }

  fs.writeFileSync('mlb_player_team.json', JSON.stringify(playerTeam, null, 2));
  console.log(`Mapeamento salvo: ${Object.keys(playerTeam).length} jogadores.`);
}

getMlbPlayerTeams();
