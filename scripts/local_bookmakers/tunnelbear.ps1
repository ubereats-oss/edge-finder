param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('connect', 'disconnect', 'meter', 'meter-once', 'state', 'prepare', 'minimize', 'library', 'recover', 'program-check', 'program-close')]
  [string]$Action,
  [ValidateRange(5, 90)]
  [int]$StableSeconds = 90
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
if ($Action -notin @('state', 'library')) {
  . (Join-Path $PSScriptRoot 'real_resource_lock.ps1')
  Enter-LocalResourceLock $PSCommandPath @($Action, '-StableSeconds', "$StableSeconds")
}
if ($Action -eq 'state') {
  $vpnAdapter = [System.Net.NetworkInformation.NetworkInterface]::GetAllNetworkInterfaces() |
    Where-Object { $_.Description -eq 'TunnelBear Adapter V9' } | Select-Object -First 1
  if (-not $vpnAdapter) { [Console]::Error.WriteLine('Adaptador VPN não encontrado.'); exit 1 }
  . (Join-Path $PSScriptRoot 'tunnelbear_installation.ps1')
  $native = $null
  try {
    $nativeFolder = Split-Path -Parent (Get-TunnelBearInstallation).Path
    $nativeJson = & 'C:\Program Files\nodejs\node.exe' (Join-Path $PSScriptRoot 'tunnelbear_native.cjs') $nativeFolder
    if ($LASTEXITCODE -eq 0) { $native = $nativeJson | ConvertFrom-Json }
  } catch {}
  [pscustomobject]@{ action = 'state'; status = $vpnAdapter.OperationalStatus.ToString();
    nativeStatus = $native.Status; nativeCountry = $native.Country;
    description = 'Estado da conexão VPN; consulta sem alteração' } | ConvertTo-Json -Compress
  exit 0
}
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
if (-not ('TunnelBearNativeWindow' -as [type])) {
  Add-Type 'using System; using System.Runtime.InteropServices; public class TunnelBearNativeWindow { [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow); [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd); }'
}
. (Join-Path $PSScriptRoot 'tunnelbear_installation.ps1')
. (Join-Path $PSScriptRoot 'tunnelbear_lifecycle.ps1')
. (Join-Path $PSScriptRoot 'tunnelbear_program.ps1')
. (Join-Path $PSScriptRoot 'tunnelbear_recovery.ps1')
. (Join-Path $PSScriptRoot 'safe_log.ps1')
$script:CycleOwnsVpn = $false
$script:TunnelBearRestarted = $env:EDGE_TUNNEL_RESTARTED -eq '1'

function Get-TunnelBearState {
  $window = Find-TunnelBearWindow
  if (-not $window) { throw 'Janela principal do TunnelBear não encontrada.' }
  if ($window.Current.Name -ne 'TunnelBear') { throw ('Aviso: ' + $window.Current.Name) }

  Handle-TunnelBearKnownScreens $window
  $dialogs = $window.FindAll([System.Windows.Automation.TreeScope]::Descendants,
    (New-Object System.Windows.Automation.PropertyCondition(
      [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
      [System.Windows.Automation.ControlType]::Window)))
  if ($dialogs.Count -gt 0) { throw 'Diálogo inesperado do TunnelBear.' }

  $idCondition = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::AutomationIdProperty, 'statusAccessibility')
  $statusElement = $window.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $idCondition)
  $switchCondition = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::AutomationIdProperty, 'vpnSwitch')
  $switchElement = $window.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $switchCondition)
  $countryCondition = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::AutomationIdProperty, 'cbxCountry')
  $countryElement = $window.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $countryCondition)
  if (-not $statusElement -or -not $switchElement -or -not $countryElement) {
    throw 'Controles de estado, VPN ou país do TunnelBear não estão acessíveis.'
  }

  $selectionPattern = $countryElement.GetCurrentPattern([System.Windows.Automation.SelectionPattern]::Pattern)
  $countries = @($selectionPattern.Current.GetSelection() | ForEach-Object {
    $_.Current.Name.Trim().TrimEnd(',', ';', ' ')
  })
  $togglePattern = $switchElement.GetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern)
  return @{
    Window = $window
    Status = $statusElement.Current.Name
    Countries = $countries
    Switch = $togglePattern
  }
}

function Wait-TunnelBearStatus([string]$Expected, [int]$TimeoutSeconds = 90) {
  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  do {
    $state = Get-TunnelBearState
    if ($state.Status -eq $Expected) { return $state }
    Start-Sleep -Milliseconds 500
  } while ([DateTime]::UtcNow -lt $deadline)
  throw "TunnelBear não atingiu o estado '$Expected'; estado observado: '$($state.Status)'."
}

function Get-VpnAdapter {
  return [System.Net.NetworkInformation.NetworkInterface]::GetAllNetworkInterfaces() |
    Where-Object { $_.Description -eq 'TunnelBear Adapter V9' } |
    Select-Object -First 1
}

. (Join-Path $PSScriptRoot 'vpn_proof.ps1')

