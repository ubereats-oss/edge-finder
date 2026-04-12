const axios = require('axios');
const fs = require('fs');

// Temporadas conhecidas — usadas apenas na primeira run (histórico completo)
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
  { start: '20250601', end: '20250630', season: 2025 },
  { start: '20251001', end: '20251031', season: 2026 },
  { start: '20251101', end: '20251130', season: 2026 },
  { start: '20251201', end: '20251231', season: 2026 },
  { start: '20260101', end: '20260131', season: 2026 },
  { start: '20260201', end: '20260228', season: 2026 },
  { start: '20260301', end: '20260331', season: 2026 },
  { start: '20260401', end: '20260430', season: 2026 },
];

const STAT_KEYS = ['points', 'rebounds', 'assists', 'steals', 'fouls', 'threes'];
const MIN_MINUTES_STARTER = 20;
const MIN_STARTER_RATE = 0.5;

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

// Retorna a data do jogo mais recente já salvo em todos os jogadores
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
              if (entry.date && (!latest || entry.date > latest)) {
                latest = entry.date;
              }
            }
          }
        }
      }
    }
  }
  return latest; // ISO string ex: "2026-04-11T00:00Z"
}

// Gera o range de datas a buscar a partir do dia seguinte ao último processado
function getIncrementalRange(lastDate) {
  const last = new Date(lastDate);
  // Recomeça 2 dias antes para cobrir jogos que terminaram após meia-noite UTC
  last.setDate(last.getDate() - 2);
  const start = last.toISOString().slice(0, 10).replace(/-/g, '');

  const today = new Date();
  const end = today.toISOString().slice(0, 10).replace(/-/g, '');

  // Detecta a temporada pelo mês/ano
  const year = parseInt(start.slice(0, 4));
  const month = parseInt(start.slice(4, 6));
  const season = month >= 10 ? year + 1 : year;

  return [{ start, end, season }];
}

async function fetchEventIds(start, end) {
  const url = `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?limit=200&dates=${start}-${end}`;
  const res = await axios.get(url);
  return (res.data.events || [])
    .filter(e => e.competitions[0].status.type.completed)
    .map(e => {
      const comp = e.competitions[0];
      const home = comp.competitors.find(c => c.homeAway === 'home');
      const away = comp.competitors.find(c => c.homeAway === 'away');
      const homeScore = parseInt(home?.score) || 0;
      const awayScore = parseInt(away?.score) || 0;
      const periods = comp.linescores?.length || 0;
      return {
        id: e.id,
        date: e.date,
        seasonType: e.season?.type === 3 ? 'playoffs' : 'regular',
        season: e.season?.year,
        homeTeam: home?.team?.displayName,
        awayTeam: away?.team?.displayName,
        homeScore,
        awayScore,
        blowout: Math.abs(homeScore - awayScore) >= 20,
        isOvertime: periods > 4,
        homeWon: home?.winner === true,
      };
    });
}

async function fetchBoxScore(eventId) {
  const url = `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event=${eventId}`;
  const res = await axios.get(url);
  return {
    players: res.data.boxscore?.players || [],
    teamStats: res.data.boxscore?.teams || [],
  };
}

