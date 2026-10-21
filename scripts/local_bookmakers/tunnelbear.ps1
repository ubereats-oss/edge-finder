param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('connect', 'disconnect', 'meter')]
  [string]$Action
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

function Get-MeterReading([int]$StableSamples = 3) {
  $last = $null
  $stable = 0
  $deadline = [DateTime]::UtcNow.AddSeconds(60)
  do {
    try {
      $state = Get-TunnelBearState
      $texts = $state.Window.FindAll([System.Windows.Automation.TreeScope]::Descendants,
        [System.Windows.Automation.Condition]::TrueCondition)
      $reading = @($texts | ForEach-Object { $_.Current.Name } | Where-Object { $_ -match '^\d+ MB$' } | Select-Object -First 1)
      if ($reading.Count -gt 0) {
        if ($reading[0] -eq $last) { $stable++ } else { $last = $reading[0]; $stable = 1 }
        if ($stable -ge $StableSamples) { return [int]($last -replace '\D', '') }
      } else { $stable = 0 }
    } catch { $stable = 0 }
    Start-Sleep -Seconds 5
  } while ([DateTime]::UtcNow -lt $deadline)
  throw "Contador TunnelBear não estabilizou em 60s; última leitura: $last."
}

try {
  if ($Action -eq 'connect') {
    $lastError = $null
    for ($attempt = 1; $attempt -le 3; $attempt++) {
      try {
        $state = Get-TunnelBearState
        if (-not ($state.Countries -contains 'Portugal')) {
          throw "Portugal não está selecionado no TunnelBear (seleção atual: $($state.Countries -join ', '))."
        }
        if ($state.Status -eq 'Disconnected') { $state.Switch.Toggle() }
        $state = Wait-TunnelBearStatus 'Connection secured' 90
        $ipWho = Invoke-RestMethod -Uri 'https://ipwho.is/' -TimeoutSec 20
        $ipApi = Invoke-RestMethod -Uri 'http://ip-api.com/json/?fields=status,countryCode' -TimeoutSec 20
        if ($ipWho.success -ne $true -or $ipWho.country_code -ne 'PT' -or $ipApi.status -ne 'success' -or $ipApi.countryCode -ne 'PT') {
          throw "IP não confirmado como português nos dois serviços (ipwho=$($ipWho.country_code), ip-api=$($ipApi.countryCode))."
        }
        [pscustomobject]@{ action = 'connect'; status = 'connected'; country = 'PT'; attempt = $attempt } | ConvertTo-Json -Compress
        exit 0
      } catch {
        $lastError = $_.Exception.Message
        try {
          $state = Get-TunnelBearState
          if ($state.Status -ne 'Disconnected') { $state.Switch.Toggle(); $null = Wait-TunnelBearStatus 'Disconnected' 30 }
        } catch { $lastError += "; falha ao desligar antes de nova tentativa: $($_.Exception.Message)" }
        if ($attempt -lt 3) { Start-Sleep -Seconds 2 }
      }
    }
    throw "Falha de conexão após 3 tentativas: $lastError"
  } elseif ($Action -eq 'disconnect') {
    $state = Get-TunnelBearState
    if ($state.Status -ne 'Disconnected') {
      $state.Switch.Toggle()
    }
    $null = Wait-TunnelBearStatus 'Disconnected'
    [pscustomobject]@{ action = 'disconnect'; status = 'disconnected' } | ConvertTo-Json -Compress
  } else {
    $meter = Get-MeterReading
    [pscustomobject]@{ action = 'meter'; status = (Get-TunnelBearState).Status; remainingMB = $meter } | ConvertTo-Json -Compress
  }
} catch {
  $message = $_.Exception.Message
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
