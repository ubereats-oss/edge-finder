// pipeline/settle_model_ledger.js
// Segundo processo do histórico central de indicações: busca o resultado real
// (via ESPN) de cada indicação ainda pendente no model_ledger e grava o valor
// estatístico realizado, o resultado (ganhou/perdeu/push/cancelado) e a data
// de apuração. Indicações sem resultado disponível ainda continuam pendentes
// e são reprocessadas na próxima execução, até um limite de tentativas.
//
// Uso: node pipeline/settle_model_ledger.js [esporte1 esporte2 ...]
// Sem argumentos, apura os 4 esportes com props (nhl, nfl, nba, mlb).

const https = require('https');
const fs = require('fs');
const ledger = require('./model_ledger');

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

function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, r => {
      let d = '';
      r.on('data', c => d += c);
      r.on('end', () => {
        try { resolve(JSON.parse(d)); } catch (e) { reject(new Error(`JSON parse error: ${d.slice(0, 200)}`)); }
      });
    }).on('error', reject);
  });
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

// Acha o evento ESPN que corresponde ao "game" salvo na indicação ('Home x Away'),
// testando o dia do commenceTime e o dia seguinte/anterior (fuso horário).
async function findEspnEvent(espnSport, commenceTime, game) {
  const gameNorm = (game || '').toLowerCase();
  const base = new Date(commenceTime);
  for (const offsetDays of [0, 1, -1]) {
    const d = new Date(base.getTime() + offsetDays * 24 * 60 * 60 * 1000);
    const scoreboard = await getScoreboard(espnSport, toYyyymmdd(d));
    for (const event of scoreboard.events || []) {
      const teams = event.competitions?.[0]?.competitors?.map(c => lastWord(c.team?.displayName)) || [];
      if (teams.some(t => t && gameNorm.includes(t))) return event;
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
  const lastNeedle = lastWord(playerNeedle);
  return displayName.toLowerCase().includes(lastNeedle);
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
    passYards:      (box, p) => findFlatStat(box, p, ['YDS'], 'passing'),
    passTDs:        (box, p) => findFlatStat(box, p, ['TD'], 'passing'),
    rushYards:      (box, p) => findFlatStat(box, p, ['YDS'], 'rushing'),
    receptions:     (box, p) => findFlatStat(box, p, ['REC'], 'receiving'),
    receptionYards: (box, p) => findFlatStat(box, p, ['YDS'], 'receiving'),
  },
};

// Procura o jogador nos grupos de estatística do boxscore e devolve o valor
// numérico da(s) coluna(s) `labelCandidates`. `groupFilter` (string ou array)
// filtra por `statGroup.type` (MLB) ou `statGroup.name` (NHL/NFL) quando o
// mesmo label aparece em mais de um grupo (ex.: 'H' em batting e pitching,
// 'YDS' em passing/rushing/receiving).
function findFlatStat(box, playerNeedle, labelCandidates, groupFilter) {
  const allowed = groupFilter == null ? null : (Array.isArray(groupFilter) ? groupFilter : [groupFilter]);
  const teams = box.boxscore?.players || [];
  for (const team of teams) {
    for (const group of team.statistics || []) {
      if (allowed && !allowed.includes(group.type) && !allowed.includes(group.name)) continue;
      const labels = group.labels || [];
      const idx = labelCandidates.map(l => labels.indexOf(l)).find(i => i >= 0);
      if (idx === undefined) continue;
      for (const athlete of group.athletes || []) {
        const name = athlete.athlete?.displayName || '';
        if (!nameMatches(name, playerNeedle)) continue;
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
function playerAppearsInBox(box, playerNeedle) {
  const teams = box.boxscore?.players || [];
  for (const team of teams) {
    for (const group of team.statistics || []) {
      for (const athlete of group.athletes || []) {
        if (nameMatches(athlete.athlete?.displayName || '', playerNeedle)) return true;
      }
    }
  }
  return false;
}

function gradeResult(value, line, side) {
  if (value === line) return ledger.RESULT_STATUS.PUSH;
  const over = value > line;
  const won = side === 'Over' ? over : !over;
  return won ? ledger.RESULT_STATUS.GANHOU : ledger.RESULT_STATUS.PERDEU;
}

async function settleSport({ esporte, espnSport }) {
  const grace = GRACE_MS[esporte] ?? 4 * 60 * 60 * 1000;
  const now = Date.now();
  const partitions = ledger.listPartitions(esporte);

  let apurados = 0, canceladas = 0, aindaPendentes = 0, naoApuraveis = 0, partitionsChanged = 0;

  for (const file of partitions) {
    const entries = JSON.parse(fs.readFileSync(file, 'utf-8'));
    let changed = false;

    for (const entry of entries) {
      if (entry.resolutionStatus !== ledger.RESOLUTION_STATUS.PENDENTE) continue;

      const commence = new Date(entry.commenceTime).getTime();
      if (isNaN(commence) || now - commence < grace) { aindaPendentes++; continue; }

      const extractor = EXTRACTORS[esporte]?.[entry.market];
      if (!extractor) { aindaPendentes++; continue; } // mercado sem apuração automática configurada

      try {
        const event = await findEspnEvent(espnSport, entry.commenceTime, entry.game);
        if (!event) {
          entry.resolutionAttempts = (entry.resolutionAttempts || 0) + 1;
          if (entry.resolutionAttempts >= ledger.MAX_RESOLUTION_ATTEMPTS) {
            entry.resolutionStatus = ledger.RESOLUTION_STATUS.NAO_APURAVEL;
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
            entry.resolutionStatus = ledger.RESOLUTION_STATUS.NAO_APURAVEL;
            naoApuraveis++;
          } else {
            aindaPendentes++;
          }
          changed = true;
          continue;
        }

        const summary = await getSummary(espnSport, event.id);
        await sleep(250);
        const value = extractor(summary, entry.player);

        if (value === null) {
          if (playerAppearsInBox(summary, entry.player)) {
            // Apareceu no boxscore mas sem a coluna esperada — tenta de novo depois.
            entry.resolutionAttempts = (entry.resolutionAttempts || 0) + 1;
            if (entry.resolutionAttempts >= ledger.MAX_RESOLUTION_ATTEMPTS) {
              entry.resolutionStatus = ledger.RESOLUTION_STATUS.NAO_APURAVEL;
              naoApuraveis++;
            } else {
              aindaPendentes++;
            }
          } else {
            // Jogo final e jogador não aparece em nenhum grupo: não jogou/riscado.
            entry.result = { status: ledger.RESULT_STATUS.CANCELADO, valorReal: null, apuradoEm: new Date().toISOString(), motivo: 'jogador_nao_jogou' };
            entry.resolutionStatus = ledger.RESOLUTION_STATUS.RESOLVIDO;
            canceladas++;
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
        entry.resolutionAttempts = (entry.resolutionAttempts || 0) + 1;
        if (entry.resolutionAttempts >= ledger.MAX_RESOLUTION_ATTEMPTS) {
          entry.resolutionStatus = ledger.RESOLUTION_STATUS.NAO_APURAVEL;
          naoApuraveis++;
        } else {
          aindaPendentes++;
        }
        changed = true;
        console.warn(`  Erro apurando ${entry.player} (${entry.market}): ${e.message}`);
      }

      await sleep(150);
    }

    if (changed) {
      fs.writeFileSync(file, JSON.stringify(entries, null, 2));
      partitionsChanged++;
    }
  }

  console.log(`[${esporte}] apuradas: ${apurados} | canceladas/void: ${canceladas} | ainda pendentes: ${aindaPendentes} | não apuráveis: ${naoApuraveis} | partições atualizadas: ${partitionsChanged}`);
  return { apurados, canceladas, aindaPendentes, naoApuraveis, partitionsChanged };
}

async function main() {
  const requested = process.argv.slice(2).map(s => s.toLowerCase());
  const targets = requested.length
    ? SPORTS.filter(s => requested.some(r => s.esporte.includes(r)))
    : SPORTS;

  const totals = { apurados: 0, canceladas: 0, aindaPendentes: 0, naoApuraveis: 0, partitionsChanged: 0 };
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
    `${totals.aindaPendentes} continuam em aberto | ${totals.naoApuraveis} marcadas como não apuráveis nesta execução.`
  );
}

main().catch(e => { console.error('Erro fatal em settle_model_ledger.js:', e); process.exit(1); });
