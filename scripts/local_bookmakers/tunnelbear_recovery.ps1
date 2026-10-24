function Get-TunnelBearHungProcesses {
  return @(Get-Process -Name 'TunnelBear', 'TunnelBear.UI' -ErrorAction SilentlyContinue |
    Where-Object { $_.MainWindowHandle -ne [IntPtr]::Zero -and -not $_.Responding })
}
function Restart-UnresponsiveTunnelBear($Initial, [switch]$Forced) {
  if (-not $Forced -and @(Get-TunnelBearHungProcesses).Count -eq 0) { return }
  if ($Initial.Adapter -ne 'Down') {
    throw 'TunnelBear travado com conexão preexistente ou estado incerto; conexão do Alex preservada, ciclo sem conexão.'
  }
  if ($script:TunnelBearRestarted) { throw 'TunnelBear continua travado após uma reabertura; ciclo sem conexão.' }
  $script:TunnelBearRestarted = $true
  Get-Process -Name 'TunnelBear', 'TunnelBear.UI' -ErrorAction SilentlyContinue | Stop-Process -Force
  Start-TunnelBearWindow
  $deadline = [DateTime]::UtcNow.AddSeconds(30)
  do {
    Start-Sleep -Milliseconds 250
    $window = Find-TunnelBearWindow
    if ($window -and @(Get-TunnelBearHungProcesses).Count -eq 0) { break }
  } while ([DateTime]::UtcNow -lt $deadline)
  if (-not $window -or @(Get-TunnelBearHungProcesses).Count) { throw 'TunnelBear não respondeu após reabrir uma vez.' }
  # Opening can auto-connect; this connection belongs to this recovery, never Alex.
  if ((Get-VpnProof).Adapter -ne 'Down') {
    $script:CycleOwnsVpn = $true
    $state = Assert-TunnelBearWindow
    if ($state.Switch.Current.ToggleState -ne [System.Windows.Automation.ToggleState]::Off) { $state.Switch.Toggle() }
  }
  $null = Wait-VpnProof $false 30
  $script:CycleOwnsVpn = $false
  Write-ConnectionAttempt 1 'hung_reopened' 'TunnelBear reaberto uma vez; placa Down confirmada.'
}
