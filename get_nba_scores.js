const axios = require('axios');
const fs = require('fs');

const MONTHS = [
  { start: '20241001', end: '20241031', weight: 1 },
  { start: '20241101', end: '20241130', weight: 1 },
  { start: '20241201', end: '20241231', weight: 1 },
  { start: '20250101', end: '20250131', weight: 1 },
  { start: '20250201', end: '20250228', weight: 1 },
  { start: '20250301', end: '20250331', weight: 1 },
  { start: '20250401', end: '20250430', weight: 1 },
  { start: '20251001', end: '20251031', weight: 2 },
  { start: '20251101', end: '20251130', weight: 2 },
  { start: '20251201', end: '20251231', weight: 2 },
  { start: '20260101', end: '20260131', weight: 3 },
  { start: '20260201', end: '20260228', weight: 3 },
  { start: '20260301', end: '20260331', weight: 3 },
  { start: '20260401', end: '20260430', weight: 3 },
];

async function fetchMonth(start, end) {
  const url = `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?limit=200&dates=${start}-${end}`;
  const res = await axios.get(url);
  return res.data.events || [];
}

async function getNbaScores() {
  try {
    const stats = {};
    let totalGames = 0;

    for (const { start, end, weight } of MONTHS) {
      const events = await fetchMonth(start, end);
      const completed = events.filter(e => e.competitions[0].status.type.completed);

      completed.forEach(e => {
        const comp = e.competitions[0];
        const home = comp.competitors.find(c => c.homeAway === 'home');
        const away = comp.competitors.find(c => c.homeAway === 'away');
        if (!home || !away) return;

        const homeName = home.team.displayName;
        const awayName = away.team.displayName;
        const homeScore = parseInt(home.score);
        const awayScore = parseInt(away.score);
        if (!homeScore && !awayScore) return;

        if (!stats[homeName]) stats[homeName] = {};
        if (!stats[awayName]) stats[awayName] = {};
        if (!stats[homeName].home) stats[homeName].home = { weightedSum: 0, weightedCount: 0 };
        if (!stats[awayName].away) stats[awayName].away = { weightedSum: 0, weightedCount: 0 };

        stats[homeName].home.weightedSum += (homeScore - awayScore) * weight;
        stats[homeName].home.weightedCount += weight;
        stats[awayName].away.weightedSum += (awayScore - homeScore) * weight;
        stats[awayName].away.weightedCount += weight;

        totalGames++;
      });

      console.log(`${start}: ${completed.length} jogos completos`);
    }

    const rating = {};
    for (const [team, locs] of Object.entries(stats)) {
      const h = locs.home;
      const a = locs.away;
      if (!h || !a || h.weightedCount < 5 || a.weightedCount < 5) continue;
      rating[team] = {
        home: parseFloat((h.weightedSum / h.weightedCount).toFixed(2)),
        away: parseFloat((a.weightedSum / a.weightedCount).toFixed(2)),
      };
    }

    if (Object.keys(rating).length === 0) {
      console.error('ERRO: nenhum time com dados suficientes.');
      return;
    }

    fs.writeFileSync('nba_rating.json', JSON.stringify(rating, null, 2));
    console.log(`NBA rating salvo: ${Object.keys(rating).length} times, ${totalGames} jogos processados.`);
  } catch (err) {
    console.error('Erro ao buscar scores NBA:', err.message);
  }
}

getNbaScores();