const axios = require('axios');
const fs = require('fs');

const FULL_MONTHS = [
  { start: '20230901', end: '20230930', season: 2024 },
  { start: '20231001', end: '20231031', season: 2024 },
  { start: '20231101', end: '20231130', season: 2024 },
  { start: '20231201', end: '20231231', season: 2024 },
  { start: '20240101', end: '20240131', season: 2024 },
  { start: '20240201', end: '20240229', season: 2024 },
  { start: '20240901', end: '20240930', season: 2025 },
  { start: '20241001', end: '20241031', season: 2025 },
  { start: '20241101', end: '20241130', season: 2025 },
  { start: '20241201', end: '20241231', season: 2025 },
  { start: '20250101', end: '20250131', season: 2025 },
  { start: '20250201', end: '20250228', season: 2025 },
  { start: '20250901', end: '20250930', season: 2026 },
  { start: '20251001', end: '20251031', season: 2026 },
  { start: '20251101', end: '20251130', season: 2026 },
  { start: '20251201', end: '20251231', season: 2026 },
  { start: '20260101', end: '20260131', season: 2026 },
  { start: '20260201', end: '20260228', season: 2026 },
];

const STAT_KEYS = ['passYards', 'passTDs', 'rushYards', 'receptions', 'receptionYards', 'fantasyPoints'];

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
  const season = month >= 9 ? year + 1 : year;
  return [{ start, end, season }];
}

async function fetchEventIds(start, end) {
  const url = `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?limit=200&dates=${start}-${end}`;
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
        blowout: Math.abs(homeScore - awayScore) >= 21,
        homeWon: home?.winner === true,
      };
    });
}

async function fetchBoxScore(eventId) {
  const url = `https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=${eventId}`;
  const res = await axios.get(url);
  return res.data.boxscore?.players || [];
}

function calcFantasy(pYds, pTds, ints, ruYds, ruTds, recs, reYds, reTds) {
  return pYds / 25 + pTds * 4 - ints * 2 +
    ruYds / 10 + ruTds * 6 +
    recs * 0.5 + reYds / 10 + reTds * 6;
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

        const playerMap = {};

        for (const group of team.statistics || []) {
          const labels = (group.labels || []).map(l => l.toUpperCase());
          const isPassing   = labels.includes('INT') && labels.includes('YDS') && (labels.includes('C/ATT') || labels.includes('COMP'));
          const isRushing   = labels.includes('CAR') && labels.includes('YDS') && !labels.includes('REC');
          const isReceiving = labels.includes('REC') && labels.includes('YDS');

          if (!isPassing && !isRushing && !isReceiving) continue;

          const idxYds = labels.indexOf('YDS');
          const idxTd  = labels.indexOf('TD');
          const idxRec = labels.indexOf('REC');
          const idxInt = labels.indexOf('INT');

          for (const athlete of group.athletes || []) {
            const name = athlete.athlete?.displayName;
            if (!name) continue;
            if (!playerMap[name]) playerMap[name] = { passYards: 0, passTDs: 0, ints: 0, rushYards: 0, rushTDs: 0, receptions: 0, receptionYards: 0, receptionTDs: 0 };

            const stats = athlete.stats || [];
            const yds = parseFloat(stats[idxYds]) || 0;
            const td  = parseInt(stats[idxTd]) || 0;
            const rec = parseInt(stats[idxRec]) || 0;
            const int = parseInt(stats[idxInt]) || 0;

            if (isPassing) {
              playerMap[name].passYards += yds;
              playerMap[name].passTDs   += td;
              playerMap[name].ints      += int;
            } else if (isRushing) {
              playerMap[name].rushYards += yds;
              playerMap[name].rushTDs   += td;
            } else if (isReceiving) {
              playerMap[name].receptions     += rec;
              playerMap[name].receptionYards += yds;
              playerMap[name].receptionTDs   += td;
            }
          }
        }

        for (const [name, s] of Object.entries(playerMap)) {
          const hasStats = s.passYards + s.rushYards + s.receptions > 0;
          if (!hasStats) continue;

          const ctx = ensurePath(raw, name, season, event.seasonType, location);
          const alreadyExists = ctx.fantasyPoints.some(e => e.date === event.date && e.opponent === opponent);
          if (alreadyExists) continue;

          ctx.games++;
          const fantasy = parseFloat(calcFantasy(s.passYards, s.passTDs, s.ints, s.rushYards, s.rushTDs, s.receptions, s.receptionYards, s.receptionTDs).toFixed(1));

          const meta = {
            date: event.date,
            blowout: event.blowout,
            won,
            teamScore,
            oppScore,
            opponent,
            _team: teamName,
            _eventDate: event.date,
          };
          const mkEntry = v => ({ ...meta, value: v });

          ctx.passYards.push(mkEntry(s.passYards));
          ctx.passTDs.push(mkEntry(s.passTDs));
          ctx.rushYards.push(mkEntry(s.rushYards));
          ctx.receptions.push(mkEntry(s.receptions));
          ctx.receptionYards.push(mkEntry(s.receptionYards));
          ctx.fantasyPoints.push(mkEntry(fantasy));
        }
      }
    } catch {
      // box score indisponível
    }
    await sleep(50);
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
  if (fs.existsSync('nfl_player_stats.json')) {
    try {
      existing = JSON.parse(fs.readFileSync('nfl_player_stats.json', 'utf-8'));
      console.log(`Stats NFL existentes: ${Object.keys(existing).length} jogadores.`);
    } catch {
      console.warn('nfl_player_stats.json inválido — iniciando do zero.');
    }
  }

  const lastDate = getLastProcessedDate(existing);
  const playerCount = Object.keys(existing).length;
  if (!lastDate && playerCount === 0 && fs.existsSync('nfl_player_stats.json')) {
    console.warn('nfl_player_stats.json presente mas sem dados — pode indicar arquivo corrompido na branch data. Processando histórico completo (pode demorar).');
  }
  let months;

  if (lastDate) {
    console.log(`Última data: ${lastDate}`);
    months = getIncrementalRange(lastDate);
    console.log(`Incremental: ${months[0].start} → ${months[0].end} (range de ${Math.round((new Date(months[0].end) - new Date(months[0].start)) / 86400000)} dias)`);
  } else {
    console.log('Histórico completo NFL...');
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
  console.log(`Total: ${allEvents.length} jogos NFL`);

  if (!allEvents.length) {
    console.log('Nenhum jogo novo.');
    return;
  }

  const total = await processEvents(allEvents, existing);
  console.log(`${total} box scores NFL processados.`);
  stripInternalFields(existing);

  const playerStats = {};
  for (const [name, seasons] of Object.entries(existing)) {
    let totalGames = 0;
    for (const seasonData of Object.values(seasons)) {
      for (const gameTypeData of Object.values(seasonData)) {
        totalGames += (gameTypeData.home?.games || 0) + (gameTypeData.away?.games || 0);
      }
    }
    if (totalGames < 4) continue;
    playerStats[name] = seasons;
  }

  fs.writeFileSync('nfl_player_stats.json', JSON.stringify(playerStats, null, 2));
  console.log(`Stats NFL salvos: ${Object.keys(playerStats).length} jogadores.`);
}

getPlayerStats();
