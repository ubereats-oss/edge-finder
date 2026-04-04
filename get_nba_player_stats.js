const axios = require('axios');
const fs = require('fs');

const MONTHS = [
  // Temporada 2023-24 (regular)
  { start: '20231001', end: '20231031', season: 2024 },
  { start: '20231101', end: '20231130', season: 2024 },
  { start: '20231201', end: '20231231', season: 2024 },
  { start: '20240101', end: '20240131', season: 2024 },
  { start: '20240201', end: '20240229', season: 2024 },
  { start: '20240301', end: '20240331', season: 2024 },
  { start: '20240401', end: '20240430', season: 2024 },
  // Temporada 2023-24 (playoffs)
  { start: '20240501', end: '20240531', season: 2024 },
  { start: '20240601', end: '20240630', season: 2024 },
  // Temporada 2024-25 (regular)
  { start: '20241001', end: '20241031', season: 2025 },
  { start: '20241101', end: '20241130', season: 2025 },
  { start: '20241201', end: '20241231', season: 2025 },
  { start: '20250101', end: '20250131', season: 2025 },
  { start: '20250201', end: '20250228', season: 2025 },
  { start: '20250301', end: '20250331', season: 2025 },
  { start: '20250401', end: '20250430', season: 2025 },
  // Temporada 2024-25 (playoffs)
  { start: '20250501', end: '20250531', season: 2025 },
  { start: '20250601', end: '20250630', season: 2025 },
  // Temporada 2025-26 (regular)
  { start: '20251001', end: '20251031', season: 2026 },
  { start: '20251101', end: '20251130', season: 2026 },
  { start: '20251201', end: '20251231', season: 2026 },
  { start: '20260101', end: '20260131', season: 2026 },
  { start: '20260201', end: '20260228', season: 2026 },
  { start: '20260301', end: '20260331', season: 2026 },
  { start: '20260401', end: '20260430', season: 2026 },
];

const STAT_KEYS = ['points', 'rebounds', 'assists', 'steals', 'fouls', 'threes'];

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function emptyContext() {
  const obj = { games: 0 };
  for (const k of STAT_KEYS) obj[k] = [];
  return obj;
}

function ensurePath(raw, player, season, gameType, location) {
  if (!raw[player]) raw[player] = {};
  if (!raw[player][season]) raw[player][season] = {};
  if (!raw[player][season][gameType]) {
    raw[player][season][gameType] = { home: emptyContext(), away: emptyContext() };
  }
  return raw[player][season][gameType][location];
}

async function fetchEventIds(start, end) {
  const url = `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?limit=200&dates=${start}-${end}`;
  const res = await axios.get(url);
  return (res.data.events || [])
    .filter(e => e.competitions[0].status.type.completed)
    .map(e => ({
      id: e.id,
      seasonType: e.season?.type === 3 ? 'playoffs' : 'regular',
      season: e.season?.year,
      homeTeam: e.competitions[0].competitors.find(c => c.homeAway === 'home')?.team?.displayName,
      awayTeam: e.competitions[0].competitors.find(c => c.homeAway === 'away')?.team?.displayName,
    }));
}

async function fetchBoxScore(eventId) {
  const url = `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event=${eventId}`;
  const res = await axios.get(url);
  return res.data.boxscore?.players || [];
}

async function getPlayerStats() {
  const raw = {};
  let totalBoxScores = 0;

  for (const { start, end, season } of MONTHS) {
    console.log(`Buscando: ${start} (temporada ${season})...`);
    let events;
    try {
      events = await fetchEventIds(start, end);
    } catch (e) {
      console.error(`Erro ao buscar IDs ${start}:`, e.message);
      continue;
    }

    console.log(`  ${events.length} jogos completos`);

    for (const event of events) {
      try {
        const teams = await fetchBoxScore(event.id);
        totalBoxScores++;

        for (const team of teams) {
          // Determina se esse time jogou em casa ou fora
          const teamName = team.team?.displayName;
          const location = teamName === event.homeTeam ? 'home' : 'away';
          const gameType = event.seasonType;

          const group = team.statistics?.[0];
          if (!group) continue;

          const labels = group.labels || [];
          const idxMin = labels.indexOf('MIN');
          const idxPts = labels.indexOf('PTS');
          const idxReb = labels.indexOf('REB');
          const idxAst = labels.indexOf('AST');
          const idxStl = labels.indexOf('STL');
          const idxPf = labels.indexOf('PF');
          const idxThree = labels.indexOf('3PT');

          for (const athlete of group.athletes || []) {
            const stats = athlete.stats || [];
            const min = parseFloat(stats[idxMin]) || 0;
            if (min < 5) continue;

            const name = athlete.athlete?.displayName;
            if (!name) continue;

            const parseThrees = str => {
              if (!str) return 0;
              return parseFloat(str.split('-')[0]) || 0;
            };

            const ctx = ensurePath(raw, name, season, gameType, location);
            ctx.games++;
            ctx.points.push(parseFloat(stats[idxPts]) || 0);
            ctx.rebounds.push(parseFloat(stats[idxReb]) || 0);
            ctx.assists.push(parseFloat(stats[idxAst]) || 0);
            ctx.steals.push(parseFloat(stats[idxStl]) || 0);
            ctx.fouls.push(parseFloat(stats[idxPf]) || 0);
            ctx.threes.push(parseThrees(stats[idxThree]));
          }
        }
      } catch {
        // box score indisponível
      }
      await sleep(100);
    }
  }

  // Filtra jogadores com menos de 10 jogos no total
  const playerStats = {};
  for (const [name, seasons] of Object.entries(raw)) {
    let totalGames = 0;
    for (const seasonData of Object.values(seasons)) {
      for (const gameTypeData of Object.values(seasonData)) {
        totalGames += (gameTypeData.home?.games || 0) + (gameTypeData.away?.games || 0);
      }
    }
    if (totalGames < 10) continue;
    playerStats[name] = seasons;
  }

  if (Object.keys(playerStats).length === 0) {
    console.error('ERRO: nenhum jogador processado.');
    return;
  }

  fs.writeFileSync('nba_player_stats.json', JSON.stringify(playerStats, null, 2));
  console.log(`Stats salvos: ${Object.keys(playerStats).length} jogadores, ${totalBoxScores} box scores processados.`);
}

getPlayerStats();
