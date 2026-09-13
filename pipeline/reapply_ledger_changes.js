// pipeline/reapply_ledger_changes.js
// Copia o histórico central desta execução (staged em <stagedDir>) para
// odds_history/, na branch de dados que quem chamou este script acabou de
// restaurar (git checkout). Usado por todo workflow que grava
// odds_history/model_ledger_*.json na branch data, pra resistir a
// gravações concorrentes (duas execuções tentando gravar em sequência
// próxima — ex.: capture_closing_odds.js aguardando dentro do job).
//
// 1ª tentativa (sem --retry): copia direto — é a foto mais recente da
// branch data, acabou de ser restaurada, e ainda não houve nenhuma rejeição
// de push nesta execução.
//
// Tentativas seguintes (--retry, chamado depois que "git push" foi
// rejeitado porque a branch avançou): a branch acabou de ser recarregada de
// novo (mais recente que a leitura original). Em vez de sobrescrever tudo
// com a versão desta execução, reaplica por cima do estado recarregado
// somente a mudança que esta execução fez — sem perder a própria mudança e
// sem apagar o que a outra execução já gravou.
//
// Modos (só afetam odds_history/model_ledger_*.json — qualquer outro
// arquivo em stagedDir, ex. relatório de desempenho ou marcador de
// importação legada, é sempre copiado direto, sem merge):
//   closing-odds
//     Esta execução só preenche closingOdds/clv em indicações existentes
//     (capture_closing_odds.js). Nunca sobrescreve um closingOdds que já
//     esteja presente no estado recarregado.
//   protect-closing-odds
//     Esta execução reescreve entradas por outro motivo (apuração de
//     resultado, importação de histórico legado, nova avaliação do
//     modelo). Usa a versão desta execução, mas preserva closingOdds/clv
//     do estado recarregado quando já existirem — esses campos são
//     domínio exclusivo de capture_closing_odds.js.
//
// Uso: node pipeline/reapply_ledger_changes.js <modo> <stagedDir> [--retry]

const fs = require('fs');
const path = require('path');
const ledger = require('./model_ledger');

const [, , mode, stagedDir, flag] = process.argv;
const isRetry = flag === '--retry';

if (!stagedDir || !['closing-odds', 'protect-closing-odds'].includes(mode)) {
  console.error('Uso: node pipeline/reapply_ledger_changes.js <closing-odds|protect-closing-odds> <stagedDir> [--retry]');
  process.exit(1);
}

if (!fs.existsSync(stagedDir)) {
  console.log(`Nada staged em ${stagedDir} — nada a reaplicar.`);
  process.exit(0);
}

const TARGET_DIR = path.join(process.cwd(), 'odds_history');
fs.mkdirSync(TARGET_DIR, { recursive: true });

function isLedgerFile(name) {
  return name.startsWith('model_ledger_') && name.endsWith('.json');
}

// Reaplica as indicações desta execução (stagedEntries) por cima do estado
// recém-recarregado (currentEntries), conforme o modo. Identidade da
// indicação = _key (eventId+player+market+line+side), já presente em toda
// entrada gravada por model_ledger.js.
function mergeEntries(currentEntries, stagedEntries) {
  const byKey = new Map(currentEntries.map(e => [e._key || ledger.makeKey(e), e]));
  let reaplicadas = 0;

  for (const staged of stagedEntries) {
    const key = staged._key || ledger.makeKey(staged);
    const current = byKey.get(key);

    if (!current) {
      // Estado recarregado ainda não conhece esta indicação (entrada nova
      // desta execução, ou a branch foi recriada) — inclui como está.
      byKey.set(key, staged);
      reaplicadas++;
      continue;
    }

    if (mode === 'closing-odds') {
      const jaTinhaFechamento = current.closingOdds !== null && current.closingOdds !== undefined;
      const estaExecucaoCapturou = staged.closingOdds !== null && staged.closingOdds !== undefined;
      if (!jaTinhaFechamento && estaExecucaoCapturou) {
        current.closingOdds = staged.closingOdds;
        current.clv = staged.clv;
        reaplicadas++;
      }
    } else {
      // protect-closing-odds
      const closingOdds = current.closingOdds;
      const clv = current.clv;
      Object.assign(current, staged);
      if (closingOdds !== null && closingOdds !== undefined) {
        current.closingOdds = closingOdds;
        current.clv = clv;
      }
      reaplicadas++;
    }
  }

  return { merged: Array.from(byKey.values()), reaplicadas };
}

let totalReaplicadas = 0;
for (const name of fs.readdirSync(stagedDir)) {
  const srcPath = path.join(stagedDir, name);
  if (fs.statSync(srcPath).isDirectory()) continue;
  const destPath = path.join(TARGET_DIR, name);

  if (isRetry && isLedgerFile(name)) {
    const currentEntries = ledger.loadPartitionFile(destPath);
    const stagedEntries = ledger.loadPartitionFile(srcPath);
    const { merged, reaplicadas } = mergeEntries(currentEntries, stagedEntries);
    ledger.savePartitionFile(destPath, merged);
    totalReaplicadas += reaplicadas;
  } else {
    fs.copyFileSync(srcPath, destPath);
  }
}

if (isRetry) {
  console.log(`[recuperação] histórico central recarregado e reaplicado (modo ${mode}) — ${totalReaplicadas} indicação(ões) reconciliada(s).`);
}
