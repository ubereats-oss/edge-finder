const axios = require('axios');

const BETS = [
  { player: 'Jalen Duren',      stat: 'points',  line: 23.5, side: 'under', date: '20260404', teams: ['Detroit Pistons', 'Philadelphia 76ers'] },
  { player: 'Daniss Jenkins',   stat: 'assists', line: 6.5,  side: 'under', date: '20260404', teams: ['Detroit Pistons', 'Philadelphia 76ers'] },
  { player: 'Precious Achiuwa', stat: 'points',  line: 15.5, side: 'under', date: '20260403', teams: ['Sacramento Kings', 'New Orleans Pelicans'] },
];

async function run() {
  for (const bet of BETS) {
    const sb = await axios.get(`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=${bet.date}`);
    const ev = sb.data.events.find(e =>
      bet.teams.every(t => e.competitions[0].competitors.map(c => c.team.displayName).includes(t))
    );
    if (!ev) { console.log(`${bet.player}: jogo nao encontrado`); continue; }

    const sum = await axios.get(`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event=${ev.id}`);
    let found = false;
    for (const team of sum.data.boxscore.players) {
      for (const group of team.statistics || []) {
        const idx = group.keys?.indexOf(bet.stat);
        if (idx === -1 || idx === undefined) continue;
        for (const a of group.athletes || []) {
          if (a.athlete.displayName.toLowerCase().includes(bet.player.split(' ')[1].toLowerCase())) {
            const val = Number(a.stats[idx]);
            const hit = bet.side === 'under' ? val < bet.line : val > bet.line;
            console.log(`${bet.player} | ${bet.stat} | linha ${bet.line} ${bet.side} | real: ${val} | ${hit ? '✅ GANHOU' : '❌ PERDEU'}`);
            found = true;
          }
        }
      }
    }
    if (!found) console.log(`${bet.player}: stat nao encontrada`);
  }
}

run().catch(e => console.error(e.message));