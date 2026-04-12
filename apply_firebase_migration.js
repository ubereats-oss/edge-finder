const fs = require('fs');
const path = require('path');

// Diretório raiz do projeto (onde este script está sendo executado)
const ROOT = process.cwd();

function copy(src, dest) {
  const destDir = path.dirname(dest);
  if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
  fs.copyFileSync(src, dest);
  console.log(`  ✅ ${dest}`);
}

function log(msg) {
  console.log(msg);
}

async function main() {
  log('\n═══════════════════════════════════════════════');
  log('  MIGRAÇÃO FIREBASE — Edge Finder');
  log('═══════════════════════════════════════════════\n');

  // Verifica se está na pasta correta
  if (!fs.existsSync(path.join(ROOT, 'server.js'))) {
    console.error('ERRO: Execute este script na raiz do projeto odds_app.');
    process.exit(1);
  }

  const scriptDir = path.dirname(require.main.filename);

  log('1. Copiando firebase_sync.js...');
  copy(path.join(scriptDir, 'firebase_sync.js'), path.join(ROOT, 'firebase_sync.js'));

  log('\n2. Copiando workflows GitHub Actions...');
  copy(
    path.join(scriptDir, 'update_model.yml'),
    path.join(ROOT, '.github', 'workflows', 'update_model.yml')
  );
  copy(
    path.join(scriptDir, 'odds_history.yml'),
    path.join(ROOT, '.github', 'workflows', 'odds_history.yml')
  );

  log('\n3. Copiando api_service.dart...');
  copy(
    path.join(scriptDir, 'api_service.dart'),
    path.join(ROOT, 'lib', 'services', 'api_service.dart')
  );

  log('\n4. Copiando pubspec.yaml...');
  copy(path.join(scriptDir, 'pubspec.yaml'), path.join(ROOT, 'pubspec.yaml'));

  log('\n5. Instalando firebase-admin no projeto Node...');
  const { execSync } = require('child_process');
  try {
    execSync('npm install firebase-admin', { cwd: ROOT, stdio: 'inherit' });
    log('  ✅ firebase-admin instalado');
  } catch (e) {
    console.error('  ❌ Erro ao instalar firebase-admin:', e.message);
  }

  log('\n6. Verificando secret FIREBASE_SERVICE_ACCOUNT no GitHub...');
  // Lê o token do .env
  let ghToken = '';
  if (fs.existsSync(path.join(ROOT, '.env'))) {
    for (const line of fs.readFileSync(path.join(ROOT, '.env'), 'utf-8').split('\n')) {
      const [k, ...v] = line.split('=');
      if (k && k.trim() === 'GITHUB_TOKEN') ghToken = v.join('=').trim();
    }
  }

  if (ghToken) {
    const axios = require('axios');
    try {
      const res = await axios.get(
        'https://api.github.com/repos/ubereats-oss/edge-finder/actions/secrets',
        { headers: { Authorization: `Bearer ${ghToken}`, Accept: 'application/vnd.github+json' } }
      );
      const secrets = res.data.secrets.map(s => s.name);
      const hasFirebase = secrets.includes('FIREBASE_SERVICE_ACCOUNT');
      log(`  ${hasFirebase ? '✅' : '❌'} FIREBASE_SERVICE_ACCOUNT: ${hasFirebase ? 'encontrado' : 'NÃO encontrado — adicione manualmente'}`);
      const hasOddsKeys = secrets.includes('ODDS_API_KEYS');
      log(`  ${hasOddsKeys ? '✅' : '❌'} ODDS_API_KEYS: ${hasOddsKeys ? 'encontrado' : 'NÃO encontrado'}`);
      const hasGhPat = secrets.includes('GH_PAT');
      log(`  ${hasGhPat ? '✅' : '❌'} GH_PAT: ${hasGhPat ? 'encontrado' : 'NÃO encontrado'}`);
    } catch (e) {
      log('  ⚠️  Não foi possível verificar secrets: ' + e.message);
    }
  } else {
    log('  ⚠️  GITHUB_TOKEN não encontrado no .env — pulando verificação de secrets');
  }

  log('\n7. Fazendo sync inicial dos resultados atuais com Firestore...');
  // Verifica se FIREBASE_SERVICE_ACCOUNT está no ambiente
  if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
    log('  ⚠️  FIREBASE_SERVICE_ACCOUNT não está no ambiente.');
    log('  Para fazer o sync inicial, execute:');
    log('  set FIREBASE_SERVICE_ACCOUNT=<conteudo_do_json> && node firebase_sync.js');
  } else {
    try {
      execSync('node firebase_sync.js', { cwd: ROOT, stdio: 'inherit' });
    } catch (e) {
      log('  ⚠️  Sync inicial falhou — rode manualmente após configurar o ambiente.');
    }
  }

  log('\n8. Commitando e enviando para o GitHub...');
  try {
    execSync('git add firebase_sync.js .github/workflows/update_model.yml .github/workflows/odds_history.yml lib/services/api_service.dart pubspec.yaml', { cwd: ROOT, stdio: 'inherit' });
    execSync('git commit -m "feat: migração para Firebase + GitHub Actions"', { cwd: ROOT, stdio: 'inherit' });

    // Usa token do .env para push
    const pushCmd = `node -e "require('fs').readFileSync('.env','utf-8').split('\\n').forEach(l=>{const[k,...v]=l.split('=');if(k)process.env[k.trim()]=v.join('=').trim()});const{execSync}=require('child_process');execSync('git push https://ubereats-oss:'+process.env.GITHUB_TOKEN+'@github.com/ubereats-oss/edge-finder.git',{stdio:'inherit'})"`;
    execSync(pushCmd, { cwd: ROOT, stdio: 'inherit' });
    log('  ✅ Push concluído');
  } catch (e) {
    log('  ⚠️  Git commit/push falhou: ' + e.message);
    log('  Faça o commit manualmente.');
  }

  log('\n═══════════════════════════════════════════════');
  log('  MIGRAÇÃO CONCLUÍDA');
  log('═══════════════════════════════════════════════');
  log('\nPróximos passos:');
  log('1. Execute: flutter pub get');
  log('2. Dispare o workflow manualmente no GitHub Actions → "Atualizar Modelo"');
  log('   para popular o Firestore com os dados iniciais');
  log('3. Teste o app — deve buscar dados do Firestore automaticamente');
  log('4. O botão "Atualizar" agora aciona o GitHub Actions (leva ~2-5 min)');
  log('');
}

main().catch(e => {
  console.error('Erro fatal:', e);
  process.exit(1);
});
