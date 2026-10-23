param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('connect', 'disconnect', 'meter', 'meter-once')]
  [string]$Action,
  [ValidateRange(5, 90)]
  [int]$StableSeconds = 90
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

function Get-TunnelBearState {
  $root = [System.Windows.Automation.AutomationElement]::RootElement
  $windowCondition = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::NameProperty, 'TunnelBear')
  $window = $root.FindFirst([System.Windows.Automation.TreeScope]::Children, $windowCondition)
  if (-not $window) { throw 'Janela principal do TunnelBear não encontrada.' }

  $popupCondition = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::NameProperty, 'Close update popup')
  $updatePopupClose = $window.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $popupCondition)
  if ($updatePopupClose) {
    $invokePattern = $updatePopupClose.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
    $invokePattern.Invoke()
    Start-Sleep -Milliseconds 500
  }

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
    Where-Object { $_.Name -eq 'Ethernet 2' -and $_.Description -eq 'TunnelBear Adapter V9' } |
    Select-Object -First 1
}

function Get-VpnProof {
  $adapter = Get-VpnAdapter
  if (-not $adapter) { throw 'Adaptador TunnelBear Adapter V9 não encontrado.' }
  if ($adapter.OperationalStatus -ne [System.Net.NetworkInformation.OperationalStatus]::Up) {
    return @{ Connected = $false; Adapter = $adapter.OperationalStatus.ToString(); Country = $null }
  }
  try {
    $ip = Invoke-RestMethod -Uri 'https://ipwho.is/' -TimeoutSec 8
    return @{ Connected = ($ip.success -eq $true -and $ip.country_code -eq 'PT');
      Adapter = 'Up'; Country = $ip.country_code; PublicIp = $ip.ip }
  } catch {
    return @{ Connected = $false; Adapter = 'Up'; Country = $null; Error = $_.Exception.Message }
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
  do {
    $proof = Get-VpnProof
    if ($proof.Connected -eq $Expected) { return $proof }
    Start-Sleep -Seconds 2
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
  Add-Content -LiteralPath $env:EDGE_TUNNEL_ATTEMPT_LOG -Value ($record | ConvertTo-Json -Compress) -Encoding UTF8
}

try {
  if ($Action -eq 'meter-once') {
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
    $proof = Get-VpnProof
    if (-not $proof.Connected) {
      $switch = Get-TunnelBearSwitch
      if ($switch.Current.ToggleState -eq [System.Windows.Automation.ToggleState]::Off) { $switch.Toggle() }
      $proof = Wait-VpnProof $true 90
    }
    Write-ConnectionAttempt 1 'connected' "Adaptador=$($proof.Adapter), país=$($proof.Country)."
    [pscustomobject]@{ action = 'connect'; status = 'connected'; country = 'PT';
      publicIp = $proof.PublicIp; adapter = $proof.Adapter; attempt = 1; vpnStartedAt = $vpnStartedAt } | ConvertTo-Json -Compress
  } elseif ($Action -eq 'disconnect') {
    $switch = Get-TunnelBearSwitch
    if ($switch.Current.ToggleState -ne [System.Windows.Automation.ToggleState]::Off) { $switch.Toggle() }
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
    $switch = Get-TunnelBearSwitch
    if ($switch.Current.ToggleState -ne [System.Windows.Automation.ToggleState]::Off) {
      $switch.Toggle()
      $null = Wait-VpnProof $false 30
    }
  } catch {
    $message += "; falha ao garantir VPN desligado: $($_.Exception.Message)"
  }
  [Console]::Error.WriteLine($message)
  exit 1
}
