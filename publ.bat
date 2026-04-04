@echo off
for /f "tokens=2 delims=+" %%a in ('findstr "^version:" pubspec.yaml') do set CODE=%%a
set /a NEWCODE=%CODE%+1
powershell -Command "(Get-Content pubspec.yaml) -replace '\+%CODE%', '+%NEWCODE%' | Set-Content pubspec.yaml"
echo versionCode atualizado: %CODE% -> %NEWCODE%

flutter build appbundle --release