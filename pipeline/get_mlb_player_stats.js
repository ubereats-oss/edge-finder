const axios = require('axios');
const fs = require('fs');

const FULL_MONTHS = [
  { start: '20230323', end: '20230331', season: 2023 },
  { start: '20230401', end: '20230430', season: 2023 },
  { start: '20230501', end: '20230531', season: 2023 },
  { start: '20230601', end: '20230630', season: 2023 },
  { start: '20230701', end: '20230731', season: 2023 },
  { start: '20230801', end: '20230831', season: 2023 },
  { start: '20230901', end: '20230930', season: 2023 },
  { start: '20231001', end: '20231031', season: 2023 },
  { start: '20240320', end: '20240331', season: 2024 },
  { start: '20240401', end: '20240430', season: 2024 },
  { start: '20240501', end: '20240531', season: 2024 },
  { start: '20240601', end: '20240630', season: 2024 },
  { start: '20240701', end: '20240731', season: 2024 },
  { start: '20240801', end: '20240831', season: 2024 },
  { start: '20240901', end: '20240930', season: 2024 },
  { start: '20241001', end: '20241031', season: 2024 },
  { start: '20250318', end: '20250331', season: 2025 },
  { start: '20250401', end: '20250430', season: 2025 },
  { start: '20250501', end: '20250531', season: 2025 },
  { start: '20250601', end: '20250630', season: 2025 },
  { start: '20250701', end: '20250731', season: 2025 },
  { start: '20250801', end: '20250831', season: 2025 },
  { start: '20250901', end: '20250930', season: 2025 },
  { start: '20251001', end: '20251031', season: 2025 },
  { start: '20260319', end: '20260331', season: 2026 },
  { start: '20260401', end: '20260430', season: 2026 },
  { start: '20260501', end: '20260531', season: 2026 },
  { start: '20260601', end: '20260630', season: 2026 },
  { start: '20260701', end: '20260731', season: 2026 },
  { start: '20260801', end: '20260831', season: 2026 },
  { start: '20260901', end: '20260930', season: 2026 },
  { start: '20261001', end: '20261031', season: 2026 },
];

const BATTER_KEYS   = ['hits', 'homeRuns'];
const PITCHER_KEYS  = ['strikeouts', 'hitsAllowed'];
const ALL_STAT_KEYS = [...BATTER_KEYS, ...PITCHER_KEYS];

const MIN_AB_BATTER     = 1;
const MIN_IP_PITCHER    = 1;
const MIN_GAMES_TOTAL   = 5;
const MIN_STARTER_GAMES = 5;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function emptyContext() {
  const obj = { games: 0 };
  for (const k of ALL_STAT_KEYS) obj[k] = [];
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

function getLastProcessedDate(existing) {
  let latest = null;
  for (const playerData of Object.values(existing)) {
    for (const seasonData of Object.values(playerData)) {
      for (const gameTypeData of Object.values(seasonData)) {
        for (const loc of ['home', 'away']) {
          const ctx = gameTypeData[loc];
          if (!ctx) continue;
          for (const entries of Object.values(ctx)) {
            if (!Array.isArray(entries)) continue;
            for (const entry of entries) {
              if (entry.date && (!latest || entry.date > latest)) latest = entry.date;
            }
          }
        }
      }
    }
  }
  return latest;
}

function getIncrementalRange(lastDate) {
  const last = new Date(lastDate);
  last.setDate(last.getDate() - 2);
  const start = last.toISOString().slice(0, 10).replace(/-/g, '');
  const end   = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const season = parseInt(start.slice(0, 4));
  return [{ start, end, season }];
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
      const homeScore = parseInt(home?.score) || 0;
      const awayScore = parseInt(away?.score) || 0;
      return {
        id: e.id, date: e.date,
        seasonType: e.season?.type === 3 ? 'playoffs' : 'regular',
        season: e.season?.year,
        homeTeam: home?.team?.displayName,
        awayTeam: away?.team?.displayName,
        homeScore, awayScore,
        blowout: Math.abs(homeScore - awayScore) >= 7,
        isExtraInnings: (comp.linescores?.length || 9) > 9,
        homeWon: home?.winner === true,
      };
    });
}

