# UI ownership is independent from VPN ownership. Never target Maintenance/service.
function Get-TunnelBearProgram {
  if (-not ('EdgeBackgroundDesktop' -as [type])) { Add-Type -Path (Join-Path $PSScriptRoot 'background_desktop.cs') }
  $folder = Split-Path -Parent (Get-TunnelBearInstallation).Path
  $rows = @(Get-Process -Name 'TunnelBear.UI' -ErrorAction SilentlyContinue | ForEach-Object {
    $process = $_
    $windows = @([EdgeBackgroundDesktop]::Windows('Default', [int[]]@($process.Id), $false))
    $hidden = @([EdgeBackgroundDesktop]::Windows('EdgeFinderCollection', [int[]]@($process.Id), $false))
    $visible = [EdgeBackgroundDesktop]::AnyVisible('Default', [int[]]@($process.Id))
    $desktop = if ($windows.Count) { 'Default' }
      elseif ($hidden.Count) { 'EdgeFinderCollection' }
      else { 'unknown' }
    [pscustomobject]@{ Id = $process.Id; StartedAt = $process.StartTime.ToUniversalTime().ToString('o');
      Desktop = $desktop; Visible = $visible;
      Installed = $process.Path -and (Split-Path -Parent $process.Path) -eq $folder }
  })
  return $rows
}

function Get-TunnelBearProgramDecision($Programs, $Native) {
  if ($Native.Status -eq 'Connected' -and $Native.Country -eq 'PT') { return 'preserve' }
  if ($Native.Status -eq 'Connected' -and $Native.Country -and $Native.Country -ne 'PT') {
    return 'other_country'
  }
  if ($Native.Status -eq 'Disconnected') { return 'collect' }
  return 'unconfirmed'
}

function Stop-TunnelBearProgram([string]$Desktop) {
  $closed = @()
  if ($Desktop -eq 'Default' -and @(Get-TunnelBearProgram | Where-Object { $_.Desktop -eq 'unknown' }).Count) {
    throw 'TUNNELBEAR_PROGRAM_CLOSE_FAILED: desktop da interface não confirmado; fechamento não autorizado.'
  }
  foreach ($program in @(Get-TunnelBearProgram | Where-Object { $_.Desktop -eq $Desktop })) {
    # Recheck immediately before closing, including process identity/visibility.
    $current = @(Get-TunnelBearProgram | Where-Object { $_.Id -eq $program.Id -and $_.StartedAt -eq $program.StartedAt })
    if (-not $current.Count) { continue }
    $native = Get-TunnelBearNativeConnection
    if ($native.Status -ne 'Disconnected' -or -not $current[0].Installed -or $current[0].Desktop -ne $Desktop) {
      throw 'TUNNELBEAR_PROGRAM_CLOSE_FAILED: fechamento não autorizado; VPN não desligado ou interface em uso.'
    }
    $stopped = Stop-Process -Id $program.Id -PassThru -ErrorAction Stop
    if ($stopped) { $null = $stopped.WaitForExit(2000) }
    if (Get-Process -Id $program.Id -ErrorAction SilentlyContinue) {
      throw 'TUNNELBEAR_PROGRAM_CLOSE_FAILED: interface permanece aberta.'
    }
    $closed += $program.Id
  }
  return [pscustomobject]@{ status = 'closed'; desktop = $Desktop; closedCount = $closed.Count; closedIds = $closed;
    closedUserProgram = ($Desktop -eq 'Default' -and $closed.Count -gt 0) }
}

function Assert-TunnelBearProgramAvailable {
  $programs = @(Get-TunnelBearProgram)
  $native = Get-TunnelBearNativeConnection
  $decision = Get-TunnelBearProgramDecision $programs $native
  Write-ConnectionAttempt 1 'program_decision' ([pscustomobject]@{ decision = $decision; programs = $programs;
    nativeStatus = $native.Status; nativeCountry = $native.Country; nativeAt = $native.At } | ConvertTo-Json -Depth 5 -Compress)
  if ($decision -eq 'other_country') { throw 'VPN do Alex em outro país' }
  if ($decision -eq 'unconfirmed') { throw 'VPN_STATE_UNCONFIRMED: estado nativo ou país sem confirmação; nenhum toque autorizado.' }
  return $decision
}
