const axios = require('axios');
const fs = require('fs');

// IDs ESPN verificados via API em 12/04/2026
const TEAMS = [
  { id: '29', name: 'Arizona Diamondbacks' },
  { id: '11', name: 'Athletics' },
  { id: '15', name: 'Atlanta Braves' },
  { id: '1',  name: 'Baltimore Orioles' },
  { id: '2',  name: 'Boston Red Sox' },
  { id: '16', name: 'Chicago Cubs' },
  { id: '4',  name: 'Chicago White Sox' },
  { id: '17', name: 'Cincinnati Reds' },
  { id: '5',  name: 'Cleveland Guardians' },
  { id: '27', name: 'Colorado Rockies' },
  { id: '6',  name: 'Detroit Tigers' },
  { id: '18', name: 'Houston Astros' },
  { id: '7',  name: 'Kansas City Royals' },
  { id: '3',  name: 'Los Angeles Angels' },
  { id: '19', name: 'Los Angeles Dodgers' },
  { id: '28', name: 'Miami Marlins' },
  { id: '8',  name: 'Milwaukee Brewers' },
  { id: '9',  name: 'Minnesota Twins' },
  { id: '21', name: 'New York Mets' },
  { id: '10', name: 'New York Yankees' },
  { id: '22', name: 'Philadelphia Phillies' },
  { id: '23', name: 'Pittsburgh Pirates' },
  { id: '25', name: 'San Diego Padres' },
  { id: '26', name: 'San Francisco Giants' },
  { id: '12', name: 'Seattle Mariners' },
  { id: '24', name: 'St. Louis Cardinals' },
  { id: '30', name: 'Tampa Bay Rays' },
  { id: '13', name: 'Texas Rangers' },
  { id: '14', name: 'Toronto Blue Jays' },
  { id: '20', name: 'Washington Nationals' },
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
