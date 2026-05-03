// fetch_bet_results.js
// Busca stats reais de cada aposta via ESPN API e gera apostas_com_resultados.json
// Uso: node fetch_bet_results.js

const https = require('https');
const fs = require('fs');

const APOSTAS = [
  { jogador: 'Michael King',      prop: 'hitsAllowed',  lado: 'Under', linha: 4.5, data: '20260502', esporte: 'baseball/mlb',    jogo: 'San Diego Padres x Chicago White Sox',           status: 'Pendente', odd: 2.330, stake: 17.68,  saldo: null },
  { jogador: 'Reid Detmers',      prop: 'hitsAllowed',  lado: 'Under', linha: 5.5, data: '20260502', esporte: 'baseball/mlb',    jogo: 'Los Angeles Angels x New York Mets',             status: 'Pendente', odd: 1.636, stake: 20.00,  saldo: null },
  { jogador: 'Travis Konecny',    prop: 'shots',        lado: 'Over',  linha: 1.5, data: '20260502', esporte: 'hockey/nhl',      jogo: 'Carolina Hurricanes x Philadelphia Flyers',      status: 'Pendente', odd: 1.591, stake: 30.00,  saldo: null },
  { jogador: 'Mitch Marner',      prop: 'points',       lado: 'Over',  linha: 0.5, data: '20260501', esporte: 'hockey/nhl',      jogo: 'Utah Mammoth x Vegas Golden Knights',            status: 'Pendente', odd: 1.578, stake: 20.00,  saldo: null },
  { jogador: 'Jakob Poeltl',      prop: 'rebounds',     lado: 'Over',  linha: 5.5, data: '20260501', esporte: 'basketball/nba',  jogo: 'Toronto Raptors x Cleveland Cavaliers',          status: 'Perdeu',   odd: 2.070, stake: 20.00,  saldo: -20.00 },
  { jogador: 'Jakob Poeltl',      prop: 'points',       lado: 'Over',  linha: 7.5, data: '20260501', esporte: 'basketball/nba',  jogo: 'Toronto Raptors x Cleveland Cavaliers',          status: 'Perdeu',   odd: 1.960, stake: 10.85,  saldo: -10.85 },
  { jogador: 'VJ Edgecombe',      prop: 'points',       lado: 'Over',  linha: 11.5,data: '20260430', esporte: 'basketball/nba',  jogo: 'Philadelphia 76ers x Boston Celtics',            status: 'Ganhou',   odd: 1.854, stake: 20.00,  saldo: 17.08 },
  { jogador: 'Kelly Oubre Jr',    prop: 'points',       lado: 'Over',  linha: 8.5, data: '20260430', esporte: 'basketball/nba',  jogo: 'Philadelphia 76ers x Boston Celtics',            status: 'Ganhou',   odd: 1.909, stake: 17.69,  saldo: 16.08 },
  { jogador: 'Nikola Vucevic',    prop: 'points',       lado: 'Over',  linha: 6.5, data: '20260430', esporte: 'basketball/nba',  jogo: 'Philadelphia 76ers x Boston Celtics',            status: 'Perdeu',   odd: 1.719, stake: 25.00,  saldo: -25.00 },
  { jogador: 'Kelly Oubre Jr',    prop: 'points',       lado: 'Over',  linha: 9.5, data: '20260428', esporte: 'basketball/nba',  jogo: 'Boston Celtics x Philadelphia 76ers',            status: 'Perdeu',   odd: 1.952, stake: 100.00, saldo: -100.00 },
  { jogador: 'Keldon Johnson',    prop: 'rebounds',     lado: 'Over',  linha: 3.5, data: '20260428', esporte: 'basketball/nba',  jogo: 'San Antonio Spurs x Portland Trail Blazers',     status: 'Ganhou',   odd: 2.020, stake: 100.00, saldo: 102.00 },
  { jogador: 'Nikola Vucevic',    prop: 'rebounds',     lado: 'Over',  linha: 4.5, data: '20260428', esporte: 'basketball/nba',  jogo: 'Boston Celtics x Philadelphia 76ers',            status: 'Perdeu',   odd: 1.869, stake: 100.00, saldo: -100.00 },
  { jogador: 'Ayo Dosunmu',       prop: 'points',       lado: 'Over',  linha: 19.5,data: '20260427', esporte: 'basketball/nba',  jogo: 'Denver Nuggets x Minnesota Timberwolves',        status: 'Perdeu',   odd: 1.961, stake: 150.00, saldo: -150.00 },
  { jogador: 'Ayo Dosunmu',       prop: 'rebounds',     lado: 'Under', linha: 5.5, data: '20260427', esporte: 'basketball/nba',  jogo: 'Denver Nuggets x Minnesota Timberwolves',        status: 'Ganhou',   odd: 1.540, stake: 100.00, saldo: 54.00 },
  { jogador: 'Luke Kennard',      prop: 'assists',      lado: 'Over',  linha: 4.5, data: '20260418', esporte: 'basketball/nba',  jogo: 'Los Angeles Lakers x Houston Rockets',           status: 'Perdeu',   odd: 1.917, stake: 30.00,  saldo: -30.00 },
  { jogador: 'Jerami Grant',      prop: 'points',       lado: 'Over',  linha: 9.5, data: '20260424', esporte: 'basketball/nba',  jogo: 'Portland Trail Blazers x San Antonio Spurs',     status: 'Ganhou',   odd: 1.980, stake: 119.00, saldo: 116.62 },
  { jogador: 'Jalen Green',       prop: 'points',       lado: 'Over',  linha: 18.5,data: '20260422', esporte: 'basketball/nba',  jogo: 'Oklahoma City Thunder x Phoenix Suns',           status: 'Ganhou',   odd: 1.892, stake: 50.00,  saldo: 44.60 },
  { jogador: 'LeBron James',      prop: 'assists',      lado: 'Over',  linha: 8.5, data: '20260421', esporte: 'basketball/nba',  jogo: 'Los Angeles Lakers x Houston Rockets',           status: 'Perdeu',   odd: 1.751, stake: 49.00,  saldo: -49.00 },
  { jogador: 'Jerami Grant',      prop: 'points',       lado: 'Over',  linha: 9.5, data: '20260426', esporte: 'basketball/nba',  jogo: 'Portland Trail Blazers x San Antonio Spurs',     status: 'Ganhou',   odd: 1.722, stake: 200.00, saldo: 144.40 },
  { jogador: "De'Aaron Fox",      prop: 'points',       lado: 'Over',  linha: 16.5,data: '20260421', esporte: 'basketball/nba',  jogo: 'San Antonio Spurs x Portland Trail Blazers',     status: 'Ganhou',   odd: 1.819, stake: 54.63,  saldo: 44.74 },
  { jogador: 'Dylan Harper',      prop: 'rebounds',     lado: 'Over',  linha: 2.5, data: '20260421', esporte: 'basketball/nba',  jogo: 'San Antonio Spurs x Portland Trail Blazers',     status: 'Perdeu',   odd: 1.813, stake: 65.00,  saldo: -65.00 },
  { jogador: 'Dennis Schroder',   prop: 'points',       lado: 'Over',  linha: 4.5, data: '20260420', esporte: 'basketball/nba',  jogo: 'Cleveland Cavaliers x Toronto Raptors',          status: 'Ganhou',   odd: 2.030, stake: 83.56,  saldo: 86.07 },
  { jogador: 'Scoot Henderson',   prop: 'assists',      lado: 'Over',  linha: 2.5, data: '20260419', esporte: 'basketball/nba',  jogo: 'San Antonio Spurs x Portland Trail Blazers',     status: 'Ganhou',   odd: 1.884, stake: 22.68,  saldo: 20.05 },
  { jogador: 'Keldon Johnson',    prop: 'rebounds',     lado: 'Over',  linha: 3.5, data: '20260419', esporte: 'basketball/nba',  jogo: 'San Antonio Spurs x Portland Trail Blazers',     status: 'Ganhou',   odd: 1.775, stake: 23.00,  saldo: 17.82 },
  { jogador: 'Reynaldo Lopez',    prop: 'hitsAllowed',  lado: 'Under', linha: 4.5, data: '20260414', esporte: 'baseball/mlb',    jogo: 'Atlanta Braves x Miami Marlins',                 status: 'Perdeu',   odd: 2.110, stake: 30.72,  saldo: -30.72 },
  { jogador: 'Coby White',        prop: 'points',       lado: 'Over',  linha: 13.5,data: '20260414', esporte: 'basketball/nba',  jogo: 'Charlotte Hornets x Miami Heat',                 status: 'Ganhou',   odd: 1.892, stake: 40.00,  saldo: 35.68 },
  { jogador: 'Aaron Wiggins',     prop: 'points',       lado: 'Under', linha: 20.5,data: '20260410', esporte: 'basketball/nba',  jogo: 'Denver Nuggets x Oklahoma City Thunder',         status: 'Ganhou',   odd: 2.100, stake: 20.00,  saldo: 22.00 },
  { jogador: 'Devin Carter',      prop: 'assists',      lado: 'Under', linha: 5.5, data: '20260410', esporte: 'basketball/nba',  jogo: 'Sacramento Kings x Golden State Warriors',       status: 'Ganhou',   odd: 1.724, stake: 16.66,  saldo: 12.06 },
  { jogador: 'LeBron James',      prop: 'assists',      lado: 'Under', linha: 9.5, data: '20260409', esporte: 'basketball/nba',  jogo: 'Golden State Warriors x Los Angeles Lakers',     status: 'Perdeu',   odd: 1.700, stake: 13.30,  saldo: -13.30 },
  { jogador: 'Luke Kennard',      prop: 'points',       lado: 'Under', linha: 14.5,data: '20260409', esporte: 'basketball/nba',  jogo: 'Golden State Warriors x Los Angeles Lakers',     status: 'Ganhou',   odd: 1.833, stake: 20.00,  saldo: 16.66 },
  { jogador: 'Daniss Jenkins',    prop: 'assists',      lado: 'Under', linha: 7.5, data: '20260406', esporte: 'basketball/nba',  jogo: 'Detroit Pistons x Orlando Magic',                status: 'Ganhou',   odd: 1.934, stake: 17.22,  saldo: 16.08 },
  { jogador: "De'Aaron Fox",      prop: 'points',       lado: 'Over',  linha: 15.5,data: '20260406', esporte: 'basketball/nba',  jogo: 'San Antonio Spurs x Philadelphia 76ers',         status: 'Perdeu',   odd: 1.952, stake: 17.22,  saldo: -17.22 },
  { jogador: 'Precious Achiuwa',  prop: 'points',       lado: 'Under', linha: 15.5,data: '20260403', esporte: 'basketball/nba',  jogo: 'Sacramento Kings x New Orleans Pelicans',        status: 'Ganhou',   odd: 1.970, stake: 20.00,  saldo: 19.40 },
  { jogador: 'Daniss Jenkins',    prop: 'assists',      lado: 'Under', linha: 6.5, data: '20260404', esporte: 'basketball/nba',  jogo: 'Detroit Pistons x Philadelphia 76ers',            status: 'Perdeu',   odd: 1.970, stake: 20.00,  saldo: -20.00 },
  { jogador: 'Jalen Duren',       prop: 'points',       lado: 'Under', linha: 22.5,data: '20260404', esporte: 'basketball/nba',  jogo: 'Detroit Pistons x Philadelphia 76ers',            status: 'Ganhou',   odd: 1.910, stake: 19.40,  saldo: 17.65 },
];

