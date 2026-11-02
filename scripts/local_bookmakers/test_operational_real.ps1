$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'tunnelbear_installation.ps1')
. (Join-Path $PSScriptRoot 'vpn_proof.ps1')
$real = Get-Content (Join-Path $PSScriptRoot 'fixtures/operational_real_20261031.json') -Raw | ConvertFrom-Json
$installed = Get-TunnelBearInstallation
if ($installed.Version -ne '4.21.0.0') { throw "Versão instalada diferente do aceite: $($installed.Version)" }
$selected = Select-TunnelBearInstallation @(
  @{ Path = 'C:\Program Files (x86)\TunnelBear\TunnelBear.exe'; Version = $real.oldVersion }, $installed)
if ($selected.Path -ne $installed.Path -or $selected.Version -ne '4.21.0.0') { throw 'Escolheu versão antiga' }
$missing = $false
try { & { function Test-Path { param($LiteralPath,$PathType) return $false }; Get-TunnelBearInstallation } }
catch { $missing = $_.Exception.Message -match 'TUNNELBEAR_EXECUTABLE_NOT_FOUND' }
if (-not $missing) { throw 'Ausência de executável sem motivo próprio' }
function Get-VpnAdapter { return @{ OperationalStatus = [System.Net.NetworkInformation.OperationalStatus]::Up } }
function Get-TunnelBearNativeConnection { return @{ Status = 'Unavailable'; Country = $null } }
function Get-TunnelBearSelectedCountry { return $null }
$script:calls = @()
$script:scenario = 'slow-success'
function Invoke-PortugalProbe($Uri, $TimeoutMs) {
  $script:calls += $Uri
  if ($script:scenario -eq 'slow-success') {
    Start-Sleep -Milliseconds 3500
    return @{ success = $true; country_code = 'PT' }
  }
  Start-Sleep -Milliseconds $TimeoutMs
  throw $real.cycles[1].vpnFailures[0].originalError
}
$proof = Get-VpnProof
if (-not $proof.Connected -or $proof.ElapsedMs -lt 3500 -or $proof.ElapsedMs -gt 20000) {
  throw '29/10 14:32: resposta de 3,5 s não aceita dentro de 20 s'
}
$script:scenario = 'timeout'; $script:calls = @()
$proof = Get-VpnProof
if ($proof.Connected -or -not $proof.ProofWindowExhausted -or $proof.ElapsedMs -gt 20500 -or
  $script:calls.Count -lt 2 -or $script:calls[0] -notmatch 'ipwho' -or $script:calls[1] -notmatch 'ipapi' -or
  $proof.Error -notmatch 'tempo limite') { throw 'Janela total, alternância ou motivo original reprovado' }
[pscustomobject]@{ passed = 4; failed = 0; installedVersion = $installed.Version;
  simulatedLatencyMs = 3500; exhaustedWindowMs = $proof.ElapsedMs; realRecords = $true } | ConvertTo-Json -Compress
