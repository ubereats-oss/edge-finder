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
  if (@($Programs | Where-Object { $_.Visible -or -not $_.Installed -or $_.Desktop -eq 'unknown' }).Count -or
      ($Native.Status -eq 'Connected' -and $Native.Country -ne 'PT')) {
    return 'in_use'
  }
  if ($Native.Status -eq 'Connected' -and $Native.Country -eq 'PT') { return 'preserve' }
  if (@($Programs | Where-Object { $_.Desktop -eq 'Default' }).Count -and $Native.Status -ne 'Disconnected') {
    return 'in_use'
  }
  return 'collect'
}

function Stop-TunnelBearProgram([string]$Desktop) {
  $closed = @()
  foreach ($program in @(Get-TunnelBearProgram | Where-Object { $_.Desktop -eq $Desktop })) {
    # Recheck immediately before closing, including process identity/visibility.
    $current = @(Get-TunnelBearProgram | Where-Object { $_.Id -eq $program.Id -and $_.StartedAt -eq $program.StartedAt })
    if (-not $current.Count) { continue }
    $native = Get-TunnelBearNativeConnection
    if ($native.Status -ne 'Disconnected' -or $current[0].Visible -or -not $current[0].Installed -or $current[0].Desktop -ne $Desktop) {
      throw 'TUNNELBEAR_PROGRAM_CLOSE_FAILED: fechamento não autorizado; VPN não desligado ou interface em uso.'
    }
    $stopped = Stop-Process -Id $program.Id -PassThru -ErrorAction Stop
    if ($stopped) { $null = $stopped.WaitForExit(2000) }
    if (Get-Process -Id $program.Id -ErrorAction SilentlyContinue) {
      throw 'TUNNELBEAR_PROGRAM_CLOSE_FAILED: interface permanece aberta.'
    }
    $closed += $program.Id
  }
  return [pscustomobject]@{ status = 'closed'; desktop = $Desktop; closedCount = $closed.Count; closedIds = $closed }
}

function Assert-TunnelBearProgramAvailable {
  $decision = Get-TunnelBearProgramDecision (Get-TunnelBearProgram) (Get-TunnelBearNativeConnection)
  if ($decision -eq 'in_use') { throw 'TunnelBear em uso pelo Alex' }
  return $decision
}
