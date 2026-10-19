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

const ledger = require('./model_ledger');
const closingOddsRules = require('./closing_odds_rules');
const lineAdjustedClv = require('./line_adjusted_clv');
const { createOddsApiClient, loadEnvFileIfPresent } = require('./odds_api_client');

loadEnvFileIfPresent();
let oddsApi;

const SPORTS = [
  { esporte: 'basketball/nba', apiSport: 'basketball_nba', markets: { h2h: 'h2h', points: 'player_points', rebounds: 'player_rebounds', assists: 'player_assists', steals: 'player_steals', threes: 'player_threes' } },
  { esporte: 'baseball/mlb',   apiSport: 'baseball_mlb',   markets: { h2h: 'h2h', hits: 'batter_hits', strikeouts: 'pitcher_strikeouts', hitsAllowed: 'pitcher_hits_allowed' } },
  { esporte: 'hockey/nhl',     apiSport: 'icehockey_nhl',  markets: { points: 'player_points', goals: 'player_goals', assists: 'player_assists', shots: 'player_shots_on_goal' } },
  { esporte: 'americanfootball/nfl', apiSport: 'americanfootball_nfl', markets: { passYards: 'player_pass_yds', passTDs: 'player_pass_tds', rushYards: 'player_rush_yds', receptions: 'player_receptions', receptionYards: 'player_reception_yds' } },
];

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function fetchEventOdds(apiSport, eventId, marketKey, regions = 'us') {
  const url = `https://api.the-odds-api.com/v4/sports/${apiSport}/events/${eventId}/odds`;
  const res = await oddsApi.get(url, { params: { regions, markets: marketKey, oddsFormat: 'decimal' } });
  return res.data;
}

// Igual fetchEventOdds, mas também devolve o custo em créditos da chamada
// (header x-requests-last da The Odds API) — só usado na chamada extra de
// conferências de prop com referência Pinnacle, pra reportar o consumo
// adicional sem misturar com a contagem da chamada original (inalterada).
async function fetchEventOddsWithCost(apiSport, eventId, marketKey, regions) {
  const url = `https://api.the-odds-api.com/v4/sports/${apiSport}/events/${eventId}/odds`;
  const res = await oddsApi.get(url, { params: { regions, markets: marketKey, oddsFormat: 'decimal' } });
  const creditsUsed = parseInt(res.headers['x-requests-last'], 10);
  return { data: res.data, creditsUsed: Number.isFinite(creditsUsed) ? creditsUsed : 0 };
}

function describeClosingPriceMatch(oddsData, marketKey, player, line, side, bookmaker) {
  if (!oddsData?.bookmakers) return { price: null, reason: 'evento_nao_encontrado' };
  const bm = bookmaker
    ? oddsData.bookmakers.find(b => b.key === bookmaker)
    : oddsData.bookmakers[0];
  if (!bm) return { price: null, reason: 'bookmaker_indisponivel' };
  const market = bm.markets?.find(m => m.key === marketKey);
  if (!market) return { price: null, reason: 'mercado_indisponivel' };
  if (marketKey === 'h2h') {
    const outcome = market.outcomes?.find(o => o.name === player);
    return outcome ? { price: outcome.price, reason: null } : { price: null, reason: 'evento_sem_jogador' };
  }
  const outcome = market.outcomes?.find(o => o.description === player && o.point === line && o.name === side);
  if (outcome) return { price: outcome.price, reason: null };

  const samePlayerSide = market.outcomes?.filter(o => o.description === player && o.name === side) ?? [];
  if (samePlayerSide.length) {
    const byLine = new Map();
    for (const o of market.outcomes ?? []) {
      if (o.description !== player || typeof o.point !== 'number') continue;
      if (!byLine.has(o.point)) byLine.set(o.point, {});
      byLine.get(o.point)[o.name] = o.price;
    }
    const closingLines = [...byLine.entries()]
      .map(([point, prices]) => ({ line: point, overOdds: prices.Over, underOdds: prices.Under }))
      .filter(x => x.overOdds && x.underOdds)
      .sort((a, b) => Math.abs(a.line - line) - Math.abs(b.line - line));
    return {
      price: null,
      reason: 'linha_mudou_ate_fechamento',
      adjustedClosingLine: closingLines[0] ?? null,
      availableLines: samePlayerSide.map(o => ({ line: o.point, price: o.price })).slice(0, 10),
    };
  }

  const samePlayer = market.outcomes?.filter(o => o.description === player) ?? [];
  if (samePlayer.length) {
    return {
      price: null,
      reason: 'lado_indisponivel_para_jogador',
      availableLines: samePlayer.map(o => ({ side: o.name, line: o.point, price: o.price })).slice(0, 10),
    };
  }

  return { price: null, reason: 'jogador_indisponivel_no_mercado' };
}

// Acha, dentro da resposta de odds de um evento, o preço atual do mesmo
// jogador+linha+lado, na MESMA casa de apostas usada na avaliação original.
function findClosingPrice(oddsData, marketKey, player, line, side, bookmaker) {
  return describeClosingPriceMatch(oddsData, marketKey, player, line, side, bookmaker).price;
}

