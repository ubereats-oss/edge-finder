// .github/scripts/check_artifact_retention.js
// Proteção contra regressão: falha se qualquer step actions/upload-artifact
// nos workflows não tiver retention-days explícito, ou tiver retention-days
// maior que 1 dia.
//
// Motivo: entre jun/2026 e ago/2026 a cota de Actions storage da conta
// estourou porque artefatos ficavam sem retenção configurada e usavam o
// padrão do GitHub (até 90 dias). Em 02/08/2026 a retenção foi ajustada pra
// 1 dia (o mínimo aceito) em todos os steps, e a cota se normalizou. Essa
// verificação existe pra pegar qualquer novo step de upload de artefato que
// volte a ficar sem retenção (ou com retenção maior que 1 dia) antes que
// vire um problema silencioso, só percebido meses depois.
//
// Uso: node .github/scripts/check_artifact_retention.js
// Sai com código 1 e lista os problemas se encontrar algum; código 0 se OK.
// Não é um parser de YAML genérico — assume o formato usado neste
// repositório (steps de lista sob `steps:`, indentação consistente).

const fs = require('fs');
const path = require('path');

const WORKFLOWS_DIR = path.join(__dirname, '..', 'workflows');
const MAX_RETENTION_DAYS = 1;
const UPLOAD_ARTIFACT_RE = /uses:\s*actions\/upload-artifact@/;

function indentOf(line) {
  const m = line.match(/^(\s*)/);
  return m[1].length;
}

function isBlank(line) {
  return line.trim() === '';
}

// Dado o índice da linha "uses: actions/upload-artifact@...", devolve todas
// as linhas do mesmo step (do "uses:" até o fim do bloco do step).
function collectStepBlock(lines, usesIdx) {
  const usesIndent = indentOf(lines[usesIdx]);
  const block = [lines[usesIdx]];
  for (let i = usesIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (isBlank(line)) { block.push(line); continue; }
    const ind = indentOf(line);
    if (ind < usesIndent) break; // saiu do step (dedent)
    if (ind === usesIndent && /^\s*-\s/.test(line)) break; // próximo step da lista
    block.push(line);
  }
  return block;
}

// Extrai o valor de "retention-days:" dentro do bloco do step, se existir.
function findRetentionDays(block) {
  for (const line of block) {
    const m = line.match(/^\s*retention-days:\s*(.+?)\s*(#.*)?$/);
    if (m) return m[1].trim().replace(/^['"]|['"]$/g, '');
  }
  return null;
}

function checkFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split(/\r?\n/);
  const problems = [];

  lines.forEach((line, idx) => {
    if (!UPLOAD_ARTIFACT_RE.test(line)) return;

    const block = collectStepBlock(lines, idx);
    const raw = findRetentionDays(block);
    const lineNo = idx + 1;

    if (raw === null) {
      problems.push({
        line: lineNo,
        message: `step de upload de artefato sem "retention-days" (linha ${lineNo}). ` +
          `Sem isso, o artefato usa o padrão do GitHub (até 90 dias) e pode voltar a encher a cota de Actions storage. ` +
          `Correção esperada: adicionar "retention-days: 1" dentro do "with:" desse step.`,
      });
      return;
    }

    const num = Number(raw);
    if (!Number.isFinite(num)) {
      problems.push({
        line: lineNo,
        message: `step de upload de artefato com "retention-days: ${raw}" (linha ${lineNo}) não é um número literal — ` +
          `não dá pra confirmar estaticamente que é <= ${MAX_RETENTION_DAYS} dia(s). ` +
          `Correção esperada: usar um valor numérico fixo, "retention-days: 1".`,
      });
      return;
    }

    if (num > MAX_RETENTION_DAYS) {
      problems.push({
        line: lineNo,
        message: `step de upload de artefato com "retention-days: ${num}" (linha ${lineNo}) acima do máximo permitido (${MAX_RETENTION_DAYS} dia). ` +
          `Esses artefatos só transportam arquivos entre jobs da mesma execução — não precisam durar mais que isso, e reter por mais tempo é o que já estourou a cota antes. ` +
          `Correção esperada: "retention-days: ${MAX_RETENTION_DAYS}".`,
      });
    }
  });

  return problems;
}

function main() {
  if (!fs.existsSync(WORKFLOWS_DIR)) {
    console.log('Nenhum diretório de workflows encontrado — nada a verificar.');
    return;
  }

  const files = fs.readdirSync(WORKFLOWS_DIR)
    .filter(f => f.endsWith('.yml') || f.endsWith('.yaml'))
    .map(f => path.join(WORKFLOWS_DIR, f));

  let totalProblems = 0;
  for (const file of files) {
    const problems = checkFile(file);
    if (problems.length) {
      console.error(`\n✗ ${path.relative(process.cwd(), file)}`);
      for (const p of problems) console.error(`  - ${p.message}`);
      totalProblems += problems.length;
    }
  }

  if (totalProblems > 0) {
    console.error(`\n${totalProblems} problema(s) de retenção de artefato encontrado(s).`);
    process.exit(1);
  }

  console.log(`OK — todos os steps de upload de artefato em ${files.length} arquivo(s) de workflow têm retention-days <= ${MAX_RETENTION_DAYS} dia(s).`);
}

main();
