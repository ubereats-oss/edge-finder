param([string]$Source=$PSScriptRoot,[string]$Fixture=(Join-Path $PSScriptRoot 'fixtures/tunnelbear_login_real_20261117_19.json'))
$ErrorActionPreference='Stop'
. (Join-Path $Source 'tunnelbear.ps1') -Action library
$real=Get-Content -Raw $Fixture | ConvertFrom-Json
$script:programs=@($real.cycles[0].program.programs)
if(-not $script:programs.Count){throw 'Fixture real precisa da UI oculta'}
$script:native=@{Status=$real.cycles[0].program.nativeStatus;Country=$real.cycles[0].program.nativeCountry}
$script:stops=@()
function Get-TunnelBearProgram {return $script:programs}
function Get-TunnelBearNativeConnection {return $script:native}
function Get-VpnAdapter {return @{OperationalStatus='Down'}}
function Stop-Process {param($Id,[switch]$PassThru,$ErrorAction) $script:stops+= $Id;$script:programs=@($script:programs|Where-Object Id -ne $Id)}
function Get-Process {param($Id,$ErrorAction) return $script:programs|Where-Object Id -eq $Id}
$env:EDGE_DATA_ROOT=Join-Path ([IO.Path]::GetTempPath()) ('vpn-owned-'+[guid]::NewGuid())
[void][IO.Directory]::CreateDirectory((Join-Path $env:EDGE_DATA_ROOT '.local_logs/betano'))
$f=Join-Path $env:EDGE_DATA_ROOT '.local_logs/betano/vpn-ownership.json'
[IO.File]::WriteAllText($f,'{"owner":"routine"}')
$closed=Stop-TunnelBearProgram 'EdgeFinderCollection' -OwnedAttempt
if($closed.closedCount -ne 1 -or $script:stops.Count -ne 1){throw 'UI própria Connecting/Down não fechou'}
$script:programs=@($real.cycles[0].program.programs);$script:stops=@()
[IO.File]::WriteAllText($f,'{"owner":"alex"}')
$blocked=$false
try{Stop-TunnelBearProgram 'EdgeFinderCollection' -OwnedAttempt|Out-Null}catch{$blocked=$true}
if(-not $blocked -or $script:stops.Count){throw 'Marca Alex foi desrespeitada'}
'PASS2: registro realConnecting/Down fecha somenteUI própria; marcaAlex bloqueia'
