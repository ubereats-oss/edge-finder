# A short-lived explicit test label for the existing task's native manual trigger.
# Scheduler triggers never consume it. No task configuration is changed.
function Use-TestCycleRequest([string]$Directory, [string]$Origin, [string]$TriggeredAt) {
  if ($Origin -ne 'manual' -or -not $TriggeredAt) { return $false }
  $file = Join-Path $Directory 'test-origin-request.json'
  if (-not (Test-Path -LiteralPath $file)) { return $false }
  try {
    $request = [IO.File]::ReadAllText($file) | ConvertFrom-Json
    $now = [DateTimeOffset]::UtcNow
    $created = [DateTimeOffset]::Parse($request.createdAt)
    $expires = [DateTimeOffset]::Parse($request.expiresAt)
    $trigger = [DateTimeOffset]::Parse($TriggeredAt)
    $valid = $request.origin -eq 'test' -and $request.taskName -eq 'EdgeFinder-Betano-Local' -and
      $created -le $trigger -and $trigger -le $now -and $now -le $expires -and
      ($expires - $created).TotalSeconds -le 120 -and $expires -gt $created
    if ($valid) { Remove-Item -LiteralPath $file -ErrorAction Stop; return $true }
  } catch { return $false }
  return $false
}
