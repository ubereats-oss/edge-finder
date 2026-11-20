$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'tunnelbear.ps1') -Action library
$real=Get-Content -Raw (Join-Path $PSScriptRoot 'fixtures/tunnelbear_stale_and_screen_20261117_20.json')|ConvertFrom-Json
$pt=Get-Content -Raw (Join-Path $PSScriptRoot 'fixtures/native_vpn_real_20261102.json')|ConvertFrom-Json
$script:adapter='Down';$script:anyProgram=$false;$script:passed=0
function Get-VpnAdapter {return @{OperationalStatus=$script:adapter}}
function Get-Process {param($Name,$Id,$ErrorAction) if($script:anyProgram){return @{Id=123}}}
function Assert($Ok,$Message){if(-not $Ok){throw $Message};$script:passed++}
$native=$real.oldProof.native
$at=[DateTimeOffset]::Parse($real.oldProof.observedAt)
Assert ($native.Status -eq 'Connecting' -and $native.Country -eq $null -and -not $real.oldProof.uiOpen) 'Entrada real original semalteração'
Assert (Test-TunnelBearStaleIntermediate @() $native $at) 'Snapshot real velho/Down/semprograma é aceito'
Assert ((Get-TunnelBearProgramDecision @() $native) -eq 'collect') 'Regra deprodução seguecoleta semdesconexão artificial prévia'
Assert ($native.Status -eq 'Connecting') 'Estado nativo original permaneceConnecting'
Assert (-not (Test-TunnelBearStaleIntermediate @() $native ([DateTimeOffset]::Parse($native.At).AddMinutes(10)))) 'Contrafactualtemporal:10min exatos nãoaceita'
Assert (Test-TunnelBearStaleIntermediate @() $native ([DateTimeOffset]::Parse($native.At).AddMinutes(10).AddMilliseconds(1))) 'Contrafactualtemporal:mais10min aceita'
$script:adapter='Up';Assert (-not (Test-TunnelBearStaleIntermediate @() $native $at)) 'ContrafactualadaptadorUp nuncaaceita';$script:adapter='Down'
$script:anyProgram=$true;Assert (-not (Test-TunnelBearStaleIntermediate @() $native $at)) 'Programa emqualquerdesktop mesmo semjanela impedeaceite'
Assert (-not (Test-TunnelBearStaleIntermediate $real.alexProgram.programs $native $at)) 'Programa realDefault doAlex impedeaceite'
Assert ((Get-TunnelBearProgramDecision $real.alexProgram.programs $native) -eq 'unconfirmed') 'ProgramaAlex nãoviraDisconnected'
$connected=@($pt.cycles|Where-Object {$_.snapshot.Status -eq 'Connected' -and $_.snapshot.Country -eq 'PT'})[0].snapshot
Assert ((Get-TunnelBearProgramDecision $real.alexProgram.programs $connected) -eq 'preserve') 'ConexãoPT realAlex preservada'
$script:anyProgram=$false
foreach($state in @('Disconnecting','Reconnecting')){$changed=$native|ConvertTo-Json|ConvertFrom-Json;$changed.Status=$state;Assert (Test-TunnelBearStaleIntermediate @() $changed $at) "Contrafactualintermediário $state seguemesmaguarda"}
$changed=$native|ConvertTo-Json|ConvertFrom-Json;$changed.Status='Connected';$changed.Country='PT'
Assert (-not (Test-TunnelBearStaleIntermediate @() $changed $at)) 'Connected antigo nuncaéintermediário'
$changed.At=$null;Assert (-not (Test-TunnelBearStaleIntermediate @() $changed $at)) 'Semhorário nãoaceita'
Assert ((Get-TunnelBearScreenSummary $real.mainScreen.elements) -match 'Disconnected.*Turn TunnelBear on') 'Resumo datela real20/11 incluiestadoprincipal'
Assert ((Get-TunnelBearScreenSummary @(@{name='email=alex@example.com';offscreen=$false})) -notmatch 'alex@example.com') 'Resumo nãovazaemail'
$env:EDGE_DATA_ROOT=Join-Path ([IO.Path]::GetTempPath()) ('vpn-retention-'+[guid]::NewGuid())
$folder=Join-Path $env:EDGE_DATA_ROOT '.local_logs/betano';[void][IO.Directory]::CreateDirectory($folder)
$old=Join-Path $folder 'tunnelbear-unexpected-20261117T000000000.png';$oldJson=$old -replace '\.png$','.json'
$recent=Join-Path $folder 'tunnelbear-action-required-20261119T000000000.png';$unrelated=Join-Path $folder 'cycle-20261117.json'
foreach($f in @($old,$oldJson,$recent,$unrelated)){[IO.File]::WriteAllText($f,'fixture')}
foreach($f in @($old,$oldJson,$unrelated)){(Get-Item -LiteralPath $f).LastWriteTimeUtc=[DateTime]::UtcNow.AddDays(-4)}
Remove-ExpiredTunnelBearEvidence
Assert (-not (Test-Path $old) -and -not (Test-Path $oldJson)) 'Retenção removePNG eJSON após3dias'
Assert ((Test-Path $recent) -and (Test-Path $unrelated)) 'Retenção preservarecentes eoutrosarquivos'
[pscustomobject]@{passed=$script:passed;failed=0;replay='snapshots reais17-20/11; variantes identificadas como contrafactuais'}|ConvertTo-Json -Compress
