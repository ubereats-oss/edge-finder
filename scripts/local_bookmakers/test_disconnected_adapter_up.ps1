$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'tunnelbear.ps1') -Action library
$blocked=Get-Content (Join-Path $PSScriptRoot 'fixtures/disconnected_adapter_up_20261103.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$previous=Get-Content (Join-Path $PSScriptRoot 'fixtures/native_vpn_real_20261102.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$pt=@($previous.cycles | Where-Object { $_.snapshot.Status -eq 'Connected' })[0].snapshot
$script:passed=0; $script:probes=0
function Assert($Condition,$Message){if(-not $Condition){throw $Message};$script:passed++}
function Get-VpnAdapter{return @{OperationalStatus=$script:adapter}}
function Get-TunnelBearNativeConnection{return $script:native}
function Get-TunnelBearSelectedCountry{return 'PT'}
function Invoke-PortugalProbe { $script:probes++; throw 'HTTP nao autorizado no replay nativo' }
$script:native=$pt; $script:adapter='Up'
$script:success=Get-VpnProof
function Restart-UnresponsiveTunnelBear($Initial){}
function Find-TunnelBearWindow{return @{Current=@{Name='TunnelBear'}}}
function Restore-TunnelBearWindow($Window){$script:restores++}
function Get-TunnelBearState{return @{Countries=@('Portugal');Switch=$script:toggle}}
function Wait-VpnProof($Expected,$TimeoutSeconds){$script:waits++;return $script:success}
function Reset-Replay($Native,$Adapter,$On){
  $script:native=$Native;$script:adapter=$Adapter;$script:CycleOwnsVpn=$false;$script:VpnAttemptSince=$null
  $script:clicks=0;$script:waits=0;$script:restores=0
  $script:toggle=[pscustomobject]@{Current=@{ToggleState=$(if($On){[System.Windows.Automation.ToggleState]::On}else{[System.Windows.Automation.ToggleState]::Off})}}
  $script:toggle | Add-Member ScriptMethod Toggle {$script:clicks++}
}
Assert ($blocked.cycles.Count -eq 8) 'Oito registros reais obrigatorios'
foreach($row in $blocked.cycles){
  Reset-Replay $row.native $row.adapter $false
  Assert ($row.originalError -match 'placa Up; TunnelBear não conectado: Disconnected') 'Origem real do bloqueio'
  $prepared=Prepare-TunnelBearWindow
  Assert (-not $prepared.ConnectedByCycle) 'Placa Up nao atribui propriedade antes de conectar'
  $connected=Connect-TunnelBearPrepared $prepared
  Assert ($script:clicks -eq 1 -and $script:waits -eq 1 -and $connected.ConnectedByCycle) "Ciclo real $($row.startedAt) agora autoriza conectar"
  Assert ((Get-VpnProof -ForDisconnect).Disconnected) 'Disconnected real confirma desligamento apesar de Up'
}
Reset-Replay $pt 'Up' $true
$connected=Connect-TunnelBearPrepared (Prepare-TunnelBearWindow)
Assert ($connected.Proof.Connected -and -not $connected.ConnectedByCycle -and $script:clicks -eq 0) 'PT real preexistente reutilizado sem propriedade'
# Counterfactual country-only variation of a real Connected snapshot. No claim
# that an actual non-PT session was recorded; no extra VPN connection is made.
$other=@{Status=$pt.Status;At=$pt.At;Country='BR'}
foreach($adapter in @('Up','Down')){
  Reset-Replay $other $adapter $true
  $rejected=$false
  try{$null=Prepare-TunnelBearWindow}catch{$rejected=$_.Exception.Message -match 'outro país'}
  Assert ($rejected -and $script:clicks -eq 0 -and $script:restores -eq 0) 'Outro pais preservado independentemente da placa (contrafactual)'
}
Reset-Replay $pt 'Down' $true
Assert (-not (Get-VpnProof).Connected) 'Down continua sem confirmacao de conexao'
Assert ($script:probes -eq 0) 'Nenhuma consulta IP no replay'
[pscustomobject]@{passed=$script:passed;failed=0;blockedRealCycles=8;otherCountry='contrafactual explicito';externalCalls=0}|ConvertTo-Json -Compress
