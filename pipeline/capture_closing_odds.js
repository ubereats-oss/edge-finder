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
// Independente de agendador: ao iniciar, acha a indicação pendente cujo
// evento começa mais cedo (dentro do orçamento de espera de um job, ver
// MAX_JOB_WAIT_MS) e aguarda (sleep) dentro do próprio processo até pouco
// antes do início — não depende do cron disparar na hora certa. Ao acordar,
// captura tudo que estiver na janela. Ao final, se ainda sobrar alguma
// indicação pendente dentro do orçamento de espera, dispara programaticamente
// uma nova execução deste workflow (via API do GitHub) pra continuar a
// cadeia a partir do evento seguinte — ver triggerNextRun(). O cron
// (capture_closing_odds.yml) continua existindo só como rede de segurança de
// baixa frequência, pra reiniciar a cadeia se ela for interrompida (job
// cancelado, disparo falhou, etc.) ou pra pegar o primeiro evento do dia.

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
const CAPTURE_WINDOW_BEFORE_MS = 2 * 60 * 60 * 1000; // até 2h antes do início
const CAPTURE_WINDOW_AFTER_MS  = 10 * 60 * 1000;      // até 10min depois (mercado pode suspender exatamente na hora)

// Teto de espera por execução — abaixo do limite de execução de job do
// GitHub Actions pra runner hospedado (6h / 360min, não configurável pra
// cima), com margem de ~1h pra checkout, instalação, chamadas à API de odds,
// tentativas de push com recuo exponencial e o disparo da próxima execução.
// Evento além desse alcance não entra na espera desta execução — fica pro
// cron pegar quando estiver mais perto (ver findNextReachableEvent).
const MAX_JOB_WAIT_MS = 5 * 60 * 60 * 1000; // 5h
const TARGET_LEAD_MS  = 3 * 60 * 1000;      // alvo: acordar ~3min antes do início

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
      if (entry.closingOdds !== null && entry.closingOdds !== undefined) continue;
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

// Vasculha todas as indicações pendentes (sem odd de fechamento ainda) dos
// esportes alvo e devolve a de commenceTime mais cedo entre as que ainda são
// "alcançáveis": não expirou (mais de CAPTURE_WINDOW_AFTER_MS desde o
// início — essa nunca mais vai ter odd de fechamento, não faz sentido
// esperar por ela nem travar a cadeia nela) e não fica além do orçamento de
// espera de um único job (MAX_JOB_WAIT_MS, contado a partir do alvo de
// TARGET_LEAD_MS antes do início). Devolve null se não houver nenhuma —
// tanto faz se é porque não sobrou indicação pendente, quanto porque a mais
// próxima está fora do alcance da espera.
function findNextReachableEvent(targets, now) {
  let best = null;
  for (const { esporte, markets } of targets) {
    for (const file of ledger.listPartitions(esporte)) {
      const entries = ledger.loadPartitionFile(file);
      for (const entry of entries) {
        if (entry.resolutionStatus !== ledger.RESOLUTION_STATUS.PENDENTE) continue;
        if (entry.closingOdds !== null && entry.closingOdds !== undefined) continue;
        if (!markets[entry.market]) continue;

        const commence = new Date(entry.commenceTime).getTime();
        if (isNaN(commence)) continue;
        if (commence + CAPTURE_WINDOW_AFTER_MS < now) continue;
        if (commence - now > MAX_JOB_WAIT_MS + TARGET_LEAD_MS) continue;

        if (best === null || commence < best.commence) {
          best = { commence, esporte, player: entry.player, market: entry.market, side: entry.side, line: entry.line };
        }
      }
    }
  }
  return best;
}

