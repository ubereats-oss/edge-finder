. (Join-Path $PSScriptRoot 'test_tunnelbear_promotion.ps1')
function Update-Scenario {
  Scenario
  $script:switch = Element 'VPN' ([System.Windows.Automation.ControlType]::Button) 0
  $header = Element 'Rawr! An update is available!' ([System.Windows.Automation.ControlType]::Text) 100
  $header.Current.AutomationId = 'txtUpdateAvailable'
  $script:elements = @($script:switch, $header,
    (Element 'Update' ([System.Windows.Automation.ControlType]::Button) 100),
    (Element "What's new?" ([System.Windows.Automation.ControlType]::Button) 100),
    (Element 'Close update popup' ([System.Windows.Automation.ControlType]::Button) 100))
  foreach ($item in $script:elements) { $item.Current.BoundingRectangle.Right = 200 }
  $script:window | Add-Member ScriptMethod FindFirst { param($Scope, $Condition) return $script:switch }
  $script:invoker = [pscustomobject]@{}
  $script:invoker | Add-Member ScriptMethod Invoke { $script:clicked++; $script:elements = @($script:switch) }
}
Update-Scenario
Handle-TunnelBearKnownScreens $script:window
Assert ($script:clicked -eq 0 -and $script:events[0].Status -eq 'update_ignored' -and $script:captures.Count -eq 2) 'Accessible switch: banner ignored with two captures and no click'
$script:passed++
Update-Scenario
$script:switch.Current.BoundingRectangle.Top = 100
$script:switch.Current.BoundingRectangle.Bottom = 125
# Closing the covering banner exposes the switch without changing its state.
$script:invoker | Add-Member ScriptMethod Invoke { $script:clicked++; $script:elements = @($script:switch) } -Force
Handle-TunnelBearKnownScreens $script:window
Assert ($script:clicked -eq 1 -and $script:events[0].Status -eq 'update_closed') 'Covering banner: only its named X is invoked'
$script:passed++
foreach ($case in @('missing', 'ambiguous', 'unsupported', 'mandatory', 'unknown')) {
  Update-Scenario
  $script:switch.Current.BoundingRectangle.Top = 100
  $script:switch.Current.BoundingRectangle.Bottom = 125
  if ($case -eq 'missing') { $script:elements = @($script:elements | Where-Object { $_.Current.Name -ne 'Close update popup' }) }
  if ($case -eq 'ambiguous') { $script:elements += $script:elements[-1] }
  if ($case -eq 'unsupported') { $script:unsupported = $true }
  if ($case -eq 'mandatory') { $script:elements += Element 'Update required to continue' ([System.Windows.Automation.ControlType]::Text) 100 }
  if ($case -eq 'unknown') { $script:elements += Element 'Warning' ([System.Windows.Automation.ControlType]::Text) 100 }
  $blocked = $false
  try { Handle-TunnelBearKnownScreens $script:window } catch { $blocked = $true }
  Assert ($blocked -and $script:clicked -eq 0 -and $script:captures.Count -gt 0) "Unsafe/unknown banner $case blocks without a click"
  $script:passed++
}
[pscustomobject]@{ passed = $script:passed; failed = 0; simulated = $true } | ConvertTo-Json -Compress
