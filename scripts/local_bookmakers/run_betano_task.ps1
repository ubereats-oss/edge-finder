$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'safe_log.ps1')
$project = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$reader = Join-Path $project 'pipeline\local_betano_reader.js'
$logDir = Join-Path $project '.local_logs\betano'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$log = Join-Path $logDir 'task-output.log'
Write-LocalSafeLog $log "Inicio $(Get-Date -Format o); reader=$reader"
$ErrorActionPreference = 'Continue'
& 'C:\Program Files\nodejs\node.exe' $reader 2>&1 | ForEach-Object { Write-LocalSafeLog $log $_.ToString() }
$result = $LASTEXITCODE
Write-LocalSafeLog $log "Fim $(Get-Date -Format o); exit=$result"
exit $result