function computeClv(oddsObtida, oddsFechamento) {
  if (!oddsFechamento || oddsFechamento <= 0) return null;
  return parseFloat(((oddsObtida / oddsFechamento - 1) * 100).toFixed(2));
}

// Separa um grupo (mesmo evento) em: conferências PT (tela "Conferir odds")
// de prop com referência Pinnacle, que pedem a chamada extra com região
// 'eu' — e o resto (indicações de modelo + conferência PT de h2h, que já
// usa 'us,eu' na chamada original), que segue exatamente como antes.
function splitCaptureGroup(group, markets) {
  const ptPinnacleProps = group.filter(e =>
    e.source === 'pt_odds_check' && e.bookmaker === 'pinnacle' && markets[e.market] !== 'h2h'
  );
  const rest = group.filter(e => !ptPinnacleProps.includes(e));
  return { rest, ptPinnacleProps };
}

// Aplica o match/CLV de cada entrada do subgrupo contra a mesma resposta de
// odds (oddsData) já buscada — usado tanto pro grupo original (indicações
// de modelo + eventual conferência PT que não precise de região extra)
// quanto pro subgrupo extra de conferências PT com referência Pinnacle.
// Muda `counters` e `entries` (por referência) e devolve se algo mudou.
function applyClosingOddsToGroup(oddsData, group, markets, esporte, counters) {
  let changed = false;
  for (const entry of group) {
    const marketKey = markets[entry.market];
    const match = describeClosingPriceMatch(oddsData, marketKey, entry.player, entry.line, entry.side, entry.bookmaker);
    const price = match.price;
    if (price === null) {
      counters.semOddDisponivel++;
      entry.closingOddsLastAttemptAt = new Date().toISOString();
      entry.closingOddsMissingReason = match.reason;
      if (match.availableLines?.length) entry.closingOddsAvailableLines = match.availableLines;
      if (match.adjustedClosingLine) {
        entry.adjustedClosingLine = match.adjustedClosingLine.line;
        entry.adjustedClosingOverOdds = match.adjustedClosingLine.overOdds;
        entry.adjustedClosingUnderOdds = match.adjustedClosingLine.underOdds;
        entry.closingLineMovement = lineAdjustedClv.movementDirection(entry.side, entry.line, match.adjustedClosingLine.line);
        entry.lineAdjustedClv = lineAdjustedClv.adjustedClv(entry, match.adjustedClosingLine);
      }
      changed = true;
      continue;
    }
    entry.closingOdds = price;
    entry.clv = computeClv(entry.odds, price);
    entry.closingOddsStatus = ledger.CLOSING_ODDS_STATUS.CAPTURADA;
    entry.closingOddsMissingReason = null;
    entry.closingOddsAvailableLines = null;
    entry.adjustedClosingLine = null;
    entry.adjustedClosingOverOdds = null;
    entry.adjustedClosingUnderOdds = null;
    entry.closingLineMovement = 'neutro';
    entry.lineAdjustedClv = null;
    counters.capturadas++;
    changed = true;
    const commence = new Date(entry.commenceTime).getTime();
    const minutosAntes = Math.round((commence - Date.now()) / 60000);
    console.log(`  [${esporte}] captura: ${entry.player} ${entry.market} ${entry.side} ${entry.line} — odd de fechamento obtida ${minutosAntes}min antes do início do evento.`);
  }
  return changed;
}

