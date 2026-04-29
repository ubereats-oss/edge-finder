const axios = require('axios');
const fs = require('fs');

const FULL_MONTHS = [
  { start: '20231001', end: '20231031', season: 2024 },
  { start: '20231101', end: '20231130', season: 2024 },
  { start: '20231201', end: '20231231', season: 2024 },
  { start: '20240101', end: '20240131', season: 2024 },
  { start: '20240201', end: '20240229', season: 2024 },
  { start: '20240301', end: '20240331', season: 2024 },
  { start: '20240401', end: '20240430', season: 2024 },
  { start: '20240501', end: '20240531', season: 2024 },
  { start: '20240601', end: '20240630', season: 2024 },
  { start: '20241001', end: '20241031', season: 2025 },
  { start: '20241101', end: '20241130', season: 2025 },
  { start: '20241201', end: '20241231', season: 2025 },
  { start: '20250101', end: '20250131', season: 2025 },
  { start: '20250201', end: '20250228', season: 2025 },
  { start: '20250301', end: '20250331', season: 2025 },
  { start: '20250401', end: '20250430', season: 2025 },
  { start: '20250501', end: '20250531', season: 2025 },
  { start: '20251001', end: '20251031', season: 2026 },
  { start: '20251101', end: '20251130', season: 2026 },
  { start: '20251201', end: '20251231', season: 2026 },
  { start: '20260101', end: '20260131', season: 2026 },
  { start: '20260201', end: '20260228', season: 2026 },
  { start: '20260301', end: '20260331', season: 2026 },
  { start: '20260401', end: '20260430', season: 2026 },
];

const STAT_KEYS = ['goals', 'assists', 'points', 'shots', 'blocked'];
const MIN_TOI_SECONDS = 300;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function parseToi(toi) {
  if (!toi) return 0;
  const parts = String(toi).split(':');
  if (parts.length === 2) return parseInt(parts[0]) * 60 + parseInt(parts[1]);
  return 0;
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
  const end = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const year = parseInt(start.slice(0, 4));
  const month = parseInt(start.slice(4, 6));
  const season = month >= 10 ? year + 1 : year;
  return [{ start, end, season }];
}

async function fetchEventIds(start, end) {
  const url = `https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/scoreboard?limit=200&dates=${start}-${end}`;
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
        id: e.id,
        date: e.date,
        seasonType: e.season?.type === 3 ? 'playoffs' : 'regular',
        season: e.season?.year,
        homeTeam: home?.team?.displayName,
        awayTeam: away?.team?.displayName,
        homeScore,
        awayScore,
        blowout: Math.abs(homeScore - awayScore) >= 4,
        homeWon: home?.winner === true,
      };
    });
}

async function fetchBoxScore(eventId) {
  const url = `https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/summary?event=${eventId}`;
  const res = await axios.get(url);
  return res.data.boxscore?.players || [];
}