// Processa eventos e acumula em `raw` (pode ser existente ou vazio)
async function processEvents(allEvents, raw, teamGameDates) {
  let totalBoxScores = 0;

  for (const event of allEvents) {
    const season = event._season;
    try {
      const { players: teams, teamStats } = await fetchBoxScore(event.id);
      totalBoxScores++;

      const isBackToBack = {};
      for (const teamName of [event.homeTeam, event.awayTeam]) {
        if (!teamName) continue;
        if (!teamGameDates[teamName]) teamGameDates[teamName] = [];
        const prev = teamGameDates[teamName];
        if (prev.length > 0) {
          const diffDays = (new Date(event.date) - new Date(prev[prev.length - 1])) / 86400000;
          isBackToBack[teamName] = diffDays <= 1;
        } else {
          isBackToBack[teamName] = false;
        }
        teamGameDates[teamName].push(event.date);
      }

      const teamFouls = {};
      for (const ts of teamStats || []) {
        const tName = ts.team?.displayName;
        if (!tName) continue;
        for (const stat of ts.statistics || []) {
          if (stat.name === 'teamFouls' || stat.abbreviation === 'PF') {
            teamFouls[tName] = parseInt(stat.displayValue) || 0;
            break;
          }
        }
      }

      const opponentFouls = {
        [event.homeTeam]: teamFouls[event.awayTeam] || 0,
        [event.awayTeam]: teamFouls[event.homeTeam] || 0,
      };

      for (const team of teams) {
        const teamName = team.team?.displayName;
        if (!teamName) continue;
        const isHome = teamName === event.homeTeam;
        const location = isHome ? 'home' : 'away';
        const gameType = event.seasonType;
        const opponent = isHome ? event.awayTeam : event.homeTeam;
        const won = isHome ? event.homeWon : !event.homeWon;
        const teamScore = isHome ? event.homeScore : event.awayScore;
        const oppScore = isHome ? event.awayScore : event.homeScore;

        const group = team.statistics?.[0];
        if (!group) continue;

        const labels = group.labels || [];
        const idxMin   = labels.indexOf('MIN');
        const idxPts   = labels.indexOf('PTS');
        const idxReb   = labels.indexOf('REB');
        const idxAst   = labels.indexOf('AST');
        const idxStl   = labels.indexOf('STL');
        const idxPf    = labels.indexOf('PF');
        const idxThree = labels.indexOf('3PT');

        const parseThrees = str => {
          if (!str) return 0;
          return parseFloat(str.split('-')[0]) || 0;
        };

        for (const athlete of group.athletes || []) {
          const stats = athlete.stats || [];
          const minutes = parseFloat(stats[idxMin]) || 0;
          if (minutes < 5) continue;

          const name = athlete.athlete?.displayName;
          if (!name) continue;

          // Pula entrada duplicada (jogo já processado)
          const ctx = ensurePath(raw, name, season, gameType, location);
          const alreadyExists = ctx.points.some(e => e.date === event.date && e.opponent === opponent);
          if (alreadyExists) continue;

          ctx.games++;

          const meta = {
            date: event.date,
            minutes,
            isBackToBack: isBackToBack[teamName] || false,
            blowout: event.blowout,
            isOvertime: event.isOvertime,
            won,
            teamScore,
            oppScore,
            opponent,
            opponentFouls: opponentFouls[teamName] || 0,
            _team: teamName,
            _eventDate: event.date,
            absentStarters: [],
          };

          const mkEntry = v => ({ ...meta, value: v });

          ctx.points.push(mkEntry(parseFloat(stats[idxPts]) || 0));
          ctx.rebounds.push(mkEntry(parseFloat(stats[idxReb]) || 0));
          ctx.assists.push(mkEntry(parseFloat(stats[idxAst]) || 0));
          ctx.steals.push(mkEntry(parseFloat(stats[idxStl]) || 0));
          ctx.fouls.push(mkEntry(parseFloat(stats[idxPf]) || 0));
          ctx.threes.push(mkEntry(parseThrees(stats[idxThree])));
        }
      }
    } catch {
      // box score indisponível
    }
    await sleep(100);
  }

  return totalBoxScores;
}

