// pipeline/capture_closing_odds.js
// Captura a odd de fechamento de cada indicação pendente cujo evento está
// prestes a começar, na MESMA casa de apostas cuja odd foi usada na
// avaliação original, e calcula o CLV (closing line value) comparando com a
// odd obtida. Não decide resultado nem mexe em resolutionStatus — só anota
// closingOdds/clv pra uso no relatório de desempenho.
//
// CLV > 0: a odd obtida era melhor que a de fechamento (o preço subiu depois
// que apostamos — boa seleção de linha, independente do resultado do jogo).
// CLV < 0: o mercado corrigiu contra nós antes do início.
//
// Uso: node pipeline/capture_closing_odds.js [esporte1 esporte2 ...]
// Sem argumentos, roda pros 4 esportes com props.
//
// Disparo just-in-time: quem decide QUANDO rodar é a Cloud Function
// closingOddsScheduler (functions/index.js), que reimplementa a mesma
// seleção de "próximo evento alcançável" (futuro priorizado sobre já
// iniciado) lendo o histórico central direto do GitHub e chama este
// workflow via workflow_dispatch pouco antes do início do evento. Este
// script não espera nada — roda, captura tudo que estiver dentro da janela
// de captura agora e encerra. O cron de baixa frequência
// (capture_closing_odds.yml) continua existindo só como rede de segurança,
// caso a Cloud Function falhe ou fique fora do ar.

const axios = require('axios');
const fs = require('fs');
const ledger = require('./model_ledger');

if (fs.existsSync('.env')) {
  for (const line of fs.readFileSync('.env', 'utf-8').split('\n')) {
    const [k, ...v] = line.split('=');
    if (k) process.env[k.trim()] = v.join('=').trim();
  }
}

const API_KEYS = [];
for (let i = 1; i <= 19; i++) {
  const key = i === 1 ? process.env.ODDS_API_KEY : process.env[`ODDS_API_KEY_${i}`];
  if (key && key.trim()) API_KEYS.push(key.trim());
}

let keyIndex = 0;
function getNextKey() {
  if (!API_KEYS.length) return null;
  const key = API_KEYS[keyIndex % API_KEYS.length];
  keyIndex++;
  return key;
}

// Janela de captura: só tenta buscar a odd de fechamento se o evento começa
// dentro desse intervalo — nem tarde demais (já passou), nem cedo demais
// (ainda não é "fechamento", é só mais uma cotação no meio do caminho).
// Fonte única em model_ledger.js — settle_model_ledger.js usa a mesma janela
// pra expirar quem passou dela sem sucesso.
const CAPTURE_WINDOW_BEFORE_MS = ledger.CLOSING_ODDS_CAPTURE_WINDOW_BEFORE_MS;
const CAPTURE_WINDOW_AFTER_MS  = ledger.CLOSING_ODDS_CAPTURE_WINDOW_AFTER_MS;

const SPORTS = [
  { esporte: 'basketball/nba', apiSport: 'basketball_nba', markets: { points: 'player_points', rebounds: 'player_rebounds', assists: 'player_assists', steals: 'player_steals', threes: 'player_threes' } },
  { esporte: 'baseball/mlb',   apiSport: 'baseball_mlb',   markets: { hits: 'batter_hits', strikeouts: 'pitcher_strikeouts', hitsAllowed: 'pitcher_hits_allowed' } },
  { esporte: 'hockey/nhl',     apiSport: 'icehockey_nhl',  markets: { points: 'player_points', goals: 'player_goals', assists: 'player_assists', shots: 'player_shots_on_goal' } },
  { esporte: 'americanfootball/nfl', apiSport: 'americanfootball_nfl', markets: { passYards: 'player_pass_yds', passTDs: 'player_pass_tds', rushYards: 'player_rush_yds', receptions: 'player_receptions', receptionYards: 'player_reception_yds' } },
];

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function fetchEventOdds(apiSport, eventId, marketKey) {
  const key = getNextKey();
  if (!key) throw new Error('Nenhuma chave ODDS_API_KEY configurada.');
  const url = `https://api.the-odds-api.com/v4/sports/${apiSport}/events/${eventId}/odds`;
  const res = await axios.get(url, { params: { apiKey: key, regions: 'us', markets: marketKey, oddsFormat: 'decimal' } });
  return res.data;
}

