$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'tunnelbear.ps1') -Action library
$script:passed = 0
function Assert($Value, $Message) { if (-not $Value) { throw $Message }; $script:passed++ }
function Get-TunnelBearHungProcesses { if ($script:hung) { return ,@{ Id = 1 } }; return @() }
function Get-Process { return [pscustomobject]@{ Id = 1 } }
function Stop-Process { param([Parameter(ValueFromPipeline=$true)]$InputObject, [switch]$Force); process { $script:stops++ } }
function Start-TunnelBearWindow { $script:starts++; $script:hung = $false }
function Find-TunnelBearWindow { return @{ Current = @{ Name = 'TunnelBear' } } }
function Get-VpnProof { return @{ Adapter = 'Down'; Connected = $false } }
function Wait-VpnProof($Expected, $TimeoutSeconds) { $script:verified = -not $Expected; return Get-VpnProof }
function Write-ConnectionAttempt {}
$script:hung = $true; $script:stops = 0; $script:starts = 0; $script:TunnelBearRestarted = $false
Restart-UnresponsiveTunnelBear @{ Adapter = 'Down' }
Assert ($script:stops -eq 1 -and $script:starts -eq 1 -and $script:verified) 'Restart must reopen once and verify Down'
$script:hung = $true; $script:stops = 0; $script:starts = 0; $script:TunnelBearRestarted = $false
$rejected = $false
try { Restart-UnresponsiveTunnelBear @{ Adapter = 'Up' } } catch { $rejected = $_.Exception.Message -match 'Alex preservada' }
Assert ($rejected -and $script:stops -eq 0 -and $script:starts -eq 0) 'User VPN must never be terminated'
$script:TunnelBearRestarted = $true; $rejected = $false
try { Restart-UnresponsiveTunnelBear @{ Adapter = 'Down' } } catch { $rejected = $_.Exception.Message -match 'uma reabertura' }
Assert $rejected 'Second restart forbidden'
$env:EDGE_NETWORK_LIBRARY = '1'
. (Join-Path $PSScriptRoot 'network_adapter.ps1')
Remove-Item Env:EDGE_NETWORK_LIBRARY
$routes = @(@{ InterfaceIndex = 7; RouteMetric = 20; InterfaceMetric = 5 }, @{ InterfaceIndex = 3; RouteMetric = 2; InterfaceMetric = 1 })
$adapters = @(@{ ifIndex = 7; Name = 'Rede cabeada'; Status = 'Up'; InterfaceDescription = 'Ethernet' },
  @{ ifIndex = 3; Name = 'VPN'; Status = 'Up'; InterfaceDescription = 'TunnelBear Adapter V9' })
Assert ((Select-PhysicalRoute $routes $adapters).Name -eq 'Rede cabeada') 'Active physical route works without Wi-Fi name and excludes VPN'
$temporary = Join-Path ([IO.Path]::GetTempPath()) ('edge-log-' + [Guid]::NewGuid().ToString('N'))
[IO.File]::WriteAllText($temporary, 'original')
$handle = [IO.File]::Open($temporary, [IO.FileMode]::Open, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
try { Write-LocalSafeLog $temporary 'blocked test' } finally { $handle.Dispose() }
Assert (@(Get-ChildItem -LiteralPath ([IO.Path]::GetDirectoryName($temporary)) -Filter ((Split-Path -Leaf $temporary) + '.alternate-*')).Count -eq 1) 'PowerShell log retries and writes alternate when blocked'
[pscustomobject]@{ passed = $script:passed; failed = 0; simulated = $true } | ConvertTo-Json -Compress
