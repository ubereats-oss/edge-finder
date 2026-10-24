function Enter-LocalResourceLock([string]$ScriptPath, [string[]]$Arguments) {
  $dataRoot = if ($env:EDGE_DATA_ROOT) { $env:EDGE_DATA_ROOT } else { Split-Path -Parent (Split-Path -Parent $PSScriptRoot) }
  $file = Join-Path $dataRoot '.local_logs\local-cycle.lock'
  try {
    $owner = Get-Content -LiteralPath $file -Raw | ConvertFrom-Json
    $live = @(@($owner.pid) + @($owner.children) | Where-Object { $_ -and (Get-Process -Id $_ -ErrorAction SilentlyContinue) })
    if ($env:EDGE_CYCLE_LOCK_TOKEN -and $owner.token -eq $env:EDGE_CYCLE_LOCK_TOKEN -and $live.Count) { return }
  } catch {}
  & 'C:\Program Files\nodejs\node.exe' (Join-Path $PSScriptRoot 'resource_lock.cjs') -- powershell.exe -NoProfile -ExecutionPolicy Bypass -File $ScriptPath @Arguments
  exit $LASTEXITCODE
}
