const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const MAX_SIZE = 2 * 1024 * 1024; // 2MB

function getJsFilesRootOnly(dir) {
  const files = fs.readdirSync(dir);

  return files
    .map(f => path.join(dir, f))
    .filter(f => fs.statSync(f).isFile() && f.endsWith('.js'));
}

function exportFiles(files) {
  let part = 1;
  let currentSize = 0;
  let content = '';

  for (const file of files) {
    const fileContent = fs.readFileSync(file, 'utf8');

    const block = `
==================================================
ARQUIVO: ${file}
==================================================
${fileContent}
`;

    const blockSize = Buffer.byteLength(block, 'utf8');

    if (currentSize + blockSize > MAX_SIZE) {
      fs.writeFileSync(`auditoria_js_parte_${part}.txt`, content);
      part++;
      content = '';
      currentSize = 0;
    }

    content += block;
    currentSize += blockSize;
  }

  if (content) {
    fs.writeFileSync(`auditoria_js_parte_${part}.txt`, content);
  }
}

function main() {
  const files = getJsFilesRootOnly(ROOT);

  if (files.length === 0) {
    console.log('Nenhum .js na raiz');
    return;
  }

  console.log(`Encontrados: ${files.length} arquivos`);
  exportFiles(files);
  console.log('Exportação concluída');
}

main();