// fetch_nba_games.js
// Baixa todos os jogos e box scores históricos da ESPN e salva em cache local.
// Rode uma vez (ou quando quiser atualizar): node fetch_nba_games.js
//
// Gera dois arquivos:
//   nba_games_cache.json      → placares H2H por jogo (usado pelo backtest_nba.js)
//   nba_boxscores_cache.json  → stats por jogador por jogo (usado pelo backtest_nba_props.js)

const axios = require('axios');
const fs = require('fs');

// ── Meses a buscar ────────────────────────────────────────────────────────────
// season: 'base' = temporada 2024-25 (treino); 'walk' = 2025-26 (walk-forward)
const ALL_MONTHS = [
  { start: '20241001', end: '20241031', weight: 1, season: 'base' },
  { start: '20241101', end: '20241130', weight: 1, season: 'base' },
  { start: '20241201', end: '20241231', weight: 1, season: 'base' },
  { start: '20250101', end: '20250131', weight: 1, season: 'base' },
  { start: '20250201', end: '20250228', weight: 1, season: 'base' },
  { start: '20250301', end: '20250331', weight: 1, season: 'base' },
  { start: '20250401', end: '20250430', weight: 1, season: 'base' },
  { start: '20251001', end: '20251031', weight: 2, season: 'walk' },
  { start: '20251101', end: '20251130', weight: 2, season: 'walk' },
  { start: '20251201', end: '20251231', weight: 2, season: 'walk' },
  { start: '20260101', end: '20260131', weight: 3, season: 'walk' },
  { start: '20260201', end: '20260228', weight: 3, season: 'walk' },
  { start: '20260301', end: '20260331', weight: 3, season: 'walk' },
];

// ── Helpers ───────────────────────────────────────────────────────────────────
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function get(url, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await axios.get(url, { timeout: 15000 });
      return res.data;
    } catch (e) {
      if (i === retries - 1) throw e;
      await sleep(2000);
    }
  }
}

// ── Busca lista de jogos do mês ───────────────────────────────────────────────
async function fetchScoreboard(start, end) {
  const url = `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?limit=200&dates=${start}-${end}`;
  const data = await get(url);
  return data.events || [];
}

// ── Parse dos eventos em jogos H2H ───────────────────────────────────────────
function parseGames(events, weight, season) {
  const games = [];
  for (const e of events) {
    const comp = e.competitions[0];
    if (!comp.status.type.completed) continue;
    const home = comp.competitors.find(c => c.homeAway === 'home');
    const away = comp.competitors.find(c => c.homeAway === 'away');
    if (!home || !away) continue;
    const homeScore = parseInt(home.score);
    const awayScore = parseInt(away.score);
    if (!homeScore && !awayScore) continue;
    games.push({
      gameId: e.id,
      date: e.date,
      season,
      weight,
      homeTeam: home.team.displayName,
      awayTeam: away.team.displayName,
      homeScore,
      awayScore,
      homeWon: homeScore > awayScore,
    });
  }
  return games;
}

