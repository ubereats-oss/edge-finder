$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'tunnelbear.ps1') -Action library
$script:passed = 0
function Assert($Condition, $Message) { if (-not $Condition) { throw $Message } }
function Element($Name, $Type, $Top, $Width = 180) {
  $element = [pscustomobject]@{ Current = @{ Name = $Name; ControlType = $Type; IsEnabled = $true; IsOffscreen = $false;
    BoundingRectangle = @{ Left = 20; Top = $Top; Width = $Width; Height = 25; Bottom = $Top + 25 } } }
  $element | Add-Member ScriptMethod TryGetCurrentPattern {
    param($Pattern, $Output)
    if ($script:unsupported) { return $false }
    $Output.Value = $script:invoker; return $true
  }
  return $element
}
function Scenario {
  $script:clicked = 0; $script:captures = @(); $script:events = @(); $script:unsupported = $false
  $script:invoker = [pscustomobject]@{}
  $script:invoker | Add-Member ScriptMethod Invoke { $script:clicked++; $script:elements = @() }
  $script:elements = @(
    (Element 'Upgrade your Bear' ([System.Windows.Automation.ControlType]::Text) 0),
    (Element 'Yearly' ([System.Windows.Automation.ControlType]::RadioButton) 50),
    (Element 'Monthly' ([System.Windows.Automation.ControlType]::RadioButton) 50),
    (Element 'Upgrade TunnelBear' ([System.Windows.Automation.ControlType]::Button) 200),
    (Element 'Close' ([System.Windows.Automation.ControlType]::Button) 230),
    (Element 'Close' ([System.Windows.Automation.ControlType]::Button) -30 25)
  )
  $script:window = [pscustomobject]@{}
  $script:window | Add-Member ScriptMethod FindAll { param($Scope, $Condition) return ,$script:elements }
}
function Save-TunnelBearUnexpectedWindow($Window, $Label) { $script:captures += $Label; return "simulated-$Label.png" }
function Write-ConnectionAttempt($Attempt, $Status, $Detail) { $script:events += @{ Status = $Status; Detail = $Detail } }
Scenario
Close-TunnelBearPromotion $script:window
Assert ($script:clicked -eq 1 -and $script:captures.Count -eq 2 -and $script:events[0].Status -eq 'upgrade_closed') 'Only internal Close invoked with before/after evidence'
$script:passed++
foreach ($case in @('missing', 'ambiguous', 'unsupported')) {
  Scenario
  if ($case -eq 'missing') { $script:elements = @($script:elements | Where-Object { $_.Current.BoundingRectangle.Top -ne 230 }) }
  if ($case -eq 'ambiguous') { $script:elements += Element 'Close' ([System.Windows.Automation.ControlType]::Button) 230 }
  if ($case -eq 'unsupported') { $script:unsupported = $true }
  $blocked = $false
  try { Close-TunnelBearPromotion $script:window } catch { $blocked = $true }
  Assert ($blocked -and $script:clicked -eq 0 -and $script:captures.Count -eq 1) "Unsafe Close $case blocks without any click"
  $script:passed++
}
foreach ($notice in @('You are out of data', 'Your data allowance is exhausted', '0 MB', 'Franquia de dados esgotada')) {
  Scenario
  $script:elements += Element $notice ([System.Windows.Automation.ControlType]::Text) 100
  $blocked = $false
  try { Close-TunnelBearPromotion $script:window } catch { $blocked = $_.Exception.Message -match 'TUNNELBEAR_DATA_EXHAUSTED' }
  Assert ($blocked -and $script:clicked -eq 0 -and $script:events[0].Status -eq 'data_exhausted') 'Quota exhaustion never dismissed'
  $script:passed++
}
Scenario
$script:elements = @((Element 'Unknown warning' ([System.Windows.Automation.ControlType]::Text) 10))
Close-TunnelBearPromotion $script:window
Assert ($script:clicked -eq 0) 'Unknown screen untouched for existing state guard'
$script:passed++
Scenario
$script:elements += Element 'Unknown dialog' ([System.Windows.Automation.ControlType]::Window) 50
Close-TunnelBearPromotion $script:window
Assert ($script:clicked -eq 0) 'Unknown dialog over promotion must not be bypassed'
$script:passed++
[pscustomobject]@{ passed = $script:passed; failed = 0; simulated = $true } | ConvertTo-Json -Compress
