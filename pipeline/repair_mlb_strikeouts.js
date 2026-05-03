// Corrige valores de strikeouts (K) no mlb_player_stats.json
// ESPN usa label 'K', não 'SO'. Todos os valores estavam salvos como 0.
// Processa meses a partir de 2024 (suficiente para base + walk do backtest).

const axios = require('axios');
const fs    = require('fs');

const MONTHS_TO_REPAIR = [
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
  { start: '20260319', end: '20260331', season: 2026 },
  { start: '20260401', end: '20260430', season: 2026 },
  { start: '20260501', end: '20260531', season: 2026 },
];

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function fetchEvents(start, end) {
  const url = `https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard?limit=200&dates=${start}-${end}`;
  const res = await axios.get(url);
  return (res.data.events || [])
    .filter(e => e.competitions?.[0]?.status?.type?.completed)
    .map(e => {
      const comp = e.competitions[0];
      const home = comp.competitors.find(c => c.homeAway === 'home');
      const away = comp.competitors.find(c => c.homeAway === 'away');
      return {
        id:       e.id,
        date:     e.date,
        season:   e.season?.year,
        homeTeam: home?.team?.displayName,
        awayTeam: away?.team?.displayName,
      };
    });
}

async function fetchPitcherK(eventId) {
  const url = `https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/summary?event=${eventId}`;
  const res = await axios.get(url);
  const result = {};
  for (const team of res.data.boxscore?.players || []) {
    const teamName = team.team?.displayName;
    for (const group of team.statistics || []) {
      const labels = group.labels || [];
      if (!labels.includes('IP')) continue;
      const idxK = labels.indexOf('K') !== -1 ? labels.indexOf('K') : labels.indexOf('SO');
      if (idxK === -1) continue;
      for (const athlete of group.athletes || []) {
        const name = athlete.athlete?.displayName;
        if (!name) continue;
        const k = parseFloat((athlete.stats || [])[idxK]) || 0;
        result[name] = { k, team: teamName };
      }
    }
  }
  return result;
}

async function main() {
  if (!fs.existsSync('mlb_player_stats.json')) {
    console.error('ERRO: mlb_player_stats.json não encontrado.');
    process.exit(1);
  }

  console.log('Carregando mlb_player_stats.json...');
  const data = JSON.parse(fs.readFileSync('mlb_player_stats.json', 'utf8'));

  // Índice rápido: name -> season -> gameType -> loc -> Map<dateKey, entry>
  const index = {};
  for (const [name, playerData] of Object.entries(data)) {
    index[name] = {};
    for (const [seasonStr, seasonData] of Object.entries(playerData)) {
      index[name][seasonStr] = {};
      for (const [gt, gtd] of Object.entries(seasonData)) {
        index[name][seasonStr][gt] = {};
        for (const loc of ['home', 'away']) {
          const ctx = gtd[loc];
          if (!ctx?.strikeouts) continue;
          const map = new Map();
          for (const entry of ctx.strikeouts) {
            const key = (entry.date || '').slice(0, 10) + '|' + (entry.opponent || '');
            map.set(key, entry);
          }
          index[name][seasonStr][gt][loc] = map;
        }
      }
    }
  }

  let totalPatched = 0;
  let totalGames   = 0;

  for (const { start, end, season } of MONTHS_TO_REPAIR) {
    console.log(`Processando ${start}–${end} (season ${season})...`);
    let events;
    try {
      events = await fetchEvents(start, end);
    } catch (e) {
      console.warn(`  Erro ao buscar eventos: ${e.message}`);
      continue;
    }
    console.log(`  ${events.length} jogos completos`);

    for (const event of events) {
      totalGames++;
      try {
        const pitcherK = await fetchPitcherK(event.id);
        const seasonStr = String(season);
        const dateKey10 = (event.date || '').slice(0, 10);

        for (const [name, { k, team }] of Object.entries(pitcherK)) {
          const isHome = team === event.homeTeam;
          const opponent = isHome ? event.awayTeam : event.homeTeam;
          const loc = isHome ? 'home' : 'away';
          const entryKey = `${dateKey10}|${opponent}`;

          for (const gt of ['regular', 'playoffs']) {
            const entry = index[name]?.[seasonStr]?.[gt]?.[loc]?.get(entryKey);
            if (entry && entry.value !== k) {
              entry.value = k;
              totalPatched++;
            }
          }
        }
      } catch { /* boxscore indisponível */ }

      await sleep(150);
      if (totalGames % 50 === 0) console.log(`  ${totalGames} jogos, ${totalPatched} K corrigidos`);
    }
  }

  console.log(`\nTotal: ${totalGames} jogos processados, ${totalPatched} valores de K corrigidos.`);
  fs.writeFileSync('mlb_player_stats.json', JSON.stringify(data));
  console.log('mlb_player_stats.json salvo.');
}

main();
