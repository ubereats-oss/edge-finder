const axios = require('axios');
const fs = require('fs');

const MONTHS = [
  // Temporada 2023
  { start: '20230401', end: '20230430', season: 2023 },
  { start: '20230501', end: '20230531', season: 2023 },
  { start: '20230601', end: '20230630', season: 2023 },
  { start: '20230701', end: '20230731', season: 2023 },
  { start: '20230801', end: '20230831', season: 2023 },
  { start: '20230901', end: '20230930', season: 2023 },
  { start: '20231001', end: '20231031', season: 2023 },
  { start: '20231101', end: '20231130', season: 2023 },
  // Temporada 2024
  { start: '20240401', end: '20240430', season: 2024 },
  { start: '20240501', end: '20240531', season: 2024 },
  { start: '20240601', end: '20240630', season: 2024 },
  { start: '20240701', end: '20240731', season: 2024 },
  { start: '20240801', end: '20240831', season: 2024 },
  { start: '20240901', end: '20240930', season: 2024 },
  { start: '20241001', end: '20241031', season: 2024 },
  { start: '20241101', end: '20241130', season: 2024 },
  // Temporada 2025
  { start: '20250401', end: '20250430', season: 2025 },
  { start: '20250501', end: '20250531', season: 2025 },
  { start: '20250601', end: '20250630', season: 2025 },
  { start: '20250701', end: '20250731', season: 2025 },
  { start: '20250801', end: '20250831', season: 2025 },
  { start: '20250901', end: '20250930', season: 2025 },
  { start: '20251001', end: '20251031', season: 2025 },
  { start: '20251101', end: '20251130', season: 2025 },
  // Temporada 2026 (em andamento)
  { start: '20260401', end: '20260430', season: 2026 },
];

const SEASON_WEIGHT = { 2023: 1, 2024: 2, 2025: 3, 2026: 4 };
const BATTER_STAT_KEYS = ['hits', 'homeRuns'];
const PITCHER_STAT_KEYS = ['strikeouts', 'hitsAllowed'];

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function emptyContext(keys) {
  const obj = { games: 0 };
  for (const k of keys) obj[k] = [];
  return obj;
}

function ensurePath(raw, name, season, gameType, location, keys) {
  if (!raw[name]) raw[name] = {};
  if (!raw[name][season]) raw[name][season] = {};
  if (!raw[name][season][gameType]) {
    raw[name][season][gameType] = {
      home: emptyContext(keys),
      away: emptyContext(keys),
    };
  }
  return raw[name][season][gameType][location];
}

function ensureTeamPath(teamRaw, name, season, gameType, location) {
  if (!teamRaw[name]) teamRaw[name] = {};
  if (!teamRaw[name][season]) teamRaw[name][season] = {};
  if (!teamRaw[name][season][gameType]) {
    teamRaw[name][season][gameType] = {
      home: { runs: [], runsAllowed: [] },
      away: { runs: [], runsAllowed: [] },
    };
  }
  return teamRaw[name][season][gameType][location];
}

async function fetchEventIds(start, end) {
  const url = `https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard?limit=200&dates=${start}-${end}`;
  const res = await axios.get(url);
  return (res.data.events || [])
    .filter(e => e.competitions[0].status.type.completed)
    .map(e => {
      const comp = e.competitions[0];
      const home = comp.competitors.find(c => c.homeAway === 'home');
      const away = comp.competitors.find(c => c.homeAway === 'away');
      return {
        id: e.id,
        season: e.season?.year,
        seasonType: e.season?.type === 3 ? 'playoffs' : 'regular',
        homeTeam: home?.team?.displayName,
        awayTeam: away?.team?.displayName,
        homeScore: parseInt(home?.score) || 0,
        awayScore: parseInt(away?.score) || 0,
      };
    });
}

async function fetchBoxScore(eventId) {
  const url = `https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/summary?event=${eventId}`;
  const res = await axios.get(url);
  return res.data.boxscore?.players || [];
}

