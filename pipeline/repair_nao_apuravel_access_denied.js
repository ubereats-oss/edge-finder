// pipeline/repair_nao_apuravel_access_denied.js
// Reparo pontual (uso único): settle_model_ledger.js chamava a ESPN com
// https nativo e User-Agent de navegador, o que a ESPN respondia com Access
// Denied quando rodado no GitHub Actions — corrigido para usar o mesmo
// cliente (axios, sem headers customizados) dos demais scripts do pipeline.
// Toda indicação marcada como não_apuravel até essa correção caiu nesse
// estado por falha de acesso, não por ausência real de dado (o próprio
// settle_model_ledger.js não conseguia sequer buscar o scoreboard/summary).
// Este script reverte essas indicações para pendente e zera as tentativas,
// para que voltem a ser apuradas normalmente na próxima execução.
//
// Uso: node pipeline/repair_nao_apuravel_access_denied.js

const ledger = require('./model_ledger');

function sportOf(filePath) {
  const m = filePath.match(/model_ledger_([a-z]+)_/);
  return m ? m[1] : 'desconhecido';
}

function main() {
  const partitions = ledger.listAllPartitions();
  const porEsporte = {};
  let total = 0;

  for (const file of partitions) {
    const entries = ledger.loadPartitionFile(file);
    let changed = false;

    for (const entry of entries) {
      if (entry.resolutionStatus !== ledger.RESOLUTION_STATUS.NAO_APURAVEL) continue;
      entry.resolutionStatus = ledger.RESOLUTION_STATUS.PENDENTE;
      entry.resolutionAttempts = 0;
      changed = true;
      total++;
      const esporte = sportOf(file);
      porEsporte[esporte] = (porEsporte[esporte] || 0) + 1;
    }

    if (changed) ledger.savePartitionFile(file, entries);
  }

  console.log('Indicações revertidas de não_apuravel para pendente, por esporte:');
  for (const [esporte, n] of Object.entries(porEsporte)) console.log(`  ${esporte}: ${n}`);
  console.log(`Total revertido: ${total}`);
}

main();
