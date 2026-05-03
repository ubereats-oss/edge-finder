const https = require('https');

function get(url) {
  return new Promise((res, rej) => {
    https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'Accept': 'application/json',
        'Origin': 'https://www.pinnacle.com',
        'x-api-key': 'CmX2KcMrXuFmNg6YFbmTxE0y9CblvR'
      }
    }, r => {
      let d = '';
      r.on('data', c => d += c);
      r.on('end', () => res(JSON.parse(d)));
    }).on('error', rej);
  });
}

async function main() {
  // NBA = sport 4, buscar leagues
  const leagues = await get('https://guest.api.arcadia.pinnacle.com/0.1/sports/4/leagues?all=false');
  const nba = leagues.find(l => l.name.toLowerCase().includes('nba'));
  console.log('NBA league:', nba?.id, nba?.name);

  // Buscar matchups da NBA
  const matchups = await get(`https://guest.api.arcadia.pinnacle.com/0.1/leagues/${nba.id}/matchups`);
  console.log(`\nMatchups encontrados: ${matchups.length}`);
  
  // Filtrar Toronto vs Cleveland (jogo que apostamos)
  for (const m of matchups) {
    const p = m.participants?.map(p => p.name?.toLowerCase()) || [];
    if (p.some(n => n.includes('toronto') || n.includes('cleveland') || 
                    n.includes('portland') || n.includes('san antonio'))) {
      console.log(`\nJogo: ${m.participants?.map(p=>p.name).join(' x ')}`);
      console.log(`ID: ${m.id}`);
      console.log(`Starts: ${m.startTime}`);
    }
  }
}

main().catch(console.error);