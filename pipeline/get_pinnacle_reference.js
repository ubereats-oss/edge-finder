// pipeline/get_pinnacle_reference.js
// Referência de odds da Pinnacle (H2H e props de jogador, os dois lados) pra
// eventos que começam nas próximas 24h — alimenta a tela "Conferir odds" do
// app, que compara manualmente contra o que o usuário vê nas casas
// portuguesas. Não espelha nem automatiza nenhuma casa de apostas: só chama
// a The Odds API pedindo explicitamente o bookmaker 'pinnacle'.
//
// Escopo de mercados limitado aos já suportados por settle_model_ledger.js
// (apuração de resultado) e closing_odds_rules.js/SPORT_MARKET_KEYS (captura
// de odd de fechamento) — pra toda conferência registrada aqui poder ser
// apurada e ter CLV real, reaproveitando o mecanismo existente sem mudar
// nada nele.
//
// Probabilidade justa: método de potência (power method) — resolve k tal que
// (1/oddsA)^k + (1/oddsB)^k = 1 por bisseção, mais preciso que o
// proporcional pra remover margem de forma não-uniforme entre favorito e
// zebra. Odd mínima de valor = odd justa (1/probJusta) * 1.01 (1% de folga).
//
// Uso: node pipeline/get_pinnacle_reference.js
// Grava pinnacle_reference.json na raiz do projeto.

const fs = require('fs');
const { createOddsApiClient, loadEnvFileIfPresent, defaultKeysFromEnv } = require('./odds_api_client');
const closingOddsRules = require('./closing_odds_rules');

loadEnvFileIfPresent();

const WINDOW_MS = 24 * 60 * 60 * 1000;
const VALUE_SLACK = 1.01; // 1% de folga acima da odd justa

// esporte (convenção do ledger) -> chave de esporte da The Odds API, se tem
// H2H elegível pra fechamento (ver closingOddsRules.SPORT_MARKET_KEYS) e o
// mapa mercado-da-API -> nome de mercado usado no ledger (precisa bater com
// o que settle_model_ledger.js e closingOddsRules já reconhecem).
const SPORTS = [
  {
    esporte: 'basketball/nba',
    apiSport: 'basketball_nba',
    h2h: true,
    props: {
      player_points: 'points',
      player_rebounds: 'rebounds',
      player_assists: 'assists',
      player_steals: 'steals',
      player_threes: 'threes',
    },
  },
  {
    esporte: 'baseball/mlb',
    apiSport: 'baseball_mlb',
    h2h: true,
    props: {
      batter_hits: 'hits',
      pitcher_strikeouts: 'strikeouts',
      pitcher_hits_allowed: 'hitsAllowed',
    },
  },
  {
    esporte: 'hockey/nhl',
    apiSport: 'icehockey_nhl',
    h2h: false, // sem extrator de h2h elegível pra fechamento (SPORT_MARKET_KEYS não lista h2h pro NHL)
    props: {
      player_points: 'points',
      player_goals: 'goals',
      player_assists: 'assists',
      player_shots_on_goal: 'shots',
    },
  },
  {
    esporte: 'americanfootball/nfl',
    apiSport: 'americanfootball_nfl',
    h2h: false, // idem — sem h2h elegível pra fechamento no NFL
    props: {
      player_pass_yds: 'passYards',
      player_pass_tds: 'passTDs',
      player_rush_yds: 'rushYards',
      player_receptions: 'receptions',
      player_reception_yds: 'receptionYards',
    },
  },
];

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Resolve k tal que (1/oddsA)^k + (1/oddsB)^k = 1 — pA,pB<1 então a soma
// decresce monotonicamente de (pA+pB) em k=1 até 0 quando k->infinito;
// bisseta em [1, 50] (suficiente pra qualquer overround realista).
function powerMethodFair(oddsA, oddsB) {
  const pA = 1 / oddsA, pB = 1 / oddsB;
  let lo = 1, hi = 50;
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    const sum = Math.pow(pA, mid) + Math.pow(pB, mid);
    if (sum > 1) lo = mid; else hi = mid;
  }
  const k = (lo + hi) / 2;
  const fairA = Math.pow(pA, k);
  const fairB = Math.pow(pB, k);
  const norm = fairA + fairB;
  return { fairA: fairA / norm, fairB: fairB / norm };
}

async function fetchEvents(oddsApi, apiSport) {
  const res = await oddsApi.get(`https://api.the-odds-api.com/v4/sports/${apiSport}/events`);
  return res.data;
}

async function fetchEventOdds(oddsApi, apiSport, eventId, markets) {
  const res = await oddsApi.get(
    `https://api.the-odds-api.com/v4/sports/${apiSport}/events/${eventId}/odds`,
    { params: { bookmakers: 'pinnacle', markets, oddsFormat: 'decimal' } }
  );
  return res.data;
}

