// pipeline/revert_line_adjusted_clv_promotion.js
// Desfaz a promoção feita por migrate_line_adjusted_clv.js (e pelo caminho
// ao vivo de capture_closing_odds.js antes desta correção): o CLV ajustado
// por linha (lineAdjustedClv) se mostrou pouco confiável em amostra pequena
// de jogador (ver pipeline/report_clv_line_adjustment_audit.js) — não deve
// entrar em clv nem contar como capturada. lineAdjustedClv continua gravado
// (campo separado, só informativo), mas a indicação volta a expirar
// normalmente se não teve odd de fechamento exata.
//
// Não mexe nos registros fechados como 'expirada' por falta de
// closingOddsStatus (migração separada, não relacionada a isso).
//
// Uso: node pipeline/revert_line_adjusted_clv_promotion.js

const ledger = require('./model_ledger');

function main() {
  const stats = { revertidas: 0, filesChanged: 0 };

  for (const file of ledger.listAllPartitions()) {
    const entries = ledger.loadPartitionFile(file);
    const before = JSON.stringify(entries);

    for (const entry of entries) {
      if (entry.clvAjustadoPorLinha !== true) continue;
      entry.clv = null;
      entry.closingOddsStatus = ledger.CLOSING_ODDS_STATUS.EXPIRADA;
      entry.closingOddsMissingReason = 'linha_mudou_ate_fechamento';
      delete entry.clvAjustadoPorLinha;
      stats.revertidas++;
    }

    if (JSON.stringify(entries) !== before) {
      ledger.savePartitionFile(file, entries);
      stats.filesChanged++;
    }
  }

  console.log(JSON.stringify(stats, null, 2));
}

main();