function Get-TunnelBearSwitch {
  $root = [System.Windows.Automation.AutomationElement]::RootElement
  $windowCondition = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::NameProperty, 'TunnelBear')
  $window = $root.FindFirst([System.Windows.Automation.TreeScope]::Children, $windowCondition)
  if (-not $window) { throw 'Janela TunnelBear indisponível para clicar no interruptor.' }
  $switchCondition = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::AutomationIdProperty, 'vpnSwitch')
  $switch = $window.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $switchCondition)
  if (-not $switch) { throw 'Interruptor TunnelBear indisponível.' }
  return $switch.GetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern)
}

function Wait-VpnProof([bool]$Expected, [int]$TimeoutSeconds) {
  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  $checks = @()
  do {
    $at = [DateTime]::UtcNow
    $proof = Get-VpnProof -ForDisconnect:(-not $Expected)
    $check = [pscustomobject]@{ at = $at.ToString('o'); adapter = $proof.Adapter;
      country = $proof.Country; service = $proof.Service; nativeStatus = $proof.NativeStatus; nativeAt = $proof.NativeAt;
      connected = $proof.Connected; error = $proof.Error; elapsedMs = $proof.ElapsedMs;
      attempts = $proof.Attempts; windowMs = $proof.WindowMs }
    $checks += $check
    if ($Expected) { Write-ConnectionAttempt 1 'check' ($check | ConvertTo-Json -Depth 6 -Compress) }
    if (($Expected -and $proof.Connected) -or (-not $Expected -and $proof.Disconnected)) {
      $proof.Checks = $checks; return $proof
    }
    if ($Expected -and $proof.ProofWindowExhausted) { break }
    $remaining = 5 - ([DateTime]::UtcNow - $at).TotalSeconds
    if ($remaining -gt 0) { Start-Sleep -Milliseconds ([int]($remaining * 1000)) }
  } while ([DateTime]::UtcNow -lt $deadline)
  if (-not $Expected) { throw $proof.Error }
  throw "VPN sem confirmação: adaptador=$($proof.Adapter), TunnelBear=$($proof.NativeStatus), motivo=$($proof.Error)."
}

function Get-MeterReading([int]$StableSeconds = 90) {
  $last = $null
  $lastChangedAt = [DateTime]::UtcNow
  $deadline = [DateTime]::UtcNow.AddSeconds(180)
  do {
    try {
      $state = Get-TunnelBearState
      $texts = $state.Window.FindAll([System.Windows.Automation.TreeScope]::Descendants,
        [System.Windows.Automation.Condition]::TrueCondition)
      $reading = @($texts | ForEach-Object { $_.Current.Name } | Where-Object { $_ -match '^\d+ MB$' } | Select-Object -First 1)
      if ($reading.Count -gt 0) {
        if ($reading[0] -ne $last) {
          $last = $reading[0]
          $lastChangedAt = [DateTime]::UtcNow
        } elseif (([DateTime]::UtcNow - $lastChangedAt).TotalSeconds -ge $StableSeconds) {
          return [int]($last -replace '\D', '')
        }
      } else { $last = $null; $lastChangedAt = [DateTime]::UtcNow }
    } catch { $last = $null; $lastChangedAt = [DateTime]::UtcNow }
    Start-Sleep -Seconds 5
  } while ([DateTime]::UtcNow -lt $deadline)
  throw "Contador TunnelBear não ficou estável por $StableSeconds s em 180 s; última leitura: $last."
}

function Write-ConnectionAttempt([int]$Attempt, [string]$Status, [string]$Detail = '') {
  if (-not $env:EDGE_TUNNEL_ATTEMPT_LOG) { return }
  $record = [pscustomobject]@{
    at = [DateTime]::UtcNow.ToString('o')
    cycleId = $env:EDGE_TUNNEL_CYCLE_ID
    purpose = $env:EDGE_TUNNEL_PURPOSE
    attempt = $Attempt
    status = $Status
    detail = $Detail
  }
  Write-LocalSafeLog $env:EDGE_TUNNEL_ATTEMPT_LOG ($record | ConvertTo-Json -Compress)
}

