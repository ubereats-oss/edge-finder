$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'tunnelbear.ps1') -Action library
. (Join-Path $PSScriptRoot 'test_cycle_origin.ps1')
$script:passed = 0
function Assert($Condition, $Message) { if (-not $Condition) { throw $Message }; $script:passed++ }
$real = Get-Content (Join-Path $PSScriptRoot 'fixtures/native_vpn_real_20261102.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$realDisconnected = (Get-Content (Join-Path $PSScriptRoot 'fixtures/disconnected_adapter_up_20261103.json') -Raw -Encoding UTF8 | ConvertFrom-Json).cycles[0].native
$realPortugal = @($real.cycles | Where-Object { $_.snapshot.Status -eq 'Connected' -and $_.snapshot.Country -eq 'PT' })[0].snapshot
Assert ($realDisconnected.Status -eq 'Disconnected' -and $realPortugal.Country -eq 'PT') 'Fixture real deve conter os estados originais'
$script:programs = @()
$script:native = $realDisconnected
$script:stops = @()
$script:failClose = $false
function Get-TunnelBearProgram { return $script:programs }
function Get-TunnelBearNativeConnection { return $script:native }
function Stop-Process {
  param($Id, [switch]$PassThru, $ErrorAction)
  if ($script:failClose) { throw 'Falha de fechamento simulada' }
  $script:stops += $Id
  $script:programs = @($script:programs | Where-Object Id -ne $Id)
}
function Get-Process { param($Id, $ErrorAction) return $script:programs | Where-Object Id -eq $Id }
function Program($Desktop, [bool]$Visible = $false) {
  return [pscustomobject]@{ Id = 123; StartedAt = '2026-11-02T11:40:43Z'; Desktop = $Desktop; Visible = $Visible; Installed = $true }
}
foreach ($outcome in @('success', 'failure_in_read', 'failure_in_connect')) {
  $script:programs = @(Program 'EdgeFinderCollection')
  $script:native = $realDisconnected; $script:stops = @()
  try { if ($outcome -ne 'success') { throw $outcome } }
  catch {} finally { $result = Stop-TunnelBearProgram 'EdgeFinderCollection' }
  Assert ($result.closedCount -eq 1 -and $script:programs.Count -eq 0 -and $script:stops.Count -eq 1) "Cenario1 finally $outcome fecha somente UI"
}
$script:programs = @(Program 'Default'); $script:native = $realPortugal; $script:stops = @()
Assert ((Assert-TunnelBearProgramAvailable) -eq 'preserve' -and $script:stops.Count -eq 0) 'Cenario2 PT real preexistente preservado sem tocar UI'
# COUNTERFACTUAL: only country differs from the original native Connected/PT replay.
$counterfactual = $realPortugal | ConvertTo-Json | ConvertFrom-Json
$counterfactual.Country = 'DE'; $script:native = $counterfactual
Assert ((Get-TunnelBearProgramDecision $script:programs $script:native) -eq 'in_use' -and $script:stops.Count -eq 0) 'Cenario3 contrafactual Connected/DE preservado'
$script:native = $realDisconnected; $script:programs = @(Program 'Default' $true)
$blocked = $false
try { $null = Assert-TunnelBearProgramAvailable } catch { $blocked = $_.Exception.Message -eq 'TunnelBear em uso pelo Alex' }
Assert ($blocked -and $script:stops.Count -eq 0) 'Cenario3 janela visivel desconectada tem motivo proprio e zero toques'
$script:programs = @(Program 'Default')
Assert ((Assert-TunnelBearProgramAvailable) -eq 'collect') 'Cenario4 bandeja/minimizada com Disconnected real permite ciclo'
$result = Stop-TunnelBearProgram 'Default'
Assert ($result.closedCount -eq 1 -and $script:programs.Count -eq 0) 'Cenario4 fecha UI do Alex escondida e desligada'
$script:programs = @(Program 'Default'); $script:failClose = $true; $blocked = $false
try { $null = Stop-TunnelBearProgram 'Default' } catch { $blocked = $_.Exception.Message -match 'Falha de fechamento' }
Assert ($blocked -and $script:programs.Count -eq 1) 'Cenario5 falha nao remove UI nem cria bloqueio persistente'
$script:failClose = $false
$result = Stop-TunnelBearProgram 'Default'
Assert ($result.closedCount -eq 1) 'Cenario5 proximo ciclo tenta novamente e fecha'
foreach ($state in @($realPortugal, @{ Status = 'Unavailable' }, @{ Status = 'Connecting' })) {
  $script:programs = @(Program 'EdgeFinderCollection'); $script:native = $state; $script:stops = @(); $blocked = $false
  try { $null = Stop-TunnelBearProgram 'EdgeFinderCollection' } catch { $blocked = $_.Exception.Message -match 'TUNNELBEAR_PROGRAM_CLOSE_FAILED' }
  Assert ($blocked -and $script:stops.Count -eq 0) 'Fechamento exige prova nativa Disconnected'
}
$script:native = $realDisconnected; $script:programs = @(Program 'Default' $true); $script:stops = @()
$result = Stop-TunnelBearProgram 'EdgeFinderCollection'
Assert ($result.closedCount -eq 0 -and $script:stops.Count -eq 0) 'Limpeza final nunca fecha programa Default'
$folder = Join-Path ([IO.Path]::GetTempPath()) ('edge-origin-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $folder | Out-Null
try {
  $requestFile = Join-Path $folder 'test-origin-request.json'
  $created = [DateTimeOffset]::UtcNow.AddSeconds(-2)
  $request = @{ origin = 'test'; taskName = 'EdgeFinder-Betano-Local'; createdAt = $created.ToString('o'); expiresAt = $created.AddSeconds(120).ToString('o') }
  [IO.File]::WriteAllText($requestFile, ($request | ConvertTo-Json))
  Assert (-not (Use-TestCycleRequest $folder 'scheduler' ([DateTimeOffset]::UtcNow.ToString('o'))) -and (Test-Path $requestFile)) 'Marca test nunca consome evento107'
  Assert ((Use-TestCycleRequest $folder 'manual' ([DateTimeOffset]::UtcNow.ToString('o'))) -and -not (Test-Path $requestFile)) 'Evento110 consome test explicito uma unica vez'
  Assert (-not (Use-TestCycleRequest $folder 'manual' ([DateTimeOffset]::UtcNow.ToString('o')))) 'Sem pedido nao inventa origem test'
  $request.expiresAt = $created.AddSeconds(1).ToString('o')
  [IO.File]::WriteAllText($requestFile, ($request | ConvertTo-Json))
  Assert (-not (Use-TestCycleRequest $folder 'manual' ([DateTimeOffset]::UtcNow.ToString('o')))) 'Pedido expirado nao marca test'
} finally { Remove-Item -LiteralPath $folder -Recurse -Force }
[pscustomobject]@{ passed = $script:passed; failed = 0; simulated = $true;
  replay = 'native_vpn_real_20261102 e disconnected_adapter_up_20261103'; counterfactual = 'Country PT alterado para DE' } | ConvertTo-Json -Compress
