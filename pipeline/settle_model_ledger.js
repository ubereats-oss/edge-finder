// pipeline/settle_model_ledger.js
// Segundo processo do histórico central de indicações: busca o resultado real
// (via ESPN) de cada indicação ainda pendente no model_ledger e grava o valor
// estatístico realizado, o resultado (ganhou/perdeu/push/cancelado) e a data
// de apuração. Indicações sem resultado disponível ainda continuam pendentes
// e são reprocessadas na próxima execução, até um limite de tentativas.
//
// Uso: node pipeline/settle_model_ledger.js [esporte1 esporte2 ...]
// Sem argumentos, apura os 4 esportes com props (nhl, nfl, nba, mlb).

const axios = require('axios');
const fs = require('fs');
const ledger = require('./model_ledger');

function readJsonSafe(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

const PLAYER_TEAM_BY_SPORT = {
  'americanfootball/nfl': readJsonSafe('nfl_player_team.json', {}),
};

const PLAYER_NOT_FOUND_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

const SPORTS = [
  { esporte: 'basketball/nba', espnSport: 'basketball/nba' },
  { esporte: 'baseball/mlb',   espnSport: 'baseball/mlb' },
  { esporte: 'hockey/nhl',     espnSport: 'hockey/nhl' },
  { esporte: 'americanfootball/nfl', espnSport: 'football/nfl' },
];

// Tempo mínimo após o início do evento antes de tentar apurar (dá tempo do
// jogo terminar e a ESPN publicar o boxscore).
const GRACE_MS = {
  'basketball/nba': 4 * 60 * 60 * 1000,
  'baseball/mlb':   5 * 60 * 60 * 1000,
  'hockey/nhl':     4 * 60 * 60 * 1000,
  'americanfootball/nfl': 6 * 60 * 60 * 1000,
};

// Mesmo cliente e mesmos cabeçalhos (nenhum customizado) dos demais scripts
// do pipeline que chamam a ESPN (get_nba_player_stats.js, get_mlb_player_stats.js
// etc.). https.get() com User-Agent de navegador levava Access Denied da ESPN
// quando rodado no GitHub Actions — axios.get() sem headers customizados não.
async function get(url) {
  const res = await axios.get(url, { timeout: 15000 });
  if (!res.data || typeof res.data !== 'object') {
    throw new Error(`Resposta inesperada da ESPN (não é JSON): ${url}`);
  }
  return res.data;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function getScoreboard(espnSport, yyyymmdd) {
  return get(`https://site.api.espn.com/apis/site/v2/sports/${espnSport}/scoreboard?dates=${yyyymmdd}`);
}

async function getSummary(espnSport, eventId) {
  return get(`https://site.api.espn.com/apis/site/v2/sports/${espnSport}/summary?event=${eventId}`);
}

function toYyyymmdd(date) {
  return date.toISOString().slice(0, 10).replace(/-/g, '');
}

function lastWord(s) {
  return (s || '').toLowerCase().trim().split(' ').slice(-1)[0];
}

function normalizeText(s) {
  return (s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\b(jr|sr|ii|iii|iv|v)\.?\b/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function gameTeamNeedles(game) {
  return (game || '')
    .split(/\s+x\s+|\s+@\s+|\s+vs\.?\s+/i)
    .map(normalizeText)
    .filter(Boolean);
}

function teamMatchesGame(teamName, gameNeedle) {
  const team = normalizeText(teamName);
  if (!team || !gameNeedle) return false;
  return team === gameNeedle || team.includes(gameNeedle) || gameNeedle.includes(team) || lastWord(team) === lastWord(gameNeedle);
}

// Acha o evento ESPN que corresponde ao "game" salvo na indicação ('Home x Away'),
// testando o dia do commenceTime e o dia seguinte/anterior (fuso horário).
async function findEspnEvent(espnSport, commenceTime, game) {
  const gameNeedles = gameTeamNeedles(game);
  const base = new Date(commenceTime);
  for (const offsetDays of [0, 1, -1]) {
    const d = new Date(base.getTime() + offsetDays * 24 * 60 * 60 * 1000);
    const scoreboard = await getScoreboard(espnSport, toYyyymmdd(d));
    for (const event of scoreboard.events || []) {
      const teams = event.competitions?.[0]?.competitors?.map(c => c.team?.displayName || '') || [];
      const matched = gameNeedles.filter(needle => teams.some(team => teamMatchesGame(team, needle))).length;
      if (matched >= Math.min(2, gameNeedles.length)) return event;
    }
  }
  return null;
}

function statusName(event) {
  return event?.status?.type?.name || event?.competitions?.[0]?.status?.type?.name || '';
}

function isFinal(status) { return status === 'STATUS_FINAL'; }
function isVoidStatus(status) {
  return status === 'STATUS_POSTPONED' || status === 'STATUS_CANCELED' || status === 'STATUS_ABANDONED';
}

function nameMatches(displayName, playerNeedle) {
  if (!displayName) return false;
  const display = normalizeText(displayName);
  const needle = normalizeText(playerNeedle);
  const lastNeedle = lastWord(needle);
  return display === needle || display.includes(needle) || needle.includes(display) || display.split(' ').includes(lastNeedle);
}

// Extratores por esporte/mercado. Cada um recebe o boxscore (resposta de
// /summary) e o nome do jogador, e devolve o valor estatístico ou null se o
// jogador não aparecer em nenhum grupo relevante (indício de DNP/riscado).
const EXTRACTORS = {
  'basketball/nba': {
    points:   (box, p) => findFlatStat(box, p, ['PTS']),
    rebounds: (box, p) => findFlatStat(box, p, ['REB']),
    assists:  (box, p) => findFlatStat(box, p, ['AST']),
    steals:   (box, p) => findFlatStat(box, p, ['STL']),
    threes:   (box, p) => findMadeAttempted(box, p, '3PT'),
  },
  'baseball/mlb': {
    hits:        (box, p) => findFlatStat(box, p, ['H'], 'batting'),
    strikeouts:  (box, p) => findFlatStat(box, p, ['K'], 'pitching'),
    hitsAllowed: (box, p) => findFlatStat(box, p, ['H'], 'pitching'),
  },
  'hockey/nhl': {
    goals:   (box, p) => findFlatStat(box, p, ['G'], ['forwards', 'defenses']),
    assists: (box, p) => findFlatStat(box, p, ['A'], ['forwards', 'defenses']),
    shots:   (box, p) => findFlatStat(box, p, ['SOG'], ['forwards', 'defenses']),
    blocked: (box, p) => findFlatStat(box, p, ['BS'], ['forwards', 'defenses']),
    points:  (box, p) => {
      const g = findFlatStat(box, p, ['G'], ['forwards', 'defenses']);
      const a = findFlatStat(box, p, ['A'], ['forwards', 'defenses']);
      return (g === null || a === null) ? null : g + a;
    },
  },
  'americanfootball/nfl': {
    passYards:      (box, p, entry) => findFlatStat(box, p, ['YDS'], 'passing', expectedPlayerTeam(entry)),
    passTDs:        (box, p, entry) => findFlatStat(box, p, ['TD'], 'passing', expectedPlayerTeam(entry)),
    rushYards:      (box, p, entry) => findFlatStat(box, p, ['YDS'], 'rushing', expectedPlayerTeam(entry)),
    receptions:     (box, p, entry) => findFlatStat(box, p, ['REC'], 'receiving', expectedPlayerTeam(entry)),
    receptionYards: (box, p, entry) => findFlatStat(box, p, ['YDS'], 'receiving', expectedPlayerTeam(entry)),
  },
};

function expectedPlayerTeam(entry) {
  return entry.playerTeam ?? PLAYER_TEAM_BY_SPORT[entry.esporte]?.[entry.player] ?? null;
}

function athleteNameMatches(name, playerNeedle, teamName, expectedTeam, teamAthletes) {
  const display = normalizeText(name);
  const needle = normalizeText(playerNeedle);
  if (display === needle || display.includes(needle) || needle.includes(display)) return true;
  if (!expectedTeam || !teamMatchesGame(teamName, expectedTeam)) return false;
  const lastNeedle = lastWord(normalizeText(playerNeedle));
  if (!lastNeedle) return false;
  const matches = teamAthletes.filter(a => lastWord(normalizeText(a)) === lastNeedle);
  return matches.length === 1 && normalizeText(matches[0]) === normalizeText(name);
}

function teamAthleteNames(team) {
  const names = [];
  for (const group of team.statistics || []) {
    for (const athlete of group.athletes || []) {
      const name = athlete.athlete?.displayName;
      if (name) names.push(name);
    }
  }
  return [...new Set(names)];
}

// Procura o jogador nos grupos de estatística do boxscore e devolve o valor
// numérico da(s) coluna(s) `labelCandidates`. `groupFilter` (string ou array)
// filtra por `statGroup.type` (MLB) ou `statGroup.name` (NHL/NFL) quando o
// mesmo label aparece em mais de um grupo (ex.: 'H' em batting e pitching,
// 'YDS' em passing/rushing/receiving).
function findFlatStat(box, playerNeedle, labelCandidates, groupFilter, expectedTeam) {
  const allowed = groupFilter == null ? null : (Array.isArray(groupFilter) ? groupFilter : [groupFilter]);
  const teams = box.boxscore?.players || [];
  for (const team of teams) {
    const teamName = team.team?.displayName || team.team?.name || team.team?.abbreviation || '';
    const namesOnTeam = teamAthleteNames(team);
    for (const group of team.statistics || []) {
      if (allowed && !allowed.includes(group.type) && !allowed.includes(group.name)) continue;
      const labels = group.labels || [];
      const idx = labelCandidates.map(l => labels.indexOf(l)).find(i => i >= 0);
      if (idx === undefined) continue;
      for (const athlete of group.athletes || []) {
        const name = athlete.athlete?.displayName || '';
        if (!athleteNameMatches(name, playerNeedle, teamName, expectedTeam, namesOnTeam)) continue;
        const val = parseFloat(athlete.stats?.[idx]);
        if (!isNaN(val)) return val;
      }
    }
  }
  return null;
}

// Campos tipo "12-22" (feitos-tentados) — devolve só o "feitos".
function findMadeAttempted(box, playerNeedle, label) {
  const teams = box.boxscore?.players || [];
  for (const team of teams) {
    for (const group of team.statistics || []) {
      const idx = (group.labels || []).indexOf(label);
      if (idx === -1) continue;
      for (const athlete of group.athletes || []) {
        const name = athlete.athlete?.displayName || '';
        if (!nameMatches(name, playerNeedle)) continue;
        const raw = athlete.stats?.[idx];
        const made = parseFloat((raw || '').split('-')[0]);
        if (!isNaN(made)) return made;
      }
    }
  }
  return null;
}

// Alguém apareceu no boxscore (em qualquer grupo)? Usado só pra decidir entre
// "jogador não jogou" (cancelado) e "coluna/valor indisponível" (tentativa).
function playerAppearsInBox(box, playerNeedle, expectedTeam) {
  const teams = box.boxscore?.players || [];
  for (const team of teams) {
    const teamName = team.team?.displayName || team.team?.name || team.team?.abbreviation || '';
    const namesOnTeam = teamAthleteNames(team);
    for (const group of team.statistics || []) {
      for (const athlete of group.athletes || []) {
        if (athleteNameMatches(athlete.athlete?.displayName || '', playerNeedle, teamName, expectedTeam, namesOnTeam)) return true;
      }
    }
  }
  return false;
}

function setNotResolvable(entry, reason, evidence) {
  entry.resolutionStatus = ledger.RESOLUTION_STATUS.NAO_APURAVEL;
  entry.resolutionFailureReason = reason;
  entry.resolutionFailureEvidence = evidence ?? null;
}

function summarizeCounter(bucket, market, reason) {
  if (!bucket[market]) bucket[market] = {};
  bucket[market][reason] = (bucket[market][reason] || 0) + 1;
}

function gradeResult(value, line, side) {
  if (value === line) return ledger.RESULT_STATUS.PUSH;
  const over = value > line;
  const won = side === 'Over' ? over : !over;
  return won ? ledger.RESULT_STATUS.GANHOU : ledger.RESULT_STATUS.PERDEU;
}

function teamNameMatches(displayName, teamNeedle) {
  if (!displayName || !teamNeedle) return false;
  const display = displayName.toLowerCase();
  const needle = teamNeedle.toLowerCase();
  return display === needle || display.includes(needle) || needle.includes(display) || lastWord(displayName) === lastWord(teamNeedle);
}

function h2hResultStatus(event, selectedTeam) {
  const competitors = event?.competitions?.[0]?.competitors || [];
  const selected = competitors.find(c => teamNameMatches(c.team?.displayName, selectedTeam));
  if (!selected) return null;
  if (selected.winner === true) return ledger.RESULT_STATUS.GANHOU;
  if (selected.winner === false) return ledger.RESULT_STATUS.PERDEU;

  const selectedScore = parseFloat(selected.score);
  const otherScores = competitors
    .filter(c => c !== selected)
    .map(c => parseFloat(c.score))
    .filter(v => !isNaN(v));
  if (isNaN(selectedScore) || !otherScores.length) return null;
  const bestOther = Math.max(...otherScores);
  if (selectedScore === bestOther) return ledger.RESULT_STATUS.PUSH;
  return selectedScore > bestOther ? ledger.RESULT_STATUS.GANHOU : ledger.RESULT_STATUS.PERDEU;
}

async function settleSport({ esporte, espnSport }) {
  const grace = GRACE_MS[esporte] ?? 4 * 60 * 60 * 1000;
  const now = Date.now();
  const partitions = ledger.listPartitions(esporte);

  let apurados = 0, canceladas = 0, aindaPendentes = 0, naoApuraveis = 0, partitionsChanged = 0, falhasAcesso = 0, closingOddsExpiradas = 0;
  const semExtratorPorMercado = {};
  const naoApuravelPorMercado = {};

  for (const file of partitions) {
    const entries = JSON.parse(fs.readFileSync(file, 'utf-8'));
    let changed = false;

    for (const entry of entries) {
      const shouldReprocessLegacyNotResolvable =
        entry.resolutionStatus === ledger.RESOLUTION_STATUS.NAO_APURAVEL && !entry.resolutionFailureReason;
      if (entry.resolutionStatus !== ledger.RESOLUTION_STATUS.PENDENTE && !shouldReprocessLegacyNotResolvable) continue;

      // Expira o rastreio de odd de fechamento (campo independente de
      // resolutionStatus) pra quem já passou da janela de captura sem
      // sucesso — antes da checagem de grace/apuração abaixo, pra rodar em
      // toda indicação em aberto nesta varredura periódica, mesmo nas que
      // ainda não chegaram no prazo de apuração de resultado.
      if (ledger.maybeExpireClosingOdds(entry, now)) {
        changed = true;
        closingOddsExpiradas++;
      }

      const commence = new Date(entry.commenceTime).getTime();
      if (isNaN(commence) || now - commence < grace) { aindaPendentes++; continue; }

      const extractor = EXTRACTORS[esporte]?.[entry.market];
      if (entry.market !== 'h2h' && !extractor) {
        aindaPendentes++;
        summarizeCounter(semExtratorPorMercado, entry.market || 'sem_market', 'sem_extrator');
        continue;
      }

      try {
        const event = await findEspnEvent(espnSport, entry.commenceTime, entry.game);
        if (!event) {
          entry.resolutionAttempts = (entry.resolutionAttempts || 0) + 1;
          if (entry.resolutionAttempts >= ledger.MAX_RESOLUTION_ATTEMPTS) {
            setNotResolvable(entry, 'jogo_nao_encontrado_espn', { game: entry.game, commenceTime: entry.commenceTime });
            summarizeCounter(naoApuravelPorMercado, entry.market, entry.resolutionFailureReason);
            naoApuraveis++;
          } else {
            aindaPendentes++;
          }
          changed = true;
          continue;
        }

        const status = statusName(event);

        if (isVoidStatus(status)) {
          entry.result = { status: ledger.RESULT_STATUS.CANCELADO, valorReal: null, apuradoEm: new Date().toISOString(), motivo: 'evento_adiado_ou_cancelado' };
          entry.resolutionStatus = ledger.RESOLUTION_STATUS.RESOLVIDO;
          changed = true; canceladas++;
          continue;
        }

        if (!isFinal(status)) {
          entry.resolutionAttempts = (entry.resolutionAttempts || 0) + 1;
          if (entry.resolutionAttempts >= ledger.MAX_RESOLUTION_ATTEMPTS) {
            setNotResolvable(entry, 'status_nao_final', { espnEventId: event.id, status });
            summarizeCounter(naoApuravelPorMercado, entry.market, entry.resolutionFailureReason);
            naoApuraveis++;
          } else {
            aindaPendentes++;
          }
          changed = true;
          continue;
        }

        if (entry.market === 'h2h') {
          const statusResult = h2hResultStatus(event, entry.player);
          if (statusResult === null) {
            entry.resolutionAttempts = (entry.resolutionAttempts || 0) + 1;
            if (entry.resolutionAttempts >= ledger.MAX_RESOLUTION_ATTEMPTS) {
              setNotResolvable(entry, 'time_nao_encontrado_no_evento', { espnEventId: event.id, team: entry.player });
              summarizeCounter(naoApuravelPorMercado, entry.market, entry.resolutionFailureReason);
              naoApuraveis++;
            } else {
              aindaPendentes++;
            }
            changed = true;
            continue;
          }
          entry.result = {
            status: statusResult,
            valorReal: entry.player,
            apuradoEm: new Date().toISOString(),
          };
          entry.resolutionStatus = ledger.RESOLUTION_STATUS.RESOLVIDO;
          changed = true;
          apurados++;
          continue;
        }

        const summary = await getSummary(espnSport, event.id);
        await sleep(250);
        const value = extractor(summary, entry.player, entry);

        if (value === null) {
          const expectedTeam = expectedPlayerTeam(entry);
          if (playerAppearsInBox(summary, entry.player, expectedTeam)) {
            // NFL/ESPN omite grupos/colunas zeradas para alguns jogadores
            // (ex.: recebedor sem recepção, QB sem corrida). Se o jogador
            // apareceu no boxscore e o jogo terminou, o realizado do prop é 0.
            entry.result = {
              status: gradeResult(0, entry.line, entry.side),
              valorReal: 0,
              apuradoEm: new Date().toISOString(),
              motivo: 'estatistica_zerada_no_boxscore',
            };
            entry.resolutionStatus = ledger.RESOLUTION_STATUS.RESOLVIDO;
            apurados++;
          } else {
            // Ausência no boxscore não prova inativo/DNP: pode ser grafia,
            // sufixo ou origem de odds desalinhada. Mantém pendente até haver
            // uma fonte explícita de inativo/fora do jogo.
            entry.resolutionStatus = ledger.RESOLUTION_STATUS.PENDENTE;
            entry.result = null;
            entry.resolutionFailureReason = 'jogador_nao_encontrado';
            entry.resolutionFailureEvidence = { espnEventId: event.id, player: entry.player, market: entry.market, expectedTeam };
            if (Date.now() - commence >= PLAYER_NOT_FOUND_MAX_AGE_MS) {
              setNotResolvable(entry, 'jogador_nao_encontrado', entry.resolutionFailureEvidence);
              summarizeCounter(naoApuravelPorMercado, entry.market, entry.resolutionFailureReason);
              naoApuraveis++;
            } else {
              aindaPendentes++;
            }
          }
          changed = true;
          continue;
        }

        entry.result = {
          status: gradeResult(value, entry.line, entry.side),
          valorReal: value,
          apuradoEm: new Date().toISOString(),
        };
        entry.resolutionStatus = ledger.RESOLUTION_STATUS.RESOLVIDO;
        changed = true;
        apurados++;
      } catch (e) {
        // Toda exceção aqui vem de get() (getScoreboard/getSummary), ou seja, é
        // falha de acesso/rede à ESPN (timeout, HTTP não-2xx, resposta não-JSON),
        // nunca ausência real de dado — essa é sempre detectada sem lançar
        // exceção (event === null, status não final, extractor === null acima).
        // Falha de acesso não consome tentativa nem leva a não_apuravel: a
        // indicação continua pendente e é reapurada na próxima execução, sem
        // prazo de validade.
        falhasAcesso++;
        aindaPendentes++;
        console.warn(`  Falha de acesso à ESPN apurando ${entry.player} (${entry.market}): ${e.message}`);
      }

      await sleep(150);
    }

    if (changed) {
      fs.writeFileSync(file, JSON.stringify(entries, null, 2));
      partitionsChanged++;
    }
  }

  console.log(`[${esporte}] apuradas: ${apurados} | canceladas/void: ${canceladas} | ainda pendentes: ${aindaPendentes} | não apuráveis: ${naoApuraveis} | odd de fechamento expirada: ${closingOddsExpiradas} | falhas de acesso à ESPN: ${falhasAcesso} | partições atualizadas: ${partitionsChanged}`);
  if (Object.keys(semExtratorPorMercado).length) {
    console.log(`[${esporte}] pendentes sem extrator por mercado: ${JSON.stringify(semExtratorPorMercado)}`);
  }
  if (Object.keys(naoApuravelPorMercado).length) {
    console.log(`[${esporte}] novas não apuráveis por mercado/motivo: ${JSON.stringify(naoApuravelPorMercado)}`);
  }
  return { apurados, canceladas, aindaPendentes, naoApuraveis, partitionsChanged, falhasAcesso, closingOddsExpiradas };
}

async function main() {
  const requested = process.argv.slice(2).map(s => s.toLowerCase());
  const targets = requested.length
    ? SPORTS.filter(s => requested.some(r => s.esporte.includes(r)))
    : SPORTS;

  const totals = { apurados: 0, canceladas: 0, aindaPendentes: 0, naoApuraveis: 0, partitionsChanged: 0, falhasAcesso: 0, closingOddsExpiradas: 0 };
  for (const sport of targets) {
    console.log(`Apurando resultados: ${sport.esporte}...`);
    const r = await settleSport(sport);
    for (const k of Object.keys(totals)) totals[k] += r[k];
  }

  // "Apuradas" = saíram de pendente com um resultado definido (ganhou/perdeu/push/cancelado).
  // Não inclui "não apuráveis", que é desistência, não apuração.
  const transicionadas = totals.apurados + totals.canceladas;
  console.log(
    `\nResumo geral: ${totals.partitionsChanged} partição(ões) de odds_history atualizada(s) | ` +
    `${transicionadas} indicação(ões) passaram de em aberto para apuradas ` +
    `(${totals.apurados} com resultado ganhou/perdeu/push, ${totals.canceladas} canceladas/void) | ` +
    `${totals.aindaPendentes} continuam em aberto | ${totals.naoApuraveis} marcadas como não apuráveis nesta execução | ` +
    `${totals.closingOddsExpiradas} tiveram a odd de fechamento expirada (janela de captura passou sem sucesso)` +
    `${totals.falhasAcesso ? ` | ${totals.falhasAcesso} falha(s) de acesso à ESPN nesta execução (não contam como tentativa)` : ''}.`
  );
}

main().catch(e => { console.error('Erro fatal em settle_model_ledger.js:', e); process.exit(1); });
