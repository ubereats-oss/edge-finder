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
    $lastError = $null
    for ($attempt = 1; $attempt -le 1; $attempt++) {
      try {
        Write-ConnectionAttempt $attempt 'started'
        $state = Get-TunnelBearState
        if (-not ($state.Countries -contains 'Portugal')) {
          throw "Portugal não está selecionado no TunnelBear (seleção atual: $($state.Countries -join ', '))."
        }
        $vpnStartedAt = Get-Date -Format o
        if ($state.Status -eq 'Disconnected') { $state.Switch.Toggle() }
        $state = Wait-TunnelBearStatus 'Connection secured' 120
        $ipConfirmed = $false
        for ($probe = 1; $probe -le 3; $probe++) {
          try {
            $ipWho = Invoke-RestMethod -Uri 'https://ipwho.is/' -TimeoutSec 20
            $ipApi = Invoke-RestMethod -Uri 'https://ipapi.co/json/' -TimeoutSec 20
            if ($ipWho.success -eq $true -and $ipWho.country_code -eq 'PT' -and $ipApi.country_code -eq 'PT') {
              $ipConfirmed = $true
              break
            }
            $lastError = "IP não confirmado como português nos dois serviços (ipwho=$($ipWho.country_code), ipapi=$($ipApi.country_code))."
          } catch { $lastError = $_.Exception.Message }
          if ($probe -lt 3) { Start-Sleep -Seconds 5 }
        }
        if (-not $ipConfirmed) { throw $lastError }
        Write-ConnectionAttempt $attempt 'connected' 'Portugal confirmado em dois serviços de IP.'
        [pscustomobject]@{ action = 'connect'; status = 'connected'; country = 'PT'; attempt = $attempt; vpnStartedAt = $vpnStartedAt } | ConvertTo-Json -Compress
        exit 0
      } catch {
        $lastError = $_.Exception.Message
        Write-ConnectionAttempt $attempt 'failed' $lastError
        try {
          $state = Get-TunnelBearState
          if ($state.Status -ne 'Disconnected') { $state.Switch.Toggle(); $null = Wait-TunnelBearStatus 'Disconnected' 30 }
        } catch { $lastError += "; falha ao desligar antes de nova tentativa: $($_.Exception.Message)" }
      }
    }
    throw "Falha de conexão na única tentativa deste ciclo: $lastError"
  } elseif ($Action -eq 'disconnect') {
    $state = Get-TunnelBearState
    if ($state.Status -ne 'Disconnected') {
      $state.Switch.Toggle()
    }
    $null = Wait-TunnelBearStatus 'Disconnected'
    [pscustomobject]@{ action = 'disconnect'; status = 'disconnected'; vpnDisconnectedAt = (Get-Date -Format o) } | ConvertTo-Json -Compress
  } else {
    $meter = Get-MeterReading $StableSeconds
    [pscustomobject]@{ action = 'meter'; status = (Get-TunnelBearState).Status; remainingMB = $meter } | ConvertTo-Json -Compress
  }
} catch {
  $message = $_.Exception.Message
  if ($Action -eq 'meter-once') { [Console]::Error.WriteLine($message); exit 1 }
  try {
    $state = Get-TunnelBearState
    if ($state.Status -ne 'Disconnected') {
      $state.Switch.Toggle()
      $null = Wait-TunnelBearStatus 'Disconnected'
    }
  } catch {
    $message += "; falha ao garantir VPN desligado: $($_.Exception.Message)"
  }
  [Console]::Error.WriteLine($message)
  exit 1
}