// Dispara uma nova execução deste mesmo workflow via API do GitHub, pra
// continuar a cadeia a partir do evento seguinte. Usa GH_PAT (o mesmo token
// já usado pra git push nesta e nas outras execuções) — precisa ter escopo
// de disparar workflows (classic PAT com "workflow", ou fine-grained com
// "Actions: write"). Falha aqui não é fatal: só significa que a cadeia para
// e o cron (rede de segurança) retoma na próxima execução agendada.
async function triggerNextRun() {
  const pat = process.env.GH_PAT;
  const repo = process.env.GITHUB_REPOSITORY;
  const ref = process.env.GITHUB_REF_NAME || 'main';
  if (!pat || !repo) {
    console.warn('[cadeia] GH_PAT ou GITHUB_REPOSITORY ausente no ambiente — não dá pra disparar a próxima execução.');
    return false;
  }
  const url = `https://api.github.com/repos/${repo}/actions/workflows/capture_closing_odds.yml/dispatches`;
  try {
    await axios.post(url, { ref }, {
      headers: {
        Authorization: `Bearer ${pat}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
    return true;
  } catch (e) {
    console.warn(`[cadeia] falha ao disparar a próxima execução: ${e.response?.status || ''} ${e.response?.data?.message || e.message}`);
    return false;
  }
}

async function main() {
  if (!API_KEYS.length) {
    console.error('Nenhuma chave ODDS_API_KEY encontrada — abortando.');
    process.exit(1);
  }
  const requested = process.argv.slice(2).map(s => s.toLowerCase());
  const targets = requested.length ? SPORTS.filter(s => requested.some(r => s.esporte.includes(r))) : SPORTS;

  // Não capturar de imediato se o evento mais próximo alcançável ainda não
  // chegou no alvo de "poucos minutos antes do início" — espera aqui dentro
  // do job (sem chamar a API-de-odds nesse meio tempo) e só então segue pra
  // captura de verdade, que nesse momento pega tudo que já estiver dentro
  // da janela (o alvo original e qualquer outro que tenha entrado na janela
  // durante a espera — inclusive se o alvo em si começou nesse meio tempo).
  const target = findNextReachableEvent(targets, Date.now());
  if (target === null) {
    console.log('[espera] nenhuma indicação pendente sem odd de fechamento dentro do alcance da espera — encerra sem aguardar, retomada fica por conta do cron.');
  } else {
    const waitMs = Math.max(0, target.commence - TARGET_LEAD_MS - Date.now());
    const rotulo = `${target.esporte} ${target.player} ${target.market} ${target.side} ${target.line}`;
    if (waitMs > 0) {
      console.log(`[espera] evento alvo: ${rotulo} — começa às ${new Date(target.commence).toISOString()} — aguardando ${Math.round(waitMs / 60000)}min (acorda ~${Math.round(TARGET_LEAD_MS / 60000)}min antes do início).`);
      await sleep(waitMs);
    } else {
      console.log(`[espera] evento alvo: ${rotulo} — já dentro da janela de captura, capturando imediatamente.`);
    }
  }

  const totals = { capturadas: 0, semJanela: 0, semOddDisponivel: 0, partitionsChanged: 0 };
  for (const sport of targets) {
    const r = await captureSport(sport);
    for (const k of Object.keys(totals)) totals[k] += r[k];
  }
  console.log(`\nResumo geral: ${totals.capturadas} odd(s) de fechamento capturada(s), ${totals.partitionsChanged} partição(ões) atualizada(s).`);

  // Encadeamento: só dispara a próxima execução se sobrar indicação pendente
  // dentro do alcance da espera — senão a próxima execução acharia "nada no
  // alcance" e sairia sem fazer nada, gastando um run de Actions à toa. Sem
  // indicação nenhuma dentro do alcance, a cadeia termina aqui e a retomada
  // fica por conta do cron (rede de segurança).
  const next = findNextReachableEvent(targets, Date.now());
  if (next === null) {
    console.log('[cadeia] nenhuma indicação pendente dentro do alcance da espera após esta captura — não disparando a próxima execução; retomada fica por conta do cron.');
  } else {
    const minutosAteProximo = Math.round((next.commence - Date.now()) / 60000);
    const disparou = await triggerNextRun();
    console.log(`[cadeia] próximo evento alcançável em ${minutosAteProximo}min (${next.esporte} ${next.player} ${next.market}) — ${disparou ? 'próxima execução disparada.' : 'falha ao disparar — cadeia interrompida, cron retoma.'}`);
  }
}

main().catch(e => { console.error('Erro fatal em capture_closing_odds.js:', e); process.exit(1); });