// Acha, dentro da resposta de odds de um evento, o preço atual do mesmo
// jogador+linha+lado, na MESMA casa de apostas usada na avaliação original.
function findClosingPrice(oddsData, marketKey, player, line, side, bookmaker) {
  if (!oddsData?.bookmakers) return null;
  const bm = oddsData.bookmakers.find(b => b.key === bookmaker);
  if (!bm) return null;
  const market = bm.markets?.find(m => m.key === marketKey);
  if (!market) return null;
  const outcome = market.outcomes?.find(o => o.description === player && o.point === line && o.name === side);
  return outcome ? outcome.price : null;
}

function computeClv(oddsObtida, oddsFechamento) {
  if (!oddsFechamento || oddsFechamento <= 0) return null;
  return parseFloat(((oddsObtida / oddsFechamento - 1) * 100).toFixed(2));
}

async function captureSport({ esporte, apiSport, markets }) {
  const now = Date.now();
  const files = ledger.listPartitions(esporte);
  let capturadas = 0, semJanela = 0, semOddDisponivel = 0, partitionsChanged = 0;

  for (const file of files) {
    const entries = ledger.loadPartitionFile(file);
    let changed = false;

    // Agrupa por evento pra não repetir a mesma chamada de API por indicação.
    const porEvento = new Map();
    for (const entry of entries) {
      if (entry.resolutionStatus !== ledger.RESOLUTION_STATUS.PENDENTE) continue;
      if (ledger.closingOddsStatusOf(entry) !== ledger.CLOSING_ODDS_STATUS.PENDENTE) continue;
      if (!markets[entry.market]) continue;

      const commence = new Date(entry.commenceTime).getTime();
      if (isNaN(commence)) continue;
      const delta = commence - now;
      if (delta > CAPTURE_WINDOW_BEFORE_MS || delta < -CAPTURE_WINDOW_AFTER_MS) { semJanela++; continue; }

      if (!porEvento.has(entry.eventId)) porEvento.set(entry.eventId, []);
      porEvento.get(entry.eventId).push(entry);
    }

    for (const [eventId, group] of porEvento) {
      // Uma chamada por mercado presente no grupo (o endpoint aceita vários
      // mercados de uma vez, mas simplifica pedir só os que este grupo usa).
      const marketKeysNeeded = [...new Set(group.map(e => markets[e.market]))];
      let oddsData;
      try {
        oddsData = await fetchEventOdds(apiSport, eventId, marketKeysNeeded.join(','));
      } catch (e) {
        console.warn(`  [${esporte}] erro buscando odds do evento ${eventId}: ${e.response?.data?.message || e.message}`);
        continue;
      }
      await sleep(250);

      for (const entry of group) {
        const marketKey = markets[entry.market];
        const price = findClosingPrice(oddsData, marketKey, entry.player, entry.line, entry.side, entry.bookmaker);
        if (price === null) { semOddDisponivel++; continue; }
        entry.closingOdds = price;
        entry.clv = computeClv(entry.odds, price);
        entry.closingOddsStatus = ledger.CLOSING_ODDS_STATUS.CAPTURADA;
        capturadas++;
        changed = true;
        const commence = new Date(entry.commenceTime).getTime();
        const minutosAntes = Math.round((commence - Date.now()) / 60000);
        console.log(`  [${esporte}] captura: ${entry.player} ${entry.market} ${entry.side} ${entry.line} — odd de fechamento obtida ${minutosAntes}min antes do início do evento.`);
      }
    }

    if (changed) {
      ledger.savePartitionFile(file, entries);
      partitionsChanged++;
    }
  }

  console.log(`[${esporte}] odd de fechamento capturada: ${capturadas} | fora da janela de captura: ${semJanela} | evento cotado mas sem essa odd específica: ${semOddDisponivel} | partições atualizadas: ${partitionsChanged}`);
  return { capturadas, semJanela, semOddDisponivel, partitionsChanged };
}

async function main() {
  if (!API_KEYS.length) {
    console.error('Nenhuma chave ODDS_API_KEY encontrada — abortando.');
    process.exit(1);
  }
  const requested = process.argv.slice(2).map(s => s.toLowerCase());
  const targets = requested.length ? SPORTS.filter(s => requested.some(r => s.esporte.includes(r))) : SPORTS;

  const totals = { capturadas: 0, semJanela: 0, semOddDisponivel: 0, partitionsChanged: 0 };
  for (const sport of targets) {
    const r = await captureSport(sport);
    for (const k of Object.keys(totals)) totals[k] += r[k];
  }
  console.log(`\nResumo geral: ${totals.capturadas} odd(s) de fechamento capturada(s), ${totals.partitionsChanged} partição(ões) atualizada(s).`);
}

main().catch(e => { console.error('Erro fatal em capture_closing_odds.js:', e); process.exit(1); });