// Recalcula titulares habituais e absentStarters em todo o dataset
function recalculateAbsents(raw) {
  const habituais = {};
  for (const [playerName, playerData] of Object.entries(raw)) {
    for (const [seasonStr, seasonData] of Object.entries(playerData)) {
      const season = parseInt(seasonStr);
      for (const gameType of ['regular', 'playoffs']) {
        for (const loc of ['home', 'away']) {
          const ctx = seasonData[gameType]?.[loc];
          if (!ctx) continue;
          for (const entry of ctx.points) {
            const team = entry._team;
            if (!team) continue;
            if (!habituais[team]) habituais[team] = {};
            if (!habituais[team][season]) habituais[team][season] = {};
            if (!habituais[team][season][playerName]) {
              habituais[team][season][playerName] = { total: 0, starter: 0 };
            }
            habituais[team][season][playerName].total++;
            if (entry.minutes >= MIN_MINUTES_STARTER) {
              habituais[team][season][playerName].starter++;
            }
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
        if (counts.total >= 10 && counts.starter / counts.total >= MIN_STARTER_RATE) {
          starterSets[team][season].add(player);
        }
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
          for (const entry of ctx.points) {
            const key = `${entry._eventDate}|${entry._team}`;
            if (!presentMap[key]) presentMap[key] = new Set();
            presentMap[key].add(playerName);
          }
        }
      }
    }
  }

  for (const [playerName, playerData] of Object.entries(raw)) {
    for (const [seasonStr, seasonData] of Object.entries(playerData)) {
      const season = parseInt(seasonStr);
      for (const gameType of ['regular', 'playoffs']) {
        for (const loc of ['home', 'away']) {
          const ctx = seasonData[gameType]?.[loc];
          if (!ctx) continue;
          for (const statKey of STAT_KEYS) {
            for (const entry of ctx[statKey] || []) {
              const key = `${entry._eventDate}|${entry._team}`;
              const present = presentMap[key] || new Set();
              const starters = starterSets[entry._team]?.[season] || new Set();
              entry.absentStarters = [...starters].filter(s => !present.has(s));
            }
          }
        }
      }
    }
  }
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
  // Carrega dados existentes (incremental) ou inicia do zero
  let existing = {};
  if (fs.existsSync('nba_player_stats.json')) {
    try {
      existing = JSON.parse(fs.readFileSync('nba_player_stats.json', 'utf-8'));
      console.log(`Stats existentes carregados: ${Object.keys(existing).length} jogadores.`);
    } catch {
      console.warn('nba_player_stats.json inválido — iniciando do zero.');
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

  // Coleta eventos do período
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
  }

  allEvents.sort((a, b) => new Date(a.date) - new Date(b.date));
  console.log(`Total de jogos a processar: ${allEvents.length}`);

  if (!allEvents.length) {
    console.log('Nenhum jogo novo encontrado. Stats já atualizados.');
    return;
  }

  // Reconstrói teamGameDates a partir dos dados existentes (para back-to-back correto)
  const teamGameDates = {};
  for (const playerData of Object.values(existing)) {
    for (const seasonData of Object.values(playerData)) {
      for (const gameTypeData of Object.values(seasonData)) {
        for (const loc of ['home', 'away']) {
          const ctx = gameTypeData[loc];
          if (!ctx) continue;
          for (const entry of ctx.points || []) {
            if (!entry._team || !entry.date) continue;
            if (!teamGameDates[entry._team]) teamGameDates[entry._team] = [];
            if (!teamGameDates[entry._team].includes(entry.date)) {
              teamGameDates[entry._team].push(entry.date);
            }
          }
        }
      }
    }
  }
  for (const dates of Object.values(teamGameDates)) {
    dates.sort();
  }

  // Processa novos box scores mesclando com existing
  const totalBoxScores = await processEvents(allEvents, existing, teamGameDates);

  console.log(`${totalBoxScores} box scores processados. Recalculando ausentes...`);
  recalculateAbsents(existing);
  stripInternalFields(existing);

  // Filtra jogadores com menos de 10 jogos
  const playerStats = {};
  for (const [name, seasons] of Object.entries(existing)) {
    let totalGames = 0;
    for (const seasonData of Object.values(seasons)) {
      for (const gameTypeData of Object.values(seasonData)) {
        totalGames += (gameTypeData.home?.games || 0) + (gameTypeData.away?.games || 0);
      }
    }
    if (totalGames < 10) continue;
    playerStats[name] = seasons;
  }

  if (!Object.keys(playerStats).length) {
    console.error('ERRO: nenhum jogador processado.');
    return;
  }

  fs.writeFileSync('nba_player_stats.json', JSON.stringify(playerStats, null, 2));
  console.log(`Stats salvos: ${Object.keys(playerStats).length} jogadores, ${totalBoxScores} novos box scores.`);
}

getPlayerStats();
