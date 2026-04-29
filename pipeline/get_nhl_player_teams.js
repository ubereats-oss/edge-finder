const axios = require('axios');
const fs = require('fs');

const TEAMS = [
  { id: '1',  name: 'Anaheim Ducks' },
  { id: '2',  name: 'Boston Bruins' },
  { id: '3',  name: 'Buffalo Sabres' },
  { id: '4',  name: 'Calgary Flames' },
  { id: '5',  name: 'Carolina Hurricanes' },
  { id: '6',  name: 'Chicago Blackhawks' },
  { id: '7',  name: 'Colorado Avalanche' },
  { id: '8',  name: 'Columbus Blue Jackets' },
  { id: '9',  name: 'Dallas Stars' },
  { id: '10', name: 'Detroit Red Wings' },
  { id: '11', name: 'Edmonton Oilers' },
  { id: '12', name: 'Florida Panthers' },
  { id: '13', name: 'Los Angeles Kings' },
  { id: '14', name: 'Minnesota Wild' },
  { id: '15', name: 'Montreal Canadiens' },
  { id: '16', name: 'Nashville Predators' },
  { id: '17', name: 'New Jersey Devils' },
  { id: '18', name: 'New York Islanders' },
  { id: '19', name: 'New York Rangers' },
  { id: '20', name: 'Ottawa Senators' },
  { id: '21', name: 'Philadelphia Flyers' },
  { id: '22', name: 'Pittsburgh Penguins' },
  { id: '23', name: 'Seattle Kraken' },
  { id: '24', name: 'St. Louis Blues' },
  { id: '25', name: 'San Jose Sharks' },
  { id: '26', name: 'Tampa Bay Lightning' },
  { id: '27', name: 'Toronto Maple Leafs' },
  { id: '28', name: 'Utah Hockey Club' },
  { id: '29', name: 'Vancouver Canucks' },
  { id: '30', name: 'Vegas Golden Knights' },
  { id: '31', name: 'Washington Capitals' },
  { id: '32', name: 'Winnipeg Jets' },
];

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function getPlayerTeams() {
  const playerTeam = {};

  for (const team of TEAMS) {
    try {
      const url = `https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/teams/${team.id}/roster`;
      const res = await axios.get(url);
      const athletes = res.data.athletes || [];
      for (const group of athletes) {
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

  fs.writeFileSync('nhl_player_team.json', JSON.stringify(playerTeam, null, 2));
  console.log(`Mapeamento salvo: ${Object.keys(playerTeam).length} jogadores.`);
}

getPlayerTeams();
