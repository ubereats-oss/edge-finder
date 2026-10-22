$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$reader = Join-Path $project 'pipeline\local_betano_reader.js'
$logDir = Join-Path $project '.local_logs\betano'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$log = Join-Path $logDir 'task-output.log'
Add-Content -LiteralPath $log -Value "Inicio $(Get-Date -Format o); reader=$reader"
$ErrorActionPreference = 'Continue'
& 'C:\Program Files\nodejs\node.exe' $reader 2>&1 | ForEach-Object { Add-Content -LiteralPath $log -Value $_.ToString() }
$result = $LASTEXITCODE
Add-Content -LiteralPath $log -Value "Fim $(Get-Date -Format o); exit=$result"
exit $result
