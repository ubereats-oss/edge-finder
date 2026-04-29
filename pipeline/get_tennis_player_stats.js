const axios = require('axios');
const fs = require('fs');

const TOURS = ['atp', 'wta'];

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getLastProcessedDate(existing) {
  let latest = null;
  for (const playerData of Object.values(existing)) {
    for (const surfaceData of Object.values(playerData)) {
      for (const entries of Object.values(surfaceData)) {
        if (!Array.isArray(entries)) continue;
        for (const entry of entries) {
          if (entry.date && (!latest || entry.date > latest)) latest = entry.date;
        }
      }
    }
  }
  return latest;
}

function detectSurface(event) {
  const venue = (event.competitions?.[0]?.venue?.description || '').toLowerCase();
  const name  = (event.name || '').toLowerCase();
  const combined = venue + ' ' + name;
  if (combined.includes('clay') || combined.includes('terre') || combined.includes('roland') || combined.includes('monte-carlo') || combined.includes('madrid') || combined.includes('rome')) return 'clay';
  if (combined.includes('grass') || combined.includes('wimbledon') || combined.includes('halle') || combined.includes("queen's")) return 'grass';
  if (combined.includes('indoor') || combined.includes('carpet') || combined.includes('hard indoor')) return 'hard_indoor';
  return 'hard';
}

function ensurePath(raw, player, surface, statKey) {
  if (!raw[player]) raw[player] = {};
  if (!raw[player][surface]) raw[player][surface] = { sets: [], games: [] };
  return raw[player][surface];
}

async function processScoreboard(tour, startDate, endDate, raw) {
  const url = `https://site.api.espn.com/apis/site/v2/sports/tennis/${tour}/scoreboard?limit=200&dates=${startDate}-${endDate}`;
  let res;
  try {
    res = await axios.get(url);
  } catch (e) {
    console.error(`Erro scoreboard ${tour} ${startDate}:`, e.message);
    return;
  }

  const events = (res.data.events || []).filter(e => {
    return e.competitions?.[0]?.status?.type?.completed;
  });

  for (const event of events) {
    const surface = detectSurface(event);
    const comp = event.competitions?.[0];
    if (!comp) continue;

    const competitors = comp.competitors || [];
    if (competitors.length < 2) continue;

    const p1 = competitors[0]?.athlete?.displayName;
    const p2 = competitors[1]?.athlete?.displayName;
    if (!p1 || !p2) continue;

    // Parse sets from linescores
    const linescores = comp.linescores || [];
    const p1Sets = linescores.filter((ls, i) => {
      if (i % 2 !== 0) return false;
      const p1Games = parseInt(ls.value) || 0;
      const p2Games = parseInt(linescores[i + 1]?.value) || 0;
      return p1Games > p2Games;
    }).length;
    const p2Sets = linescores.filter((ls, i) => {
      if (i % 2 !== 0) return false;
      const p1Games = parseInt(ls.value) || 0;
      const p2Games = parseInt(linescores[i + 1]?.value) || 0;
      return p2Games > p1Games;
    }).length;

    let p1Games = 0, p2Games = 0;
    for (let i = 0; i < linescores.length; i += 2) {
      p1Games += parseInt(linescores[i]?.value) || 0;
      if (linescores[i + 1]) p2Games += parseInt(linescores[i + 1]?.value) || 0;
    }

    const date = event.date || new Date().toISOString();

    const alreadyP1 = (raw[p1]?.[surface]?.sets || []).some(e => e.date === date && e.opponent === p2);
    if (!alreadyP1) {
      const ctx1 = ensurePath(raw, p1, surface);
      ctx1.sets.push({ value: p1Sets, date, opponent: p2 });
      ctx1.games.push({ value: p1Games, date, opponent: p2 });
    }

    const alreadyP2 = (raw[p2]?.[surface]?.sets || []).some(e => e.date === date && e.opponent === p1);
    if (!alreadyP2) {
      const ctx2 = ensurePath(raw, p2, surface);
      ctx2.sets.push({ value: p2Sets, date, opponent: p1 });
      ctx2.games.push({ value: p2Games, date, opponent: p1 });
    }
  }
}

async function getPlayerStats() {
  let existing = {};
  if (fs.existsSync('tennis_player_stats.json')) {
    try {
      existing = JSON.parse(fs.readFileSync('tennis_player_stats.json', 'utf-8'));
      console.log(`Stats tênis existentes: ${Object.keys(existing).length} jogadores.`);
    } catch {
      console.warn('tennis_player_stats.json inválido — iniciando do zero.');
    }
  }

  const lastDate = getLastProcessedDate(existing);
  let startDate, endDate;

  if (lastDate) {
    const d = new Date(lastDate);
    d.setDate(d.getDate() - 3);
    startDate = d.toISOString().slice(0, 10).replace(/-/g, '');
  } else {
    // 3 meses de histórico
    const d = new Date();
    d.setMonth(d.getMonth() - 3);
    startDate = d.toISOString().slice(0, 10).replace(/-/g, '');
  }
  endDate = new Date().toISOString().slice(0, 10).replace(/-/g, '');

  console.log(`Buscando tênis ${startDate} → ${endDate}`);

  for (const tour of TOURS) {
    console.log(`Processando ${tour.toUpperCase()}...`);
    await processScoreboard(tour, startDate, endDate, existing);
    await sleep(500);
  }

  const filtered = {};
  for (const [name, surfaces] of Object.entries(existing)) {
    let total = 0;
    for (const surf of Object.values(surfaces)) total += (surf.sets?.length || 0);
    if (total >= 5) filtered[name] = surfaces;
  }

  fs.writeFileSync('tennis_player_stats.json', JSON.stringify(filtered, null, 2));
  console.log(`Stats tênis salvos: ${Object.keys(filtered).length} jogadores.`);
}

getPlayerStats();