if ($Action -eq 'library') { return }
try {
  if ($Action -eq 'program-check') {
    $decision = Get-TunnelBearProgramDecision (Get-TunnelBearProgram) (Get-TunnelBearNativeConnection)
    [pscustomobject]@{ action = $Action; decision = $decision;
      reason = $(if ($decision -eq 'in_use') { 'TunnelBear em uso pelo Alex' } else { $null }) } | ConvertTo-Json -Compress
  } elseif ($Action -eq 'program-close') {
    Stop-TunnelBearProgram 'EdgeFinderCollection' | ConvertTo-Json -Compress
  } elseif ($Action -eq 'recover') {
    Restart-UnresponsiveTunnelBear (Get-VpnProof -ForDisconnect) -Forced
    [pscustomobject]@{ action = 'recover'; adapter = (Get-VpnProof).Adapter } | ConvertTo-Json -Compress
  } elseif ($Action -eq 'prepare') {
    $prepared = Prepare-TunnelBearWindow
    [pscustomobject]@{ action = 'prepare'; status = 'ready'; adapter = $prepared.Proof.Adapter;
      connected = $prepared.Proof.Connected; connectedByCycle = $prepared.ConnectedByCycle } | ConvertTo-Json -Compress
  } elseif ($Action -eq 'minimize') {
    Minimize-TunnelBearWindow
    [pscustomobject]@{ action = 'minimize'; status = 'minimized' } | ConvertTo-Json -Compress
  } elseif ($Action -eq 'meter-once') {
    $root = [System.Windows.Automation.AutomationElement]::RootElement
    $condition = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, 'TunnelBear')
    $window = $root.FindFirst([System.Windows.Automation.TreeScope]::Children, $condition)
    if (-not $window) { throw 'Janela TunnelBear indisponível.' }
    $texts = $window.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
    $reading = $texts | ForEach-Object { $_.Current.Name } | Where-Object { $_ -match '^\d+ MB$' } | Select-Object -First 1
    if (-not $reading) { throw 'Saldo TunnelBear indisponível.' }
    [pscustomobject]@{ action = $Action; remainingMB = [int]($reading -replace '\D', '') } | ConvertTo-Json -Compress
  } elseif ($Action -eq 'connect') {
    $programDecision = Assert-TunnelBearProgramAvailable
    if ($programDecision -eq 'preserve') {
      $proof = Get-VpnProof
      if (-not $proof.Connected) { throw 'Conexão portuguesa preexistente sem confirmação; interface preservada.' }
      [pscustomobject]@{ action = 'connect'; status = 'connected'; country = 'PT'; adapter = $proof.Adapter;
        nativeStatus = $proof.NativeStatus; connectedByCycle = $false; vpnStartedAt = (Get-Date -Format o);
        programPreserved = $true; checks = @() } | ConvertTo-Json -Compress
      exit 0
    }
    try { $programClosed = Stop-TunnelBearProgram 'Default' }
    catch { throw ('TUNNELBEAR_PROGRAM_CLOSE_FAILED: ' + $_.Exception.Message) }
    Write-ConnectionAttempt 1 'started'
    $vpnStartedAt = Get-Date -Format o
    $prepared = Prepare-TunnelBearWindow
    $proof = $prepared.Initial
    $initialCheck = [pscustomobject]@{ at = [DateTime]::UtcNow.ToString('o'); adapter = $proof.Adapter;
      country = $proof.Country; service = $proof.Service; nativeStatus = $proof.NativeStatus; nativeAt = $proof.NativeAt;
      connected = $proof.Connected; error = $proof.Error; elapsedMs = $proof.ElapsedMs;
      attempts = $proof.Attempts; windowMs = $proof.WindowMs }
    Write-ConnectionAttempt 1 'check' ($initialCheck | ConvertTo-Json -Depth 6 -Compress)
    $checks = @($initialCheck)
    $connection = Connect-TunnelBearPrepared $prepared
    $proof = $connection.Proof
    $checks += $proof.Checks
    Write-ConnectionAttempt 1 'connected' "Adaptador=$($proof.Adapter), país=$($proof.Country)."
    [pscustomobject]@{ action = 'connect'; status = 'connected'; country = 'PT';
      adapter = $proof.Adapter; source = $proof.Service; nativeStatus = $proof.NativeStatus; attempt = 1;
      vpnStartedAt = $vpnStartedAt; connectedByCycle = $connection.ConnectedByCycle;
      programClosedBefore = $programClosed; checks = $checks } | ConvertTo-Json -Depth 6 -Compress
  } elseif ($Action -eq 'disconnect') {
    $script:CycleOwnsVpn = $true
    if ((Get-TunnelBearNativeConnection).Status -ne 'Disconnected') {
      $null = Prepare-TunnelBearWindow -ForDisconnect
      $script:CycleOwnsVpn = $true
      $switch = (Assert-TunnelBearWindow).Switch
      if ($switch.Current.ToggleState -ne [System.Windows.Automation.ToggleState]::Off) { $switch.Toggle() }
    }
    $null = Wait-VpnProof $false 30
    [pscustomobject]@{ action = 'disconnect'; status = 'disconnected'; vpnDisconnectedAt = (Get-Date -Format o) } | ConvertTo-Json -Compress
  } else {
    $meter = Get-MeterReading $StableSeconds
    [pscustomobject]@{ action = 'meter'; status = (Get-TunnelBearState).Status; remainingMB = $meter } | ConvertTo-Json -Compress
  }
} catch {
  $message = $_.Exception.Message
  if ($Action -eq 'meter-once') { [Console]::Error.WriteLine($message); exit 1 }
  try {
    if (-not $script:CycleOwnsVpn) { throw 'Conexão não pertence ao ciclo; nenhum clique de limpeza.' }
    $switch = (Assert-TunnelBearWindow).Switch
    if ($switch.Current.ToggleState -ne [System.Windows.Automation.ToggleState]::Off) {
      $switch.Toggle()
      $null = Wait-VpnProof $false 30
    }
  } catch {
    if ($script:CycleOwnsVpn) { $message += "; falha ao garantir VPN desligado: $($_.Exception.Message)" }
  }
  [Console]::Error.WriteLine((Protect-VpnReason $message))
  exit 1
}