function rowsFromH2h(sportCfg, event, pinnacleBm) {
  const market = pinnacleBm.markets?.find(m => m.key === 'h2h');
  if (!market) return [];
  const home = market.outcomes?.find(o => o.name === event.home_team);
  const away = market.outcomes?.find(o => o.name === event.away_team);
  if (!home || !away || typeof home.price !== 'number' || typeof away.price !== 'number') return [];

  const { fairA, fairB } = powerMethodFair(home.price, away.price);
  const rows = [];
  for (const [side, team, odds, fairProb] of [
    ['home', event.home_team, home.price, fairA],
    ['away', event.away_team, away.price, fairB],
  ]) {
    const fairOdds = 1 / fairProb;
    rows.push({
      esporte: sportCfg.esporte,
      eventId: event.id,
      game: `${event.home_team} x ${event.away_team}`,
      commenceTime: event.commence_time,
      market: 'h2h',
      line: 0, // h2h não tem linha — mesmo placeholder usado por model_mlb.js/model_nba.js
      side,
      player: team,
      pinnacleOdds: odds,
      fairProbPct: parseFloat((fairProb * 100).toFixed(2)),
      fairOdds: parseFloat(fairOdds.toFixed(3)),
      minValueOdds: parseFloat((fairOdds * VALUE_SLACK).toFixed(3)),
    });
  }
  return rows;
}

function rowsFromProps(sportCfg, event, pinnacleBm) {
  const rows = [];
  for (const market of pinnacleBm.markets ?? []) {
    const marketName = sportCfg.props[market.key];
    if (!marketName) continue;

    // jogador -> linha -> { Over, Under }
    const byPlayerLine = new Map();
    for (const outcome of market.outcomes ?? []) {
      if (outcome.point === undefined || outcome.point === null) continue;
      const key = `${outcome.description}|${outcome.point}`;
      if (!byPlayerLine.has(key)) byPlayerLine.set(key, { player: outcome.description, line: outcome.point });
      byPlayerLine.get(key)[outcome.name] = outcome.price;
    }

    for (const { player, line, Over, Under } of byPlayerLine.values()) {
      if (typeof Over !== 'number' || typeof Under !== 'number') continue;
      const { fairA: fairOver, fairB: fairUnder } = powerMethodFair(Over, Under);
      for (const [side, odds, fairProb] of [['Over', Over, fairOver], ['Under', Under, fairUnder]]) {
        const fairOdds = 1 / fairProb;
        rows.push({
          esporte: sportCfg.esporte,
          eventId: event.id,
          game: `${event.home_team} x ${event.away_team}`,
          commenceTime: event.commence_time,
          market: marketName,
          line,
          side,
          player,
          pinnacleOdds: odds,
          fairProbPct: parseFloat((fairProb * 100).toFixed(2)),
          fairOdds: parseFloat(fairOdds.toFixed(3)),
          minValueOdds: parseFloat((fairOdds * VALUE_SLACK).toFixed(3)),
        });
      }
    }
  }
  return rows;
}

async function main() {
  const keys = defaultKeysFromEnv();
  if (!keys.length) {
    console.log('Nenhuma chave da The Odds API configurada — pulando captura de referência da Pinnacle.');
    fs.writeFileSync('pinnacle_reference.json', JSON.stringify({ generatedAt: new Date().toISOString(), rows: [] }, null, 2));
    return;
  }
  const oddsApi = createOddsApiClient({ keys, label: 'pinnacle-reference' });

  const now = Date.now();
  const windowEnd = now + WINDOW_MS;
  const allRows = [];

  for (const sportCfg of SPORTS) {
    if (oddsApi.allExhausted()) {
      console.error('Todas as chaves esgotadas — abortando.');
      break;
    }
    console.log(`\n[${sportCfg.esporte}]`);
    let events;
    try {
      events = await fetchEvents(oddsApi, sportCfg.apiSport);
    } catch (e) {
      console.error(`  Erro ao buscar eventos: ${e.response?.data?.message || e.message}`);
      continue;
    }

    const upcoming = (events || []).filter(ev => {
      const t = new Date(ev.commence_time).getTime();
      return Number.isFinite(t) && t >= now && t <= windowEnd;
    });
    console.log(`  ${upcoming.length}/${(events || []).length} evento(s) nas próximas 24h.`);

    const marketsParam = [
      ...(sportCfg.h2h ? ['h2h'] : []),
      ...Object.keys(sportCfg.props),
    ].join(',');

    for (const event of upcoming) {
      if (oddsApi.allExhausted()) break;
      try {
        const data = await fetchEventOdds(oddsApi, sportCfg.apiSport, event.id, marketsParam);
        const pinnacleBm = data.bookmakers?.find(bm => bm.key === 'pinnacle');
        if (!pinnacleBm) { console.log(`  ${event.home_team} x ${event.away_team}: sem Pinnacle.`); continue; }

        const rows = [
          ...(sportCfg.h2h ? rowsFromH2h(sportCfg, event, pinnacleBm) : []),
          ...rowsFromProps(sportCfg, event, pinnacleBm),
        ];
        allRows.push(...rows);
        console.log(`  ${event.home_team} x ${event.away_team}: ${rows.length} linha(s).`);
        await sleep(300);
      } catch (e) {
        console.error(`  Erro no evento ${event.id}: ${e.response?.data?.message || e.message}`);
      }
    }
  }

  fs.writeFileSync('pinnacle_reference.json', JSON.stringify({ generatedAt: new Date().toISOString(), rows: allRows }, null, 2));
  console.log(`\npinnacle_reference.json salvo — ${allRows.length} linha(s) no total.`);
}

main().catch(e => { console.error('ERRO FATAL:', e.message); process.exit(1); });