async function getMlbScores() {
  const batterRaw = {};
  const pitcherRaw = {};
  const teamRaw = {};
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
        // Team rating — usando scores do scoreboard diretamente
        if (event.homeTeam && event.awayTeam && (event.homeScore || event.awayScore)) {
          const homeCtx = ensureTeamPath(teamRaw, event.homeTeam, event.season, event.seasonType, 'home');
          homeCtx.runs.push(event.homeScore);
          homeCtx.runsAllowed.push(event.awayScore);

          const awayCtx = ensureTeamPath(teamRaw, event.awayTeam, event.season, event.seasonType, 'away');
          awayCtx.runs.push(event.awayScore);
          awayCtx.runsAllowed.push(event.homeScore);
        }

        // Box score para stats de jogadores
        const teams = await fetchBoxScore(event.id);
        totalBoxScores++;

        for (const team of teams) {
          const teamName = team.team?.displayName;
          if (!teamName) continue;
          const location = teamName === event.homeTeam ? 'home' : 'away';

          const batting = team.statistics?.find(s => s.type === 'batting');
          if (batting) {
            const labels = batting.labels || [];
            const idxH = labels.indexOf('H');
            const idxHR = labels.indexOf('HR');
            const idxAB = labels.indexOf('AB');

            for (const athlete of batting.athletes || []) {
              const stats = athlete.stats || [];
              const ab = parseFloat(stats[idxAB]) || 0;
              if (ab < 1) continue;

              const name = athlete.athlete?.displayName;
              if (!name) continue;

              const ctx = ensurePath(batterRaw, name, event.season, event.seasonType, location, BATTER_STAT_KEYS);
              ctx.games++;
              ctx.hits.push(parseFloat(stats[idxH]) || 0);
              ctx.homeRuns.push(parseFloat(stats[idxHR]) || 0);
            }
          }

          const pitching = team.statistics?.find(s => s.type === 'pitching');
          if (pitching) {
            const labels = pitching.labels || [];
            const idxK = labels.indexOf('K');
            const idxH = labels.indexOf('H');
            const idxIP = labels.indexOf('IP');

            for (const athlete of pitching.athletes || []) {
              if (!athlete.starter) continue;
              const stats = athlete.stats || [];
              const ip = parseFloat(stats[idxIP]) || 0;
              if (ip < 1) continue;

              const name = athlete.athlete?.displayName;
              if (!name) continue;

              const ctx = ensurePath(pitcherRaw, name, event.season, event.seasonType, location, PITCHER_STAT_KEYS);
              ctx.games++;
              ctx.strikeouts.push(parseFloat(stats[idxK]) || 0);
              ctx.hitsAllowed.push(parseFloat(stats[idxH]) || 0);
            }
          }
        }
      } catch {
        // box score indisponível
      }
      await sleep(100);
    }
  }

  // Filtra mínimo de jogos
  function filterMin(raw, minGames) {
    const result = {};
    for (const [name, seasons] of Object.entries(raw)) {
      let total = 0;
      for (const seasonData of Object.values(seasons)) {
        for (const gameTypeData of Object.values(seasonData)) {
          total += (gameTypeData.home?.games || 0) + (gameTypeData.away?.games || 0);
        }
      }
      if (total >= minGames) result[name] = seasons;
    }
    return result;
  }

  // Team rating ponderado
  const teamRating = {};
  for (const [team, seasons] of Object.entries(teamRaw)) {
    teamRating[team] = {};
    for (const [season, data] of Object.entries(seasons)) {
      teamRating[team][season] = {};
      for (const [gameType, locations] of Object.entries(data)) {
        teamRating[team][season][gameType] = {};
        for (const [loc, vals] of Object.entries(locations)) {
          if (!vals.runs || vals.runs.length < 3) continue;
          const avgRuns = vals.runs.reduce((s, v) => s + v, 0) / vals.runs.length;
          const avgAllowed = vals.runsAllowed.reduce((s, v) => s + v, 0) / vals.runsAllowed.length;
          teamRating[team][season][gameType][loc] = parseFloat((avgRuns - avgAllowed).toFixed(3));
        }
      }
    }
  }

  const batterStats = filterMin(batterRaw, 10);
  const pitcherStats = filterMin(pitcherRaw, 5);

  fs.writeFileSync('mlb_batter_stats.json', JSON.stringify(batterStats, null, 2));
  fs.writeFileSync('mlb_pitcher_stats.json', JSON.stringify(pitcherStats, null, 2));
  fs.writeFileSync('mlb_team_rating.json', JSON.stringify(teamRating, null, 2));

  console.log(`MLB salvo: ${Object.keys(batterStats).length} batters, ${Object.keys(pitcherStats).length} pitchers, ${Object.keys(teamRating).length} times. ${totalBoxScores} box scores processados.`);
}

getMlbScores();