async function fetchBoxScore(eventId) {
  const url = `https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/summary?event=${eventId}`;
  const res = await axios.get(url);
  return res.data.boxscore?.players || [];
}

async function processEvents(allEvents, raw, teamGameDates) {
  let totalBoxScores = 0;
  for (const event of allEvents) {
    const season = event._season;
    try {
      const teams = await fetchBoxScore(event.id);
      totalBoxScores++;

      const isBackToBack = {};
      for (const teamName of [event.homeTeam, event.awayTeam]) {
        if (!teamName) continue;
        if (!teamGameDates[teamName]) teamGameDates[teamName] = [];
        const prev = teamGameDates[teamName];
        isBackToBack[teamName] = prev.length > 0
          ? (new Date(event.date) - new Date(prev[prev.length - 1])) / 86400000 <= 1
          : false;
        teamGameDates[teamName].push(event.date);
      }

      for (const team of teams) {
        const teamName = team.team?.displayName;
        if (!teamName) continue;
        const isHome    = teamName === event.homeTeam;
        const location  = isHome ? 'home' : 'away';
        const gameType  = event.seasonType;
        const opponent  = isHome ? event.awayTeam : event.homeTeam;
        const won       = isHome ? event.homeWon : !event.homeWon;
        const teamScore = isHome ? event.homeScore : event.awayScore;
        const oppScore  = isHome ? event.awayScore : event.homeScore;

        for (const group of team.statistics || []) {
          const labels = group.labels || [];
          // Identificadores exclusivos: AB → batedores, IP → pitchers
          const isBatterGroup  = labels.includes('AB');
          const isPitcherGroup = labels.includes('IP');
          if (!isBatterGroup && !isPitcherGroup) continue;

          const idxAB = labels.indexOf('AB');
          const idxH  = labels.indexOf('H');
          const idxHR = labels.indexOf('HR');
          const idxIP = labels.indexOf('IP');
          const idxSO = labels.indexOf('K') !== -1 ? labels.indexOf('K') : labels.indexOf('SO');

          for (const athlete of group.athletes || []) {
            const name = athlete.athlete?.displayName;
            if (!name) continue;
            const stats = athlete.stats || [];
            const meta = {
              date: event.date, isBackToBack: isBackToBack[teamName] || false,
              blowout: event.blowout, isExtraInnings: event.isExtraInnings,
              won, teamScore, oppScore, opponent,
              _team: teamName, _eventDate: event.date, absentStarters: [],
            };

            if (isBatterGroup) {
              const ab = parseFloat(stats[idxAB]) || 0;
              if (ab < MIN_AB_BATTER) continue;
              const ctx = ensurePath(raw, name, season, gameType, location);
              if (ctx.hits.some(e => e.date === event.date && e.opponent === opponent)) continue;
              ctx.games++;
              ctx.hits.push({ ...meta, value: parseFloat(stats[idxH]) || 0 });
              ctx.homeRuns.push({ ...meta, value: parseFloat(stats[idxHR]) || 0 });

            } else if (isPitcherGroup) {
              const ip = parseFloat(stats[idxIP]) || 0;
              if (ip < MIN_IP_PITCHER) continue;
              const ctx = ensurePath(raw, name, season, gameType, location);
              if (ctx.strikeouts.some(e => e.date === event.date && e.opponent === opponent)) continue;
              ctx.games++;
              ctx.strikeouts.push({ ...meta, value: parseFloat(stats[idxSO]) || 0 });
              ctx.hitsAllowed.push({ ...meta, value: parseFloat(stats[idxH]) || 0 });
            }
          }
        }
      }
    } catch { /* box score indisponível */ }
    await sleep(150);
    if (totalBoxScores % 100 === 0 && totalBoxScores > 0)
      console.log(`  ${totalBoxScores} box scores processados...`);
  }
  return totalBoxScores;
}