async function processEvents(allEvents, raw) {
  let total = 0;

  for (const event of allEvents) {
    const season = event._season;
    try {
      const teams = await fetchBoxScore(event.id);
      total++;

      for (const team of teams) {
        const teamName = team.team?.displayName;
        if (!teamName) continue;
        const isHome = teamName === event.homeTeam;
        const location = isHome ? 'home' : 'away';
        const opponent = isHome ? event.awayTeam : event.homeTeam;
        const won = isHome ? event.homeWon : !event.homeWon;
        const teamScore = isHome ? event.homeScore : event.awayScore;
        const oppScore = isHome ? event.awayScore : event.homeScore;

        const group = team.statistics?.[0];
        if (!group) continue;

        const labels = group.labels || [];
        const idxToi = labels.findIndex(l => l.toUpperCase() === 'TOI');
        const idxG   = labels.findIndex(l => l.toUpperCase() === 'G');
        const idxA   = labels.findIndex(l => l.toUpperCase() === 'A');
        const idxPts = labels.findIndex(l => l.toUpperCase() === 'PTS');
        const idxS   = labels.findIndex(l => l.toUpperCase() === 'SOG' || l.toUpperCase() === 'S');
        const idxBs  = labels.findIndex(l => l.toUpperCase() === 'BS' || l.toUpperCase() === 'BLK');

        for (const athlete of group.athletes || []) {
          const stats = athlete.stats || [];
          const toiSecs = parseToi(stats[idxToi]);
          if (toiSecs < MIN_TOI_SECONDS) continue;

          const name = athlete.athlete?.displayName;
          if (!name) continue;

          const ctx = ensurePath(raw, name, season, event.seasonType, location);
          const alreadyExists = ctx.goals.some(e => e.date === event.date && e.opponent === opponent);
          if (alreadyExists) continue;

          ctx.games++;

          const meta = {
            date: event.date,
            toiSeconds: toiSecs,
            blowout: event.blowout,
            won,
            teamScore,
            oppScore,
            opponent,
            _team: teamName,
            _eventDate: event.date,
          };

          const mkEntry = v => ({ ...meta, value: v });
          const gv = parseInt(stats[idxG]) || 0;
          const av = parseInt(stats[idxA]) || 0;

          ctx.goals.push(mkEntry(gv));
          ctx.assists.push(mkEntry(av));
          ctx.points.push(mkEntry(gv + av));
          ctx.shots.push(mkEntry(parseInt(stats[idxS]) || 0));
          ctx.blocked.push(mkEntry(parseInt(stats[idxBs]) || 0));
        }
      }
    } catch {
      // box score indisponível
    }
    await sleep(120);
  }

  return total;
}

function stripInternalFields(raw) {
  for (const playerData of Object.values(raw)) {
    for (const seasonData of Object.values(playerData)) {
      for (const gameTypeData of Object.values(seasonData)) {
        for (const loc of ['home', 'away']) {
          const ctx = gameTypeData[loc];
          if (!ctx) continue;
          for (const statKey of STAT_KEYS) {
            ctx[statKey] = (ctx[statKey] || []).map(({ _team, _eventDate, ...rest }) => rest);
          }
        }
      }
    }
  }
}

async function getPlayerStats() {
  let existing = {};
  if (fs.existsSync('nhl_player_stats.json')) {
    try {
      existing = JSON.parse(fs.readFileSync('nhl_player_stats.json', 'utf-8'));
      console.log(`Stats NHL existentes: ${Object.keys(existing).length} jogadores.`);
    } catch {
      console.warn('nhl_player_stats.json inválido — iniciando do zero.');
    }
  }

  const lastDate = getLastProcessedDate(existing);
  let months;

  if (lastDate) {
    console.log(`Última data: ${lastDate}`);
    months = getIncrementalRange(lastDate);
    console.log(`Incremental: ${months[0].start} → ${months[0].end}`);
  } else {
    console.log('Histórico completo...');
    months = FULL_MONTHS;
  }

  const allEvents = [];
  for (const { start, end, season } of months) {
    console.log(`Buscando ${start}–${end} (temporada ${season})...`);
    try {
      const events = await fetchEventIds(start, end);
      for (const ev of events) ev._season = season;
      allEvents.push(...events);
      console.log(`  ${events.length} jogos`);
    } catch (e) {
      console.error(`Erro ${start}:`, e.message);
    }
  }

  allEvents.sort((a, b) => new Date(a.date) - new Date(b.date));
  console.log(`Total: ${allEvents.length} jogos`);

  if (!allEvents.length) {
    console.log('Nenhum jogo novo. Stats já atualizados.');
    return;
  }

  const total = await processEvents(allEvents, existing);
  console.log(`${total} box scores processados.`);
  stripInternalFields(existing);

  const playerStats = {};
  for (const [name, seasons] of Object.entries(existing)) {
    let totalGames = 0;
    for (const seasonData of Object.values(seasons)) {
      for (const gameTypeData of Object.values(seasonData)) {
        totalGames += (gameTypeData.home?.games || 0) + (gameTypeData.away?.games || 0);
      }
    }
    if (totalGames < 8) continue;
    playerStats[name] = seasons;
  }

  fs.writeFileSync('nhl_player_stats.json', JSON.stringify(playerStats, null, 2));
  console.log(`Stats NHL salvos: ${Object.keys(playerStats).length} jogadores.`);
}

getPlayerStats();
