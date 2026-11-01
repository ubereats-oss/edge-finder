param([ValidateSet('scheduler','manual','test')][string]$ExecutionOrigin='scheduler')
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'safe_log.ps1')
$project = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$reader = Join-Path $PSScriptRoot 'background_bootstrap.cjs'
if (-not $PSBoundParameters.ContainsKey('ExecutionOrigin') -and $env:EDGE_CYCLE_ORIGIN -in @('manual','test')) {
  $ExecutionOrigin = $env:EDGE_CYCLE_ORIGIN
}
$env:EDGE_CYCLE_ORIGIN = $ExecutionOrigin
$originEvidence = 'marca explícita do executor'
if ($ExecutionOrigin -eq 'scheduler') {
$originEvidence = 'lançador do Agendador; evento não identificado na consulta'
try {
  $triggers = Get-WinEvent -FilterHashtable @{ LogName='Microsoft-Windows-TaskScheduler/Operational';
    Id=107,110; StartTime=(Get-Date).AddMinutes(-2) } -MaxEvents 100 -ErrorAction Stop
  foreach ($trigger in $triggers) {
    $xml = [xml]$trigger.ToXml()
    $taskNode = @($xml.Event.EventData.Data | Where-Object { $_.Name -eq 'TaskName' })[0]
    if ($taskNode.InnerText -eq '\EdgeFinder-Betano-Local') {
      $env:EDGE_CYCLE_ORIGIN = if ($trigger.Id -eq 107) { 'scheduler' } else { 'manual' }
      $env:EDGE_CYCLE_TRIGGERED_AT = $trigger.TimeCreated.ToUniversalTime().ToString('o')
      $originEvidence = "evento nativo $($trigger.Id)"
      break
    }
  }
} catch {
  $env:EDGE_CYCLE_ORIGIN = 'scheduler'
  $originEvidence = "lançador do Agendador; consulta do evento indisponível; tipo=$($_.Exception.GetType().Name)"
}
}
$logDir = Join-Path $project '.local_logs\betano'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$log = Join-Path $logDir 'task-output.log'
Write-LocalSafeLog $log "Inicio $(Get-Date -Format o); reader=$reader"
Write-LocalSafeLog $log "Origem=$env:EDGE_CYCLE_ORIGIN; evidência=$originEvidence"
$ErrorActionPreference = 'Continue'
& 'C:\Program Files\nodejs\node.exe' $reader 2>&1 | ForEach-Object { Write-LocalSafeLog $log $_.ToString() }
$result = $LASTEXITCODE
Write-LocalSafeLog $log "Fim $(Get-Date -Format o); exit=$result"
exit $result