function recalculateAbsents(raw) {
  const habituais = {};
  for (const [playerName, playerData] of Object.entries(raw)) {
    for (const [seasonStr, seasonData] of Object.entries(playerData)) {
      const season = parseInt(seasonStr);
      for (const gameType of ['regular', 'playoffs']) {
        for (const loc of ['home', 'away']) {
          const ctx = seasonData[gameType]?.[loc];
          if (!ctx) continue;
          const refKey = (ctx.hits || []).length > 0 ? 'hits' : 'strikeouts';
          for (const entry of ctx[refKey] || []) {
            const team = entry._team;
            if (!team) continue;
            if (!habituais[team]) habituais[team] = {};
            if (!habituais[team][season]) habituais[team][season] = {};
            if (!habituais[team][season][playerName]) habituais[team][season][playerName] = { total: 0 };
            habituais[team][season][playerName].total++;
          }
        }
      }
    }
  }

  const starterSets = {};
  for (const [team, seasons] of Object.entries(habituais)) {
    starterSets[team] = {};
    for (const [season, players] of Object.entries(seasons)) {
      starterSets[team][season] = new Set();
      for (const [player, counts] of Object.entries(players)) {
        if (counts.total >= MIN_STARTER_GAMES) starterSets[team][season].add(player);
      }
    }
  }

  const presentMap = {};
  for (const [playerName, playerData] of Object.entries(raw)) {
    for (const seasonData of Object.values(playerData)) {
      for (const gameType of ['regular', 'playoffs']) {
        for (const loc of ['home', 'away']) {
          const ctx = seasonData[gameType]?.[loc];
          if (!ctx) continue;
          const refKey = (ctx.hits || []).length > 0 ? 'hits' : 'strikeouts';
          for (const entry of ctx[refKey] || []) {
            const key = `${entry._eventDate}|${entry._team}`;
            if (!presentMap[key]) presentMap[key] = new Set();
            presentMap[key].add(playerName);
          }
        }
      }
    }
  }

  for (const [, playerData] of Object.entries(raw)) {
    for (const [seasonStr, seasonData] of Object.entries(playerData)) {
      const season = parseInt(seasonStr);
      for (const gameType of ['regular', 'playoffs']) {
        for (const loc of ['home', 'away']) {
          const ctx = seasonData[gameType]?.[loc];
          if (!ctx) continue;
          for (const statKey of ALL_STAT_KEYS) {
            for (const entry of ctx[statKey] || []) {
              const key = `${entry._eventDate}|${entry._team}`;
              const present  = presentMap[key] || new Set();
              const starters = starterSets[entry._team]?.[season] || new Set();
              entry.absentStarters = [...starters].filter(s => !present.has(s));
            }
          }
        }
      }
    }
  }
}

function buildTeamRatings(raw) {
  const ratings = {};
  for (const [, playerData] of Object.entries(raw)) {
    for (const [seasonStr, seasonData] of Object.entries(playerData)) {
      const season = parseInt(seasonStr);
      for (const loc of ['home', 'away']) {
        const ctx = seasonData.regular?.[loc];
        if (!ctx) continue;
        const refKey = (ctx.hits || []).length > 0 ? 'hits' : 'strikeouts';
        for (const entry of ctx[refKey] || []) {
          if (!entry._team || !entry.date) continue;
          const team    = entry._team;
          const gameKey = `${entry.date}|${entry.opponent}|${loc}`;
          if (!ratings[team]) ratings[team] = {};
          if (!ratings[team][season]) ratings[team][season] = { regular: {} };
          if (!ratings[team][season].regular[loc])
            ratings[team][season].regular[loc] = { wins: 0, games: new Set() };
          const bucket = ratings[team][season].regular[loc];
          if (!bucket.games.has(gameKey)) {
            bucket.games.add(gameKey);
            if (entry.won) bucket.wins++;
          }
        }
      }
    }
  }

  const teamRating = {};
  for (const [team, seasons] of Object.entries(ratings)) {
    teamRating[team] = {};
    for (const [season, seasonData] of Object.entries(seasons)) {
      teamRating[team][season] = { regular: {} };
      for (const loc of ['home', 'away']) {
        const bucket = seasonData.regular?.[loc];
        if (!bucket || bucket.games.size < 5) continue;
        teamRating[team][season].regular[loc] =
          parseFloat((bucket.wins / bucket.games.size).toFixed(4));
      }
    }
  }

  fs.writeFileSync('mlb_team_rating.json', JSON.stringify(teamRating, null, 2));
  console.log(`mlb_team_rating.json salvo: ${Object.keys(teamRating).length} times.`);
}

