const axios = require('axios');
const fs = require('fs');

async function getMatches() {
  const url = 'https://api.sportradar.com/tennis/trial/v3/en/schedules/live.json?api_key=SEU_API_KEY';

  const response = await axios.get(url);

  const matches = response.data.sport_events.map(m => ({
    player1Id: m.competitors[0].id,
    player2Id: m.competitors[1].id,
    player1: m.competitors[0].name,
    player2: m.competitors[1].name
  }));

  fs.writeFileSync('matches.json', JSON.stringify(matches, null, 2));

  console.log('Matches salvos');
}

getMatches();
