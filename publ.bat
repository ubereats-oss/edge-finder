@echo off

REM Lê a linha "version: X.Y.Z+N" do pubspec.yaml
for /f "tokens=2 delims= " %%a in ('findstr "^version:" pubspec.yaml') do set FULLVER=%%a

REM Separa versionName (antes do +) e versionCode (depois do +)
for /f "tokens=1,2 delims=+" %%a in ("%FULLVER%") do (
    set NAME=%%a
    set CODE=%%b
)

REM Separa os três números do versionName
for /f "tokens=1,2,3 delims=." %%a in ("%NAME%") do (
    set MAJOR=%%a
    set MINOR=%%b
    set PATCH=%%c
)

REM Incrementa patch e versionCode
set /a NEWPATCH=%PATCH%+1
set /a NEWCODE=%CODE%+1
set NEWNAME=%MAJOR%.%MINOR%.%NEWPATCH%

REM Atualiza pubspec.yaml
powershell -Command "(Get-Content pubspec.yaml) -replace [regex]::Escape('%NAME%+%CODE%'), '%NEWNAME%+%NEWCODE%' | Set-Content pubspec.yaml"

echo versionName atualizado: %NAME% -^> %NEWNAME%
echo versionCode atualizado: %CODE% -^> %NEWCODE%

flutter build appbundle --release --dart-define=GEMINI_API_KEY=AIzaSyAqHhpVvCZtIRu0Z9Cw8aYVVeBcCcTPYCI
