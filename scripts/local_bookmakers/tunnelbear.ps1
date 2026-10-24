param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('connect', 'disconnect', 'meter', 'meter-once', 'state', 'prepare', 'minimize', 'library', 'recover')]
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
  [pscustomobject]@{ action = 'state'; status = $vpnAdapter.OperationalStatus.ToString();
    description = 'Estado da conexão VPN; consulta sem alteração' } | ConvertTo-Json -Compress
  exit 0
}
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
if (-not ('TunnelBearNativeWindow' -as [type])) {
  Add-Type 'using System; using System.Runtime.InteropServices; public class TunnelBearNativeWindow { [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow); [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd); }'
}
. (Join-Path $PSScriptRoot 'tunnelbear_lifecycle.ps1')
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

function Get-VpnProof {
  $adapter = Get-VpnAdapter
  if (-not $adapter) { return @{ Connected = $false; Adapter = 'NotFound'; Country = $null;
      Error = 'Adaptador TunnelBear Adapter V9 não encontrado.' } }
  if ($adapter.OperationalStatus -ne [System.Net.NetworkInformation.OperationalStatus]::Up) {
    return @{ Connected = $false; Adapter = $adapter.OperationalStatus.ToString(); Country = $null }
  }
  $errors = @()
  try {
    $ip = Invoke-RestMethod -Uri 'https://ipwho.is/' -TimeoutSec 3
    if ($ip.success -eq $true -and $ip.country_code -eq 'PT') {
      return @{ Connected = $true; Adapter = 'Up'; Country = 'PT'; PublicIp = $ip.ip; Service = 'ipwho.is' }
    }
    $errors += "ipwho.is: $($ip.country_code)"
  } catch { $errors += "ipwho.is: $($_.Exception.Message)" }
  try {
    $ip = Invoke-RestMethod -Uri 'https://ipapi.co/json/' -TimeoutSec 3
    return @{ Connected = ($ip.country_code -eq 'PT'); Adapter = 'Up'; Country = $ip.country_code;
      PublicIp = $ip.ip; Service = 'ipapi.co'; Error = ($errors -join '; ') }
  } catch {
    $errors += "ipapi.co: $($_.Exception.Message)"
    return @{ Connected = $false; Adapter = 'Up'; Country = $null; Error = ($errors -join '; ') }
  }
}

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
    $proof = Get-VpnProof
    $check = [pscustomobject]@{ at = $at.ToString('o'); adapter = $proof.Adapter;
      country = $proof.Country; publicIp = $proof.PublicIp; service = $proof.Service;
      connected = $proof.Connected; error = $proof.Error }
    $checks += $check
    if ($Expected) { Write-ConnectionAttempt 1 'check' ($check | ConvertTo-Json -Compress) }
    if (($Expected -and $proof.Connected) -or (-not $Expected -and $proof.Adapter -eq 'Down')) {
      $proof.Checks = $checks; return $proof
    }
    $remaining = 5 - ([DateTime]::UtcNow - $at).TotalSeconds
    if ($remaining -gt 0) { Start-Sleep -Milliseconds ([int]($remaining * 1000)) }
  } while ([DateTime]::UtcNow -lt $deadline)
  throw "VPN sem confirmação pela placa e IP português: adaptador=$($proof.Adapter), país=$($proof.Country), erro=$($proof.Error)."
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
  if ($Action -eq 'recover') {
    Restart-UnresponsiveTunnelBear @{ Adapter = 'Down' } -Forced
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
    Write-ConnectionAttempt 1 'started'
    $vpnStartedAt = Get-Date -Format o
    $prepared = Prepare-TunnelBearWindow
    $proof = $prepared.Initial
    $initialCheck = [pscustomobject]@{ at = [DateTime]::UtcNow.ToString('o'); adapter = $proof.Adapter;
      country = $proof.Country; publicIp = $proof.PublicIp; service = $proof.Service;
      connected = $proof.Connected; error = $proof.Error }
    Write-ConnectionAttempt 1 'check' ($initialCheck | ConvertTo-Json -Compress)
    $checks = @($initialCheck)
    $connection = Connect-TunnelBearPrepared $prepared
    $proof = $connection.Proof
    $checks += $proof.Checks
    Write-ConnectionAttempt 1 'connected' "Adaptador=$($proof.Adapter), país=$($proof.Country)."
    [pscustomobject]@{ action = 'connect'; status = 'connected'; country = 'PT';
      publicIp = $proof.PublicIp; adapter = $proof.Adapter; attempt = 1;
      vpnStartedAt = $vpnStartedAt; connectedByCycle = $connection.ConnectedByCycle;
      checks = $checks } | ConvertTo-Json -Depth 6 -Compress
  } elseif ($Action -eq 'disconnect') {
    $script:CycleOwnsVpn = $true
    if ((Get-VpnProof).Adapter -ne 'Down') {
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
  [Console]::Error.WriteLine($message)
  exit 1
}
