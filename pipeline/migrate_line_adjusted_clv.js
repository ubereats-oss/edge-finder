// pipeline/migrate_line_adjusted_clv.js
// Migração única: promove pra "capturada" (com clv = lineAdjustedClv) toda
// indicação já EXPIRADA cujo único motivo foi a linha ter mudado até o
// fechamento (closingOddsMissingReason: 'linha_mudou_ate_fechamento') e que
// tem adjustedClosingLine — ou seja, dava pra medir, só não tinha sido
// promovida porque capture_closing_odds.js calculava lineAdjustedClv mas
// nunca escrevia em clv nem tirava do estado expirado. Daqui pra frente
// capture_closing_odds.js já faz isso sozinho (ver applyClosingOddsToGroup);
// este script é só pra corrigir o que já tinha expirado antes dessa mudança.
//
// Também migra pra 'expirada' qualquer indicação sem closingOddsStatus
// (formato anterior a esse campo existir) cujo jogo já passou da janela de
// captura — não tem como recuperar CLV real pra essas (a captura nunca foi
// tentada), só dá pra fechar o estado em vez de deixar "pendente" pra
// sempre.
//
// Uso: node pipeline/migrate_line_adjusted_clv.js
// Roda local/manual, grava direto nos arquivos de odds_history/ já
// restaurados da branch data — quem chama decide como persistir (commit
// manual na branch data, mesmo fluxo dos workflows).

const fs = require('fs');
const ledger = require('./model_ledger');
const closingOddsRules = require('./closing_odds_rules');
const lineAdjustedClv = require('./line_adjusted_clv');

// Mesmo critério de "faz parte do rastreio de odd de fechamento" de
// isClosingOddsEligible, sem a parte de status (que é justamente o que
// estamos corrigindo) — só pra não migrar entrada que nunca foi elegível
// pra isso (ex.: hasModelProb:false, mercado fora de SPORT_MARKET_KEYS).
function isTrackableSegment(entry) {
  if (entry.hasModelProb === false || entry.validForCalibration === false) return false;
  const markets = closingOddsRules.SPORT_MARKET_KEYS[entry.esporte];
  return !!markets && markets.includes(entry.market);
}

function main() {
  const now = Date.now();
  const stats = { promovidas: 0, naoRecuperaveis: 0, statusMigrado: 0, filesChanged: 0 };

  for (const file of ledger.listAllPartitions()) {
    const entries = ledger.loadPartitionFile(file);
    const before = JSON.stringify(entries);

    for (const entry of entries) {
      if (!isTrackableSegment(entry)) continue;
      const status = ledger.closingOddsStatusOf(entry);

      // 1) Expirada por mudança de linha, mas recuperável via ajuste.
      if (status === ledger.CLOSING_ODDS_STATUS.EXPIRADA && typeof entry.clv !== 'number') {
        if (entry.adjustedClosingLine != null && entry.adjustedClosingOverOdds && entry.adjustedClosingUnderOdds) {
          const closing = {
            line: entry.adjustedClosingLine,
            overOdds: entry.adjustedClosingOverOdds,
            underOdds: entry.adjustedClosingUnderOdds,
          };
          const valor = typeof entry.lineAdjustedClv === 'number'
            ? entry.lineAdjustedClv
            : lineAdjustedClv.adjustedClv(entry, closing);
          if (valor !== null) {
            entry.lineAdjustedClv = valor;
            entry.clv = valor;
            entry.clvAjustadoPorLinha = true;
            entry.closingOddsStatus = ledger.CLOSING_ODDS_STATUS.CAPTURADA;
            entry.closingOddsMissingReason = null;
            entry.closingOddsAvailableLines = null;
            stats.promovidas++;
          } else {
            stats.naoRecuperaveis++;
          }
        }
      }

      // 2) Sem closingOddsStatus (formato antigo) e já passou da janela —
      // fecha o estado como expirada (sem dado pra recuperar).
      if (!entry.closingOddsStatus) {
        const commence = new Date(entry.commenceTime).getTime();
        const jaPassou = !isNaN(commence) && (commence + ledger.CLOSING_ODDS_CAPTURE_WINDOW_AFTER_MS) < now;
        const semClosingOdds = entry.closingOdds === null || entry.closingOdds === undefined;
        if (jaPassou && semClosingOdds) {
          entry.closingOddsStatus = ledger.CLOSING_ODDS_STATUS.EXPIRADA;
          stats.statusMigrado++;
        }
      }
    }

    if (JSON.stringify(entries) !== before) {
      ledger.savePartitionFile(file, entries);
      stats.filesChanged++;
    }
  }

  console.log(JSON.stringify(stats, null, 2));
}

main();