// ── Busca box score de um jogo ────────────────────────────────────────────────
// Retorna array de { playerName, teamName, location, stats }
// stats: { points, rebounds, assists, steals, threes, fouls }
async function fetchBoxScore(gameId) {
  const url = `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event=${gameId}`;
  const data = await get(url);

  const players = [];
  const boxscore = data.boxscore;
  if (!boxscore || !boxscore.players) return players;

  // Monta mapa teamName → homeAway a partir do header
  const locationMap = {};
  for (const comp of (data.header?.competitions?.[0]?.competitors || [])) {
    if (comp.team?.displayName) {
      locationMap[comp.team.displayName] = comp.homeAway; // 'home' | 'away'
    }
  }

  for (const teamEntry of boxscore.players) {
    const teamName = teamEntry.team?.displayName;
    const location = locationMap[teamName] || 'unknown';

    for (const statGroup of (teamEntry.statistics || [])) {
      const labels = statGroup.labels || [];
      const idx = {
        MIN:  labels.indexOf('MIN'),
        PTS:  labels.indexOf('PTS'),
        REB:  labels.indexOf('REB'),
        AST:  labels.indexOf('AST'),
        STL:  labels.indexOf('STL'),
        FG3M: labels.indexOf('3PM'),
        PF:   labels.indexOf('PF'),
      };

      for (const athlete of (statGroup.athletes || [])) {
        if (athlete.didNotPlay) continue;
        const stats = athlete.stats || [];

        const minRaw = idx.MIN >= 0 ? stats[idx.MIN] : null;
        if (!minRaw || minRaw === '0:00' || minRaw === '--') continue;

        const pts  = idx.PTS  >= 0 ? parseFloat(stats[idx.PTS])  : null;
        const reb  = idx.REB  >= 0 ? parseFloat(stats[idx.REB])  : null;
        const ast  = idx.AST  >= 0 ? parseFloat(stats[idx.AST])  : null;
        const stl  = idx.STL  >= 0 ? parseFloat(stats[idx.STL])  : null;
        const fg3m = idx.FG3M >= 0 ? parseFloat(stats[idx.FG3M]) : null;
        const pf   = idx.PF   >= 0 ? parseFloat(stats[idx.PF])   : null;

        if ([pts, reb, ast, stl, fg3m, pf].every(v => v === null || isNaN(v))) continue;

        players.push({
          playerName: athlete.athlete?.displayName,
          teamName,
          location,
          stats: {
            points:   (!isNaN(pts)  && pts  !== null) ? pts  : null,
            rebounds: (!isNaN(reb)  && reb  !== null) ? reb  : null,
            assists:  (!isNaN(ast)  && ast  !== null) ? ast  : null,
            steals:   (!isNaN(stl)  && stl  !== null) ? stl  : null,
            threes:   (!isNaN(fg3m) && fg3m !== null) ? fg3m : null,
            fouls:    (!isNaN(pf)   && pf   !== null) ? pf   : null,
          },
        });
      }
    }
  }
  return players;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('╔══════════════════════════════════════════╗');
  console.log('║   fetch_nba_games.js — cache de dados    ║');
  console.log('╚══════════════════════════════════════════╝\n');

  const allGames = [];
  const allBoxScores = {};

  // ── Passo 1: scoreboards (13 requisições, rápido) ─────────────────────────
  console.log('Passo 1/2 — Buscando scoreboards...\n');
  for (const { start, end, weight, season } of ALL_MONTHS) {
    const label = season === 'base' ? 'Base' : 'Walk';
    process.stdout.write(`  [${label}] ${start}: `);
    const events = await fetchScoreboard(start, end);
    const games = parseGames(events, weight, season);
    for (const g of games) allGames.push(g);
    console.log(`${games.length} jogos`);
    await sleep(300);
  }

  fs.writeFileSync('nba_games_cache.json', JSON.stringify(allGames, null, 2));
  console.log(`\n✔ nba_games_cache.json salvo — ${allGames.length} jogos totais\n`);

  // ── Passo 2: box scores (~1 req por jogo, lento) ──────────────────────────
  console.log('Passo 2/2 — Buscando box scores...');
  console.log('  Estimativa: ~10-20 min dependendo da conexão\n');

  const total = allGames.length;
  let done = 0;
  let errors = 0;

  for (const game of allGames) {
    done++;
    if (done % 100 === 0 || done === total) {
      console.log(`  Progresso: ${done}/${total} jogos (erros: ${errors})`);
    }

    try {
      const players = await fetchBoxScore(game.gameId);
      if (players.length > 0) {
        allBoxScores[game.gameId] = {
          date: game.date,
          season: game.season,
          weight: game.weight,
          homeTeam: game.homeTeam,
          awayTeam: game.awayTeam,
          players,
        };
      }
    } catch (_e) {
      errors++;
    }

    await sleep(150);
  }

  fs.writeFileSync('nba_boxscores_cache.json', JSON.stringify(allBoxScores, null, 2));
  const covered = Object.keys(allBoxScores).length;
  console.log(`\n✔ nba_boxscores_cache.json salvo — ${covered}/${total} jogos com box score`);
  if (errors > 0) console.log(`  ⚠ Erros de fetch: ${errors} jogos sem box score`);
  console.log('\nPronto. Rode backtest_nba.js e backtest_nba_props.js sem conexão.');
}

main().catch(console.error);