function stripInternalFields(raw) {
  for (const playerData of Object.values(raw)) {
    for (const seasonData of Object.values(playerData)) {
      for (const gameTypeData of Object.values(seasonData)) {
        for (const loc of ['home', 'away']) {
          const ctx = gameTypeData[loc];
          if (!ctx) continue;
          for (const statKey of ALL_STAT_KEYS) {
            ctx[statKey] = (ctx[statKey] || []).map(({ _team, _eventDate, ...rest }) => rest);
          }
        }
      }
    }
  }
}

async function getMlbPlayerStats() {
  let existing = {};
  if (fs.existsSync('mlb_player_stats.json')) {
    try {
      existing = JSON.parse(fs.readFileSync('mlb_player_stats.json', 'utf-8'));
      console.log(`Stats existentes carregados: ${Object.keys(existing).length} jogadores.`);
    } catch {
      console.warn('mlb_player_stats.json inválido — iniciando do zero.');
    }
  }

  const lastDate = getLastProcessedDate(existing);
  let months;

  if (lastDate) {
    console.log(`Última data processada: ${lastDate}`);
    months = getIncrementalRange(lastDate);
    console.log(`Modo incremental: buscando de ${months[0].start} até ${months[0].end}`);
  } else {
    console.log('Nenhum dado existente — processando histórico completo.');
    months = FULL_MONTHS;
  }

  const allEvents = [];
  for (const { start, end, season } of months) {
    console.log(`Buscando eventos: ${start}–${end} (temporada ${season})...`);
    try {
      const events = await fetchEventIds(start, end);
      for (const ev of events) ev._season = season;
      allEvents.push(...events);
      console.log(`  ${events.length} jogos completos`);
    } catch (e) {
      console.error(`Erro ao buscar IDs ${start}:`, e.message);
    }
    await sleep(200);
  }

  allEvents.sort((a, b) => new Date(a.date) - new Date(b.date));
  console.log(`Total de jogos a processar: ${allEvents.length}`);

  if (!allEvents.length) {
    console.log('Nenhum jogo novo encontrado. Stats já atualizados.');
    return;
  }

  const teamGameDates = {};
  for (const playerData of Object.values(existing)) {
    for (const seasonData of Object.values(playerData)) {
      for (const gameTypeData of Object.values(seasonData)) {
        for (const loc of ['home', 'away']) {
          const ctx = gameTypeData[loc];
          if (!ctx) continue;
          const refKey = (ctx.hits || []).length > 0 ? 'hits' : 'strikeouts';
          for (const entry of ctx[refKey] || []) {
            if (!entry._team || !entry.date) continue;
            if (!teamGameDates[entry._team]) teamGameDates[entry._team] = [];
            if (!teamGameDates[entry._team].includes(entry.date))
              teamGameDates[entry._team].push(entry.date);
          }
        }
      }
    }
  }
  for (const dates of Object.values(teamGameDates)) dates.sort();

  const totalBoxScores = await processEvents(allEvents, existing, teamGameDates);

  console.log(`${totalBoxScores} box scores processados. Recalculando ausentes...`);
  recalculateAbsents(existing);
  buildTeamRatings(existing);
  stripInternalFields(existing);

  const playerStats = {};
  for (const [name, seasons] of Object.entries(existing)) {
    let totalGames = 0;
    for (const seasonData of Object.values(seasons)) {
      for (const gameTypeData of Object.values(seasonData)) {
        totalGames += (gameTypeData.home?.games || 0) + (gameTypeData.away?.games || 0);
      }
    }
    if (totalGames < MIN_GAMES_TOTAL) continue;
    playerStats[name] = seasons;
  }

  if (!Object.keys(playerStats).length) {
    console.error('ERRO: nenhum jogador processado.');
    return;
  }

  fs.writeFileSync('mlb_player_stats.json', JSON.stringify(playerStats, null, 2));
  console.log(`Stats salvos: ${Object.keys(playerStats).length} jogadores, ${totalBoxScores} novos box scores.`);
}

getMlbPlayerStats();
