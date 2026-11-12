const fs = require('node:fs');
const path = require('node:path');

function verifyVersions(locked, installed, core, image) {
  if (!image?.driverVersion || !image?.dockerImageName?.startsWith('mcr.microsoft.com/playwright:'))
    throw new Error('Imagem oficial do Playwright não identificada: metadados /ms-playwright/.docker-info ausentes ou inválidos.');
  if (!locked || installed !== locked || core !== locked || image.driverVersion !== locked)
    throw new Error(`Versões divergentes do Playwright: projeto/lock=${locked}, pacote=${installed}, core=${core}, imagem=${image.driverVersion}. Atualize a versão e o digest da imagem junto com o Playwright do projeto.`);
  return locked;
}

function main() {
  const root = path.resolve(__dirname, '..');
  let image;
  try { image = JSON.parse(fs.readFileSync('/ms-playwright/.docker-info', 'utf8')); }
  catch { throw new Error('Imagem oficial do Playwright não identificada: não foi possível ler /ms-playwright/.docker-info.'); }
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
  const version = verifyVersions(lock.packages?.['node_modules/playwright']?.version,
    require('playwright/package.json').version, require('playwright-core/package.json').version, image);
  fs.accessSync(require('playwright').chromium.executablePath(), fs.constants.X_OK);
  console.log(`Playwright ${version} confere com ${image.dockerImageName}; Chromium pré-instalado disponível; Node ${process.version}.`);
}

module.exports = { verifyVersions };
if (require.main === module) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
