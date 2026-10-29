param([Parameter(Mandatory=$true)][string]$ReleaseRoot)
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
$env:COMPUTERNAME=[Environment]::MachineName
. (Join-Path $PSScriptRoot 'safe_log.ps1')
$log=Join-Path $env:EDGE_DATA_ROOT '.local_logs/betano/task-output.log'
$env:EDGE_BACKGROUND_WORKER_PID="$PID"
$outputFile=Join-Path $env:EDGE_DATA_ROOT '.local_logs/betano/background-output.log'
$errorFile=Join-Path $env:EDGE_DATA_ROOT '.local_logs/betano/background-error.log'
try {
  $entry=Join-Path $PSScriptRoot 'background_entry.cjs'
  $processInfo=Start-Process -FilePath 'C:\Program Files\nodejs\node.exe' -ArgumentList ('"'+$entry+'" "'+$ReleaseRoot+'"') -WindowStyle Hidden -RedirectStandardOutput $outputFile -RedirectStandardError $errorFile -PassThru
  $null=$processInfo.Handle
  $processInfo.WaitForExit()
  $result=$processInfo.ExitCode
  if($null -eq $result){throw 'Resultado do processo Node indisponível.'}
  foreach($file in @($outputFile,$errorFile)){
    foreach($line in [IO.File]::ReadAllLines($file,[Text.Encoding]::UTF8)){Write-LocalSafeLog $log $line}
  }
  exit $result
} catch {
  Write-LocalSafeLog $log ('Inicialização no desktop oculto: '+$_.Exception.Message)
  exit 1
}
