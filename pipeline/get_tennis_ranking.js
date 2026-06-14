const axios = require('axios');
const fs = require('fs');

const YEAR = new Date().getFullYear();
const TOURS = [
  { tour: 'atp', rankId: 1 },
  { tour: 'wta', rankId: 2 },
];

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function getTourRanking(tour, rankId, ranking) {
  try {
    const idxUrl = `https://sports.core.api.espn.com/v2/sports/tennis/leagues/${tour}/seasons/${YEAR}/rankings/${rankId}?lang=en&region=us`;
    const idxRes = await axios.get(idxUrl);
    const weekRef = idxRes.data.rankings?.[0]?.$ref;
    if (!weekRef) {
      console.error(`${tour.toUpperCase()}: ranking semanal não encontrado.`);
      return;
    }

    const rankingRes = await axios.get(`${weekRef}${weekRef.includes('?') ? '&' : '?'}limit=300`);
    const ranks = rankingRes.data.ranks || [];
    console.log(`${tour.toUpperCase()}: ${ranks.length} jogadores no ranking.`);

    for (const entry of ranks) {
      const athleteRef = entry.athlete?.$ref;
      if (!athleteRef) continue;
      try {
        const athleteRes = await axios.get(athleteRef);
        const name = athleteRes.data.fullName;
        if (name) ranking[name] = entry.current;
      } catch (e) {
        console.error(`  Erro ao buscar atleta (${tour}, rank ${entry.current}):`, e.response?.status || e.message);
      }
      await sleep(150);
    }
  } catch (e) {
    console.error(`Erro ao buscar ranking ${tour.toUpperCase()}:`, e.response?.status || e.message);
  }
}

async function main() {
  const ranking = {};

  for (const { tour, rankId } of TOURS) {
    console.log(`Processando ranking ${tour.toUpperCase()}...`);
    await getTourRanking(tour, rankId, ranking);
  }

  fs.writeFileSync('ranking.json', JSON.stringify(ranking, null, 2));
  console.log(`ranking.json salvo: ${Object.keys(ranking).length} jogadores.`);
}

main();