const PROP_STAT_MAP = {
  points:      { nba: 'points',       mlb: null,          nhl: 'points'  },
  rebounds:    { nba: 'rebounds',     mlb: null,          nhl: null      },
  assists:     { nba: 'assists',      mlb: null,          nhl: 'assists' },
  shots:       { nba: null,           mlb: null,          nhl: 'shots'   },
  hitsAllowed: { nba: null,           mlb: 'hitsAllowed', nhl: null      },
};

function get(url) {
  return new Promise((res, rej) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, r => {
      let d = '';
      r.on('data', c => d += c);
      r.on('end', () => {
        try { res(JSON.parse(d)); } catch(e) { rej(new Error(`JSON parse error: ${d.slice(0,200)}`)); }
      });
    }).on('error', rej);
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function getScoreboard(sport, date) {
  const url = `https://site.api.espn.com/apis/site/v2/sports/${sport}/scoreboard?dates=${date}`;
  return get(url);
}

async function getBoxscore(sport, eventId) {
  const url = `https://site.api.espn.com/apis/site/v2/sports/${sport}/summary?event=${eventId}`;
  return get(url);
}

function findStatValue(boxscore, playerName, prop, sport) {
  const sportKey = sport.split('/')[1]; // nba, mlb, nhl

  // NBA/NHL — boxscore.players
  if (boxscore.boxscore?.players) {
    for (const team of boxscore.boxscore.players) {
      for (const statGroup of team.statistics || []) {
        const labels = statGroup.labels || [];
        for (const athlete of statGroup.athletes || []) {
          const name = athlete.athlete?.displayName || '';
          if (!name.toLowerCase().includes(playerName.split(' ').slice(-1)[0].toLowerCase())) continue;

          const statMap = { points: 'PTS', rebounds: 'REB', assists: 'AST', shots: 'SOG' };
          const label = statMap[prop];
          if (!label) continue;
          const idx = labels.indexOf(label);
          if (idx === -1) continue;
          const val = parseFloat(athlete.stats?.[idx]);
          if (!isNaN(val)) return { player: name, value: val };
        }
      }
    }
  }

  // MLB — boxscore.players (pitchers: hitsAllowed = H)
  if (boxscore.boxscore?.players && sportKey === 'mlb') {
    for (const team of boxscore.boxscore.players) {
      for (const statGroup of team.statistics || []) {
        const labels = statGroup.labels || [];
        for (const athlete of statGroup.athletes || []) {
          const name = athlete.athlete?.displayName || '';
          if (!name.toLowerCase().includes(playerName.split(' ').slice(-1)[0].toLowerCase())) continue;
          // hitsAllowed = 'H' na linha do pitcher
          const idx = labels.indexOf('H');
          if (idx === -1) continue;
          const val = parseFloat(athlete.stats?.[idx]);
          if (!isNaN(val)) return { player: name, value: val };
        }
      }
    }
  }

  return null;
}

async function main() {
  const results = [];

  for (const aposta of APOSTAS) {
    process.stdout.write(`Buscando: ${aposta.jogador} ${aposta.prop} ${aposta.data}... `);

    let valorReal = null;
    let nomeReal = null;

    try {
      const scoreboard = await getScoreboard(aposta.esporte, aposta.data);
      const events = scoreboard.events || [];

      // Encontrar o jogo correto
      const jogoNorm = aposta.jogo.toLowerCase();
      let event = null;
      for (const e of events) {
        const teams = e.competitions?.[0]?.competitors?.map(c => c.team?.displayName?.toLowerCase()) || [];
        if (teams.some(t => jogoNorm.includes(t.split(' ').slice(-1)[0]))) {
          event = e;
          break;
        }
      }

      if (!event && events.length > 0) {
        // fallback: pegar qualquer jogo do dia que tenha o atleta
        for (const e of events) {
          const box = await getBoxscore(aposta.esporte, e.id);
          await sleep(200);
          const found = findStatValue(box, aposta.jogador, aposta.prop, aposta.esporte);
          if (found) { valorReal = found.value; nomeReal = found.player; event = e; break; }
        }
      } else if (event) {
        const box = await getBoxscore(aposta.esporte, event.id);
        await sleep(200);
        const found = findStatValue(box, aposta.jogador, aposta.prop, aposta.esporte);
        if (found) { valorReal = found.value; nomeReal = found.player; }
      }
    } catch(e) {
      console.log(`ERRO: ${e.message}`);
    }

    const ganhou = valorReal !== null
      ? (aposta.lado === 'Over' ? valorReal > aposta.linha : valorReal < aposta.linha)
      : null;

    console.log(valorReal !== null ? `${nomeReal} = ${valorReal} ${ganhou ? '✅' : '❌'}` : 'não encontrado');

    results.push({
      ...aposta,
      valorReal,
      nomeReal,
      ganhouCalc: ganhou,
    });

    await sleep(300);
  }

  fs.writeFileSync('apostas_com_resultados.json', JSON.stringify(results, null, 2));
  console.log('\nSalvo em apostas_com_resultados.json');

  // Resumo
  const resolvidas = results.filter(r => r.valorReal !== null);
  const acertos = resolvidas.filter(r => r.ganhouCalc).length;
  console.log(`\nEncontrados: ${resolvidas.length}/${results.length}`);
  console.log(`Acertos confirmados: ${acertos}/${resolvidas.length} (${(acertos/resolvidas.length*100).toFixed(1)}%)`);
}

main().catch(console.error);
