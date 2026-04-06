const axios = require('axios');
const fs = require('fs');

async function getNbaInjuries() {
  const url = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/injuries';
  let data;
  try {
    const res = await axios.get(url);
    data = res.data;
  } catch (e) {
    console.error('Erro ao buscar injuries ESPN:', e.message);
    fs.writeFileSync('nba_injuries_today.json', JSON.stringify({}, null, 2));
    return;
  }

  const result = {};

  for (const teamEntry of data.injuries || []) {
    const teamName = teamEntry.displayName;
    if (!teamName) continue;

    const absentNames = [];
    for (const injury of teamEntry.injuries || []) {
      const status = (injury.status || '').toLowerCase();
      if (status === 'out' || status === 'doubtful') {
        const name = injury.athlete?.displayName;
        if (name) absentNames.push(name);
      }
    }

    if (absentNames.length > 0) result[teamName] = absentNames;
  }

  fs.writeFileSync('nba_injuries_today.json', JSON.stringify(result, null, 2));
  const totalAbsent = Object.values(result).reduce((s, v) => s + v.length, 0);
  console.log(`Injuries salvos: ${totalAbsent} jogadores ausentes/duvidosos em ${Object.keys(result).length} times.`);
}

getNbaInjuries();