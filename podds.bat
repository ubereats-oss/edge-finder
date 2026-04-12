@echo off
for /f "tokens=2 delims=+" %%a in ('findstr "^version:" pubspec.yaml') do set CODE=%%a
set CODE=%CODE: =%
set CODE=%CODE:\r=%
set /a NEWCODE=%CODE%+1
powershell -Command "(Get-Content pubspec.yaml) -replace '\+%CODE%', '+%NEWCODE%' | Set-Content pubspec.yaml"
echo versionCode atualizado: %CODE% -> %NEWCODE%
node -e "require('fs').readFileSync('.env','utf-8').split('\n').forEach(l=>{const[k,...v]=l.split('=');if(k)process.env[k.trim()]=v.join('=').trim()});const{execSync}=require('child_process');execSync('flutter build appbundle --release --dart-define=GITHUB_TOKEN='+process.env.GITHUB_TOKEN,{stdio:'inherit'})"