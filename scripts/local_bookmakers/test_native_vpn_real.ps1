$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'tunnelbear.ps1') -Action library
$real = Get-Content (Join-Path $PSScriptRoot 'fixtures/native_vpn_real_20261102.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$script:passed=0; $script:probeCalls=0; $script:countryCalls=0
function Assert($Condition,$Message) { if (-not $Condition) { throw $Message }; $script:passed++ }
function Get-VpnAdapter { return @{ OperationalStatus=$script:adapterStatus } }
function Get-TunnelBearNativeConnection { return $script:nativeState }
function Get-TunnelBearSelectedCountry { $script:countryCalls++; return $script:selectedCountry }
function Invoke-PortugalProbe($Uri,$TimeoutMs) { $script:probeCalls++; throw $script:externalError }
foreach ($cycle in @($real.cycles | Where-Object { $_.snapshot.Status -eq 'Connected' })) {
  $script:adapterStatus=@($cycle.checks | Where-Object adapter -eq 'Up')[0].adapter
  $script:nativeState=$cycle.snapshot; $script:selectedCountry=$null
  $script:externalError=$cycle.original[0].originalError
  $proof=Get-VpnProof
  Assert ($proof.Connected -and $proof.Country -eq 'PT' -and $proof.Service -eq 'TunnelBear registro') "Prova real $($cycle.startedAt)"
}
Assert ($script:probeCalls -eq 0 -and $script:countryCalls -eq 0) 'Log PT dispensa janela e HTTP'
$countryFailure=@($real.cycles | Where-Object { $_.startedAt -like '2026-11-02T08:50*' })[0]
$script:nativeState=$countryFailure.snapshot; $script:externalError=$countryFailure.original[0].originalError
Assert ((Get-VpnProof).Connected -and $script:externalError -match 'país português não confirmado') 'Rejeição externa real não veta snapshot PT do mesmo ciclo'
$down=@($real.cycles | Where-Object { $_.startedAt -like '2026-11-01T04:50*' })[0]
$script:adapterStatus=$down.checks[0].adapter; $script:nativeState=$down.snapshot
$proof=Get-VpnProof
Assert (-not $proof.Connected -and $proof.Error -match 'Down') 'Down real tem motivo'
Assert ((Get-VpnProof -ForDisconnect).Disconnected -and $script:probeCalls -eq 0) 'Desconexão Down/Disconnected não consulta IP'
$up=@($real.cycles | Where-Object { $_.startedAt -like '2026-11-02T09:50*' })[0]
Assert ($up.original[0].originalError -match 'placa Up') 'Recusa real preservada'
$script:adapterStatus='Up'; $script:nativeState=$countryFailure.snapshot
$script:CycleOwnsVpn=$false; $script:clicks=0
$script:toggle=[pscustomobject]@{ Current=@{ ToggleState=[System.Windows.Automation.ToggleState]::On } }
$script:toggle | Add-Member ScriptMethod Toggle { $script:clicks++ }
function Restart-UnresponsiveTunnelBear($Initial) {}
function Find-TunnelBearWindow { return @{ Current=@{ Name='TunnelBear' } } }
function Restore-TunnelBearWindow($Window) {}
function Get-TunnelBearState { return @{ Countries=@('Portugal'); Switch=$script:toggle } }
$connection=Connect-TunnelBearPrepared (Prepare-TunnelBearWindow)
Assert ($connection.Proof.Connected -and -not $connection.ConnectedByCycle -and $script:clicks -eq 0) 'Placa Up com snapshot PT real reutilizada e preservada'
$script:nativeState=@{ Status=$countryFailure.snapshot.Status; At=$countryFailure.snapshot.At; Country=$null }
$script:selectedCountry='PT'
Assert ((Get-VpnProof).Service -like 'TunnelBear janela*') 'Seleção somente leitura se país ausente no log'
$script:nativeState=@{ Status='Unavailable'; Country=$null }; $script:selectedCountry=$null
$proof=Get-VpnProof -BudgetMs 25
Assert (-not $proof.Connected -and $proof.Error -match 'VPN_COUNTRY_UNPROVEN') 'Sem fontes tem motivo próprio'
Assert ($script:clicks -eq 0) 'Falha de prova nunca clica'
Assert ((Protect-VpnReason $script:externalError).Length -le 300) 'Motivo limitado'
[pscustomobject]@{ passed=$script:passed; failed=0; realRecords=$true; externalSends=0 } | ConvertTo-Json -Compress