async function captureSport({ esporte, apiSport, markets }) {
  const now = Date.now();
  const files = ledger.listPartitions(esporte);
  let capturadas = 0, semJanela = 0, semOddDisponivel = 0, partitionsChanged = 0;
  // Conferências da tela "Conferir odds" (source:'pt_odds_check') com
  // bookmaker:'pinnacle' em mercado de prop pedem uma chamada extra com
  // região 'eu' incluída (onde a Pinnacle é documentada) — indicações do
  // modelo nunca entram nesse caminho, então o comportamento/custo delas
  // não muda em nada. Contadores separados só pra essa chamada extra.
  let creditosExtrasConferenciasPt = 0, chamadasExtrasConferenciasPt = 0,
    capturadasConferenciasPt = 0, semOddDisponivelConferenciasPt = 0;

  for (const file of files) {
    const entries = ledger.loadPartitionFile(file);
    let changed = false;

    // Agrupa por evento pra não repetir a mesma chamada de API por indicação.
    const grouped = closingOddsRules.groupEntriesForCapture(entries, esporte, markets, now);
    const porEvento = grouped.porEvento;
    semJanela += grouped.semJanela;

    for (const [eventId, group] of porEvento) {
      const { rest, ptPinnacleProps } = splitCaptureGroup(group, markets);

      // Chamada original, exatamente como antes — só pro resto do grupo
      // (indicações de modelo + qualquer conferência PT de h2h, que já usa
      // 'us,eu'). Se ptPinnacleProps esvaziar o grupo todo, `rest` fica
      // vazio e esta chamada é pulada (nada a buscar nela).
      if (rest.length) {
        const marketKeysNeeded = [...new Set(rest.map(e => markets[e.market]))];
        let oddsData;
        try {
          const regions = marketKeysNeeded.includes('h2h') ? 'us,eu' : 'us';
          oddsData = await fetchEventOdds(apiSport, eventId, marketKeysNeeded.join(','), regions);
        } catch (e) {
          console.warn(`  [${esporte}] erro buscando odds do evento ${eventId}: ${e.response?.data?.message || e.message}`);
          continue;
        }
        await sleep(250);
        const counters = { capturadas: 0, semOddDisponivel: 0 };
        if (applyClosingOddsToGroup(oddsData, rest, markets, esporte, counters)) changed = true;
        capturadas += counters.capturadas;
        semOddDisponivel += counters.semOddDisponivel;
      }

      // Chamada extra, só se houver conferência de prop com referência
      // Pinnacle neste evento — região 'us,eu' pra achar a Pinnacle.
      if (ptPinnacleProps.length) {
        const marketKeysNeeded = [...new Set(ptPinnacleProps.map(e => markets[e.market]))];
        let oddsData, creditsUsed;
        try {
          const result = await fetchEventOddsWithCost(apiSport, eventId, marketKeysNeeded.join(','), 'us,eu');
          oddsData = result.data;
          creditsUsed = result.creditsUsed;
        } catch (e) {
          console.warn(`  [${esporte}] erro buscando odds (conferência PT, região eu) do evento ${eventId}: ${e.response?.data?.message || e.message}`);
          continue;
        }
        await sleep(250);
        chamadasExtrasConferenciasPt++;
        creditosExtrasConferenciasPt += creditsUsed;
        const counters = { capturadas: 0, semOddDisponivel: 0 };
        if (applyClosingOddsToGroup(oddsData, ptPinnacleProps, markets, esporte, counters)) changed = true;
        capturadasConferenciasPt += counters.capturadas;
        semOddDisponivelConferenciasPt += counters.semOddDisponivel;
        capturadas += counters.capturadas;
        semOddDisponivel += counters.semOddDisponivel;
      }
    }

    if (changed) {
      ledger.savePartitionFile(file, entries);
      partitionsChanged++;
    }
  }

  console.log(`[${esporte}] odd de fechamento capturada: ${capturadas} | fora da janela de captura: ${semJanela} | evento cotado mas sem essa odd específica: ${semOddDisponivel} | partições atualizadas: ${partitionsChanged}`);
  if (chamadasExtrasConferenciasPt > 0) {
    console.log(`  [${esporte}] conferências PT (referência Pinnacle, região extra 'eu'): ${chamadasExtrasConferenciasPt} chamada(s) extra, ${creditosExtrasConferenciasPt} crédito(s) extra consumido(s), ${capturadasConferenciasPt} capturada(s), ${semOddDisponivelConferenciasPt} sem odd disponível.`);
  }
  return {
    capturadas, semJanela, semOddDisponivel, partitionsChanged,
    creditosExtrasConferenciasPt, chamadasExtrasConferenciasPt,
    capturadasConferenciasPt, semOddDisponivelConferenciasPt,
  };
}

async function main() {
  try {
    oddsApi = createOddsApiClient({ label: 'closing-odds' });
  } catch (e) {
    console.error(`${e.message} — abortando.`);
    process.exit(1);
  }
  const requested = process.argv.slice(2).map(s => s.toLowerCase());
  const targets = requested.length ? SPORTS.filter(s => requested.some(r => s.esporte.includes(r))) : SPORTS;

  const totals = {
    capturadas: 0, semJanela: 0, semOddDisponivel: 0, partitionsChanged: 0,
    creditosExtrasConferenciasPt: 0, chamadasExtrasConferenciasPt: 0,
    capturadasConferenciasPt: 0, semOddDisponivelConferenciasPt: 0,
  };
  for (const sport of targets) {
    const r = await captureSport(sport);
    for (const k of Object.keys(totals)) totals[k] += r[k];
  }
  console.log(`\nResumo geral: ${totals.capturadas} odd(s) de fechamento capturada(s), ${totals.partitionsChanged} partição(ões) atualizada(s).`);
  if (totals.chamadasExtrasConferenciasPt > 0) {
    console.log(
      `Consumo extra (conferências PT com referência Pinnacle, região 'eu' adicional): ` +
      `${totals.chamadasExtrasConferenciasPt} chamada(s), ${totals.creditosExtrasConferenciasPt} crédito(s), ` +
      `${totals.capturadasConferenciasPt} odd(s) capturada(s), ${totals.semOddDisponivelConferenciasPt} sem odd disponível. ` +
      `Indicações de modelo: nenhuma mudança de comportamento ou custo.`
    );
  }
}

if (require.main === module) {
  main().catch(e => { console.error('Erro fatal em capture_closing_odds.js:', e); process.exit(1); });
}

module.exports = {
  describeClosingPriceMatch,
  findClosingPrice,
  computeClv,
  splitCaptureGroup,
  applyClosingOddsToGroup,
};
