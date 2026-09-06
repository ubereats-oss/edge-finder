// pipeline/reprocess_ledger_history.js
// Reprocessa o histórico central de indicações já existente, aplicando:
//  1. Correção de push/void: se o valor real bate exatamente com a linha,
//     o resultado é 'push' (nunca derrota), mesmo que tenha sido gravado
//     como ganhou/perdeu por engano em algum momento.
//  2. Invalidação retroativa das apostas de NHL registradas antes da
//     correção da agregação de odds entre casas (NHL_ODDS_FIX_CUTOFF em
//     risk_config.js) — ficam de fora da calibração e das estatísticas de
//     acerto por segmento, mas continuam visíveis no histórico e no lucro.
//  3. Deduplicação defensiva por chave (evento+jogador+mercado+linha+lado) —
//     o ledger já faz upsert por chave em condições normais; isto é só uma
//     rede de segurança caso algum arquivo tenha sido editado manualmente.
//  4. Migração de esquema: garante que todo registro tenha os campos novos
//     (rawProb, segmentState, sampleSize, validForCalibration, invalidReason,
//     closingOdds, clv) mesmo que tenha sido gravado antes deles existirem.
//
// Idempotente — pode ser rodado quantas vezes for preciso, sem duplicar nem
// desfazer nada. Não corrige nada além do listado acima.
//
// Uso: node pipeline/reprocess_ledger_history.js

const ledger = require('./model_ledger');
const riskConfig = require('./risk_config');

function main() {
  const files = ledger.listAllPartitions();
  if (!files.length) {
    console.log('Nenhuma partição de odds_history encontrada — nada a reprocessar.');
    return;
  }

  const cutoff = new Date(riskConfig.NHL_ODDS_FIX_CUTOFF).getTime();
  let totalEntradas = 0, totalDedup = 0, totalPushCorrigido = 0, totalNhlInvalidado = 0, totalMigrado = 0, arquivosAlterados = 0;

  for (const file of files) {
    const entries = ledger.loadPartitionFile(file);
    if (!entries.length) continue;

    const byKey = new Map();
    let changed = false;

    for (const entry of entries) {
      totalEntradas++;

      // 1) Dedup defensivo — mantém a última ocorrência da mesma chave.
      if (byKey.has(entry._key)) {
        totalDedup++;
        changed = true;
      }

      // 2) Push/void: valor real igual à linha nunca é derrota nem vitória.
      if (entry.result && typeof entry.result.valorReal === 'number' && entry.result.valorReal === entry.line
          && entry.result.status !== ledger.RESULT_STATUS.PUSH) {
        entry.result = { ...entry.result, status: ledger.RESULT_STATUS.PUSH };
        totalPushCorrigido++;
        changed = true;
      }

      // 3) Invalidação retroativa do NHL pré-correção da agregação de odds.
      // Pra indicações do modelo, o que importa é quando o PIPELINE rodou
      // (qual código de agregação estava ativo); pra histórico importado de
      // fora (source != 'model'), evaluatedAt é só a data da importação, não
      // diz nada sobre quando a odd foi capturada — usa commenceTime como
      // aproximação de quando o mercado foi mesmo consultado.
      if (entry.esporte === 'hockey/nhl' && entry.validForCalibration !== false) {
        const isModelSourced = entry.source === 'model';
        const marca = isModelSourced
          ? (entry.firstEvaluatedAt || entry.evaluatedAt)
          : (entry.commenceTime || entry.firstEvaluatedAt || entry.evaluatedAt);
        if (marca && new Date(marca).getTime() < cutoff) {
          entry.validForCalibration = false;
          entry.invalidReason = 'pre_fix_agregacao_odds';
          totalNhlInvalidado++;
          changed = true;
        }
      }

      // 4) Migração de esquema — preenche campos novos ausentes com o default seguro.
      const migracoes = {
        rawProb: null,
        segmentState: null,
        sampleSize: null,
        validForCalibration: true,
        invalidReason: null,
        closingOdds: null,
        clv: null,
      };
      for (const [campo, valorPadrao] of Object.entries(migracoes)) {
        if (!(campo in entry)) {
          entry[campo] = valorPadrao;
          changed = true;
          totalMigrado++;
        }
      }

      byKey.set(entry._key, entry);
    }

    if (changed) {
      ledger.savePartitionFile(file, Array.from(byKey.values()));
      arquivosAlterados++;
    }
  }

  console.log(`Reprocessamento concluído: ${files.length} partição(ões) verificada(s), ${arquivosAlterados} alterada(s).`);
  console.log(`  Entradas verificadas: ${totalEntradas}`);
  console.log(`  Duplicadas removidas (mesma chave): ${totalDedup}`);
  console.log(`  Resultados corrigidos pra push (valor real == linha): ${totalPushCorrigido}`);
  console.log(`  Indicações de NHL invalidadas pra calibração (pré-correção da agregação): ${totalNhlInvalidado}`);
  console.log(`  Campos de esquema migrados (registros antigos sem os campos novos): ${totalMigrado}`);
}

main();
