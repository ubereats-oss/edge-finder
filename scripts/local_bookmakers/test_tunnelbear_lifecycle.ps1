param([string]$Source = $PSScriptRoot)
$ErrorActionPreference = 'Stop'
. (Join-Path $Source 'tunnelbear.ps1') -Action library
$script:actualStateReader = (Get-Item Function:Get-TunnelBearState).ScriptBlock
$script:actualWindowStarter = (Get-Item Function:Start-TunnelBearWindow).ScriptBlock
function Close-TunnelBearPromotion($Window) {}
function Handle-TunnelBearKnownScreens($Window) {}
$script:passed = 0
function Assert($Condition, $Message) { if (-not $Condition) { throw $Message } }
function Reset-Scenario($Mode, [bool]$Connected = $false) {
  $script:mode = $Mode; $script:connected = $Connected; $script:starts = 0
  $script:restores = 0; $script:clicks = 0; $script:captures = 0; $script:CycleOwnsVpn = $false
  $script:window = if ($Mode -in @('closed', 'absent')) { $null } else { @{ Current = @{ Name = 'TunnelBear' } } }
  $script:toggle = [pscustomobject]@{ Current = @{ ToggleState = [System.Windows.Automation.ToggleState]::Off } }
  $script:toggle | Add-Member ScriptMethod Toggle { $script:clicks++; $script:connected = $true }
}
function Get-VpnProof {
  return @{ Connected = $script:connected; Adapter = $(if ($script:connected -or $script:mode -eq 'unknown') { 'Up' } else { 'Down' });
    Country = $(if ($script:connected) { 'PT' } else { $null }) }
}
function Find-TunnelBearWindow { return $script:window }
function Start-TunnelBearWindow {
  $script:starts++
  if ($script:mode -ne 'absent') { $script:window = @{ Current = @{ Name = 'TunnelBear' } } }
}
function Restore-TunnelBearWindow($Window) {
  $script:restores++
  if ($script:mode -eq 'auto') { $script:connected = $true }
  if ($script:mode -eq 'auto-pending') { $script:toggle.Current.ToggleState = [System.Windows.Automation.ToggleState]::On }
}
function Get-TunnelBearState {
  if ($script:mode -eq 'unexpected') { throw 'Aviso de atualização do TunnelBear.' }
  return @{ Countries = @('Portugal'); Switch = $script:toggle }
}
function Save-TunnelBearUnexpectedWindow { $script:captures++; return 'simulated-screen.png' }
function Wait-VpnProof($Expected, $TimeoutSeconds) { $script:connected = $Expected; return Get-VpnProof }
foreach ($mode in @('closed', 'minimized', 'open')) {
  Reset-Scenario $mode
  $prepared = Prepare-TunnelBearWindow
  Assert ($script:starts -eq [int]($mode -eq 'closed')) "$mode launch"
  Assert ($script:restores -eq 1 -and $script:clicks -eq 0 -and -not $script:connected) "$mode preparation must never connect"
  $result = Connect-TunnelBearPrepared $prepared
  Assert ($result.ConnectedByCycle -and $script:clicks -eq 1) "$mode cycle owns connection"
  $script:passed++
}
Reset-Scenario 'open' $true
$result = Connect-TunnelBearPrepared (Prepare-TunnelBearWindow)
Assert ($result.Proof.Connected -and -not $result.ConnectedByCycle -and $script:clicks -eq 0) 'User connection must be reused and preserved'
$script:passed++
Reset-Scenario 'auto'
$result = Connect-TunnelBearPrepared (Prepare-TunnelBearWindow)
Assert ($result.ConnectedByCycle -and $script:clicks -eq 0) 'Auto connection belongs to cycle without second click'
$script:passed++
Reset-Scenario 'auto-pending'
$result = Connect-TunnelBearPrepared (Prepare-TunnelBearWindow)
Assert ($result.ConnectedByCycle -and $result.Proof.Connected -and $script:clicks -eq 0) 'Pending auto connection is awaited without second click and belongs to cycle'
$script:passed++
Reset-Scenario 'unexpected'
$rejected = $false
try { $null = Prepare-TunnelBearWindow } catch { $rejected = $_.Exception.Message -match 'Janela inesperada.*simulated-screen.png' }
Assert ($rejected -and $script:clicks -eq 0 -and $script:captures -eq 1) 'Unexpected window must be captured without clicks'
$script:passed++
Reset-Scenario 'unknown'
$rejected = $false
try { $null = Prepare-TunnelBearWindow } catch { $rejected = $_.Exception.Message -match 'placa Up' }
Assert ($rejected -and $script:clicks -eq 0 -and $script:restores -eq 0) 'Unknown Portugal IP never authorizes click'
$script:passed++
Reset-Scenario 'unknown'
$prepared = Prepare-TunnelBearWindow -ForDisconnect
Assert ($script:restores -eq 1 -and $script:clicks -eq 0) 'Loss of Portugal IP proof must not prevent preparing owned VPN for disconnection'
$script:passed++
Reset-Scenario 'absent'
$clock = [Diagnostics.Stopwatch]::StartNew()
$rejected = $false
try { $null = Prepare-TunnelBearWindow } catch { $rejected = $_.Exception.Message -eq 'TunnelBear não abriu' }
$clock.Stop()
Assert ($rejected -and $script:clicks -eq 0 -and $clock.Elapsed.TotalSeconds -ge 30 -and $clock.Elapsed.TotalSeconds -lt 32) 'Missing window must stop in 30 seconds without connection'
$script:passed++
Set-Item Function:Get-TunnelBearState $script:actualStateReader
foreach ($kind in @('login', 'update', 'warning')) {
  Reset-Scenario $kind
  $script:window = [pscustomobject]@{ Current = @{ Name = $(if ($kind -eq 'login') { 'Login' } else { 'TunnelBear' }) } }
  $script:window | Add-Member ScriptMethod FindFirst {
    param($Scope, $Condition)
    if ($script:mode -eq 'update') { return [pscustomobject]@{ Name = 'Close update popup' } }
    return $null
  }
  $script:window | Add-Member ScriptMethod FindAll {
    param($Scope, $Condition)
    if ($script:mode -eq 'warning') { return ,@([pscustomobject]@{ Name = 'Warning' }) }
    return ,@()
  }
  $rejected = $false
  try { $null = Prepare-TunnelBearWindow } catch { $rejected = $_.Exception.Message -match 'Janela inesperada.*simulated-screen.png' }
  Assert ($rejected -and $script:captures -eq 1 -and $script:clicks -eq 0) "Real state reader must reject $kind without invoking any popup control"
  $script:passed++
}
Set-Item Function:Start-TunnelBearWindow $script:actualWindowStarter
function Test-Path { param($LiteralPath) return $true }
function Start-Process {
  param($FilePath, $WorkingDirectory, $WindowStyle)
  $script:startArguments = @{ FilePath = $FilePath; WorkingDirectory = $WorkingDirectory; WindowStyle = $WindowStyle }
}
Start-TunnelBearWindow
Assert ($script:startArguments.WorkingDirectory -eq (Split-Path -Parent $script:startArguments.FilePath) -and
  $script:startArguments.WindowStyle -eq 'Normal') 'Installed launcher requires its own working directory and visible window'
$script:passed++
[pscustomobject]@{ passed = $script:passed; failed = 0; simulated = $true } | ConvertTo-Json -Compress
