function Find-TunnelBearWindow {
  $ids = @(Get-Process -Name 'TunnelBear', 'TunnelBear.UI' -ErrorAction SilentlyContinue | ForEach-Object { $_.Id })
  $windows = [System.Windows.Automation.AutomationElement]::RootElement.FindAll(
    [System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)
  $owned = @($windows | Where-Object { $_.Current.ProcessId -in $ids })
  # An owned dialog takes precedence over the normal window: never dismiss it.
  return $owned | Sort-Object @{ Expression = { $_.Current.Name -eq 'TunnelBear' } } | Select-Object -First 1
}

function Start-TunnelBearWindow {
  $exe = @("${env:ProgramFiles(x86)}\TunnelBear\TunnelBear.exe", "$env:ProgramFiles\TunnelBear\TunnelBear.exe") |
    Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
  if (-not $exe) { throw 'TunnelBear não abriu: executável não encontrado.' }
  # Opening the visible app is explicitly required by the collector's preparation.
  Start-Process -FilePath $exe -WorkingDirectory (Split-Path -Parent $exe) -WindowStyle Normal | Out-Null
}

function Restore-TunnelBearWindow($Window) {
  $handle = [IntPtr]$Window.Current.NativeWindowHandle
  $null = [TunnelBearNativeWindow]::ShowWindowAsync($handle, 9)
  $deadline = [DateTime]::UtcNow.AddSeconds(2)
  while ([TunnelBearNativeWindow]::IsIconic($handle) -or $Window.Current.IsOffscreen) {
    if ([DateTime]::UtcNow -ge $deadline) { throw 'Janela TunnelBear não ficou visível.' }
    Start-Sleep -Milliseconds 100
  }
}

function Minimize-TunnelBearWindow {
  $window = Find-TunnelBearWindow
  if ($window) {
    $handle = [IntPtr]$window.Current.NativeWindowHandle
    $null = [TunnelBearNativeWindow]::ShowWindowAsync($handle, 6)
    $deadline = [DateTime]::UtcNow.AddSeconds(2)
    while (-not [TunnelBearNativeWindow]::IsIconic($handle)) {
      if ([DateTime]::UtcNow -ge $deadline) { throw 'TunnelBear não ficou minimizado.' }
      Start-Sleep -Milliseconds 100
    }
  }
}

function Save-TunnelBearUnexpectedWindow($Window = $null, [string]$Label = 'unexpected') {
  Add-Type -AssemblyName System.Windows.Forms
  Add-Type -AssemblyName System.Drawing
  $dataRoot = if ($env:EDGE_DATA_ROOT) { $env:EDGE_DATA_ROOT } else { Join-Path $PSScriptRoot '..\..' }
  $directory = Join-Path $dataRoot '.local_logs\betano'
  $null = [System.IO.Directory]::CreateDirectory($directory)
  $file = Join-Path $directory ('tunnelbear-' + $Label + '-' + [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfff') + '.png')
  if (-not $Window) { $Window = Find-TunnelBearWindow }
  if (-not $Window) { throw 'Janela indisponível para captura.' }
  $rectangle = $Window.Current.BoundingRectangle
  $bounds = New-Object System.Drawing.Rectangle([int]$rectangle.Left, [int]$rectangle.Top, [int]$rectangle.Width, [int]$rectangle.Height)
  $bitmap = New-Object System.Drawing.Bitmap($bounds.Width, $bounds.Height)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  try {
    if (-not ('TunnelBearWindowCapture' -as [type])) {
      Add-Type 'using System; using System.Runtime.InteropServices; public class TunnelBearWindowCapture { [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hwnd, IntPtr hdc, uint flags); }'
    }
    $dc = $graphics.GetHdc()
    try {
      if (-not [TunnelBearWindowCapture]::PrintWindow([IntPtr]$Window.Current.NativeWindowHandle, $dc, 2)) {
        throw 'PrintWindow não conseguiu capturar o TunnelBear.'
      }
    } finally { $graphics.ReleaseHdc($dc) }
    $bitmap.Save($file, [System.Drawing.Imaging.ImageFormat]::Png)
  } finally { $graphics.Dispose(); $bitmap.Dispose() }
  return $file
}

function Get-TunnelBearOverlay($Window) {
  $elements = @($Window.FindAll([System.Windows.Automation.TreeScope]::Descendants,
    [System.Windows.Automation.Condition]::TrueCondition) | Where-Object { -not $_.Current.IsOffscreen })
  $text = ($elements | ForEach-Object { $_.Current.Name }) -join ' | '
  $visible = @($elements | Where-Object { -not $_.Current.IsOffscreen })
  $unknown = @($visible | Where-Object { $_.Current.ControlType -eq [System.Windows.Automation.ControlType]::Window -or
    $_.Current.Name -match '(?i)^(Log in|Sign in|Warning|Alert|Aviso|Entrar)$|mandatory|required update|update required|must update|update to continue|atualiza.{0,8} obrigat' }).Count -gt 0
  $exhausted = $text -match '(?i)out of (free )?data|no data left|(?:data|bandwidth).{0,35}(?:exhausted|depleted|used up)|(?:used|reached).{0,30}(?:all|limit).{0,20}(?:data|bandwidth)|franquia.{0,30}(?:esgot|acab)|(?:^|\| )0 MB(?: \||$)'
  $titles = @($elements | Where-Object { $_.Current.Name -eq 'Upgrade your Bear' })
  $buy = @($elements | Where-Object { $_.Current.Name -eq 'Upgrade TunnelBear' -and
    $_.Current.ControlType -eq [System.Windows.Automation.ControlType]::Button })
  $plans = @($elements | Where-Object { $_.Current.Name -in @('Yearly', 'Monthly') -and
    $_.Current.ControlType -eq [System.Windows.Automation.ControlType]::RadioButton })
  $close = @()
  if ($buy.Count -eq 1) {
    $purchase = $buy[0].Current.BoundingRectangle
    $close = @($elements | Where-Object {
      $item = $_.Current; $rect = $item.BoundingRectangle
      $item.Name -ceq 'Close' -and $item.ControlType -eq [System.Windows.Automation.ControlType]::Button -and
      $item.IsEnabled -and -not $item.IsOffscreen -and $rect.Width -gt 0 -and $rect.Height -gt 0 -and
      $rect.Top -ge $purchase.Bottom -and $rect.Top -le ($purchase.Bottom + 120) -and
      [Math]::Abs(($rect.Left + $rect.Width / 2) - ($purchase.Left + $purchase.Width / 2)) -le 30
    })
  }
  $header = @($visible | Where-Object { $_.Current.Name -ceq 'Rawr! An update is available!' -and
    $_.Current.AutomationId -eq 'txtUpdateAvailable' })
  $update = @($visible | Where-Object { $_.Current.Name -ceq 'Update' -and $_.Current.ControlType -eq [System.Windows.Automation.ControlType]::Button })
  $news = @($visible | Where-Object { $_.Current.Name -ceq "What's new?" -and $_.Current.ControlType -eq [System.Windows.Automation.ControlType]::Button })
  $updateClose = @($visible | Where-Object { $_.Current.Name -ceq 'Close update popup' -and $_.Current.ControlType -eq [System.Windows.Automation.ControlType]::Button -and $_.Current.IsEnabled })
  $knownUpdate = $header.Count -eq 1 -and $update.Count -eq 1 -and $news.Count -eq 1
  if (($updateClose.Count -gt 0 -or $update.Count -gt 0 -or $news.Count -gt 0) -and -not $knownUpdate) { $unknown = $true }
  $otherButtons = @($visible | Where-Object { $_.Current.ControlType -eq [System.Windows.Automation.ControlType]::Button -and
    $_.Current.Name -notmatch '^(|VPN|Turn TunnelBear on|Turn TunnelBear off|Upgrade|Upgrade TunnelBear|Close|Close update popup|Update|What.s new\?|Minimize|Maximize|Restore|Mini mode|Exit mini mode|Menu open\..*)$' })
  if ($otherButtons.Count -gt 0) { $unknown = $true }
  return @{ Exhausted = $exhausted; Unknown = $unknown; Update = $knownUpdate; Header = $header; UpdateClose = $updateClose;
    BandElements = @($header) + @($update) + @($news) + @($updateClose);
    Promotion = (-not $unknown -and $titles.Count -eq 1 -and $buy.Count -eq 1 -and
      @($plans | Where-Object { $_.Current.Name -eq 'Yearly' }).Count -eq 1 -and
      @($plans | Where-Object { $_.Current.Name -eq 'Monthly' }).Count -eq 1);
    Close = $close; Text = $text }
}

function Test-TunnelBearSwitchAccessible($Window, $Overlay) {
  $condition = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::AutomationIdProperty, 'vpnSwitch')
  $element = $Window.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $condition)
  if (-not $element -or -not $element.Current.IsEnabled -or $element.Current.IsOffscreen) { return $false }
  $rect = $element.Current.BoundingRectangle
  if ($rect.Width -le 0 -or $rect.Height -le 0) { return $false }
  foreach ($part in $Overlay.BandElements) {
    $band = $part.Current.BoundingRectangle
    if ($rect.Left -lt $band.Right -and $rect.Right -gt $band.Left -and
        $rect.Top -lt $band.Bottom -and $rect.Bottom -gt $band.Top) { return $false }
  }
  return $true
}

function Handle-TunnelBearKnownScreens($Window) {
  $overlay = Get-TunnelBearOverlay $Window
  if ($overlay.Exhausted) { Close-TunnelBearPromotion $Window; return }
  $issue = if ($overlay.Text -match '(?i)log[ -]?in|sign[ -]?in|entrar na conta') { 'TUNNELBEAR_LOGIN_REQUIRED' }
    elseif ($overlay.Text -match '(?i)mandatory|required update|update required|must update|update to continue|atualiza.{0,12}obrigat') { 'TUNNELBEAR_UPDATE_REQUIRED' }
    elseif ($overlay.Text -match '(?i)subscription.{0,25}(expired|required)|assinatura.{0,25}(vencid|expir)') { 'TUNNELBEAR_SUBSCRIPTION_REQUIRED' }
  if ($issue) { $capture = Save-TunnelBearUnexpectedWindow $Window 'action-required'; throw "$issue; captura=$capture" }
  if ($overlay.Unknown) {
    $capture = Save-TunnelBearUnexpectedWindow $Window 'unknown'
    throw "Janela desconhecida do TunnelBear; captura=$capture"
  }
  if ($overlay.Promotion) { Close-TunnelBearPromotion $Window; $overlay = Get-TunnelBearOverlay $Window }
  if ($overlay.Update) {
    $before = Save-TunnelBearUnexpectedWindow $Window 'update-before'
    $status = 'update_ignored'
    if (-not (Test-TunnelBearSwitchAccessible $Window $overlay)) {
      if ($overlay.UpdateClose.Count -ne 1) { throw "X da faixa não encontrado com segurança; captura=$before" }
      $close = $overlay.UpdateClose[0]; $rect = $close.Current.BoundingRectangle
      $header = $overlay.Header[0].Current.BoundingRectangle
      if ($rect.Width -le 0 -or $rect.Height -le 0 -or [Math]::Abs($rect.Top - $header.Top) -gt 35) {
        throw "X da faixa fora da posição esperada; captura=$before"
      }
      $invoke = $null
      if (-not $close.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$invoke)) {
        throw "X da faixa sem Invoke seguro; captura=$before"
      }
      $invoke.Invoke(); Start-Sleep -Milliseconds 350
      $afterOverlay = Get-TunnelBearOverlay $Window
      if ($afterOverlay.Update -or $afterOverlay.Unknown -or $afterOverlay.Exhausted -or
          -not (Test-TunnelBearSwitchAccessible $Window $afterOverlay)) { throw 'Faixa não foi dispensada com segurança.' }
      $status = 'update_closed'
    }
    $after = Save-TunnelBearUnexpectedWindow $Window 'update-after'
    Write-ConnectionAttempt 1 $status (@{ before = $before; after = $after; switchAccessible = $true } | ConvertTo-Json -Compress)
  }
}

function Close-TunnelBearPromotion($Window) {
  $overlay = Get-TunnelBearOverlay $Window
  if ($overlay.Exhausted) {
    $capture = Save-TunnelBearUnexpectedWindow $Window 'data-exhausted'
    Write-ConnectionAttempt 1 'data_exhausted' ($capture)
    throw "TUNNELBEAR_DATA_EXHAUSTED: franquia de dados esgotada; captura=$capture"
  }
  if (-not $overlay.Promotion) { return }
  $before = Save-TunnelBearUnexpectedWindow $Window 'upgrade-before'
  if ($overlay.Close.Count -ne 1) { throw "Close interno não encontrado com segurança; captura=$before" }
  $invoke = $null
  if (-not $overlay.Close[0].TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$invoke)) {
    throw "Close interno sem Invoke seguro; captura=$before"
  }
  $invoke.Invoke()
  Start-Sleep -Milliseconds 350
  $after = Save-TunnelBearUnexpectedWindow $Window 'upgrade-after'
  $remaining = Get-TunnelBearOverlay $Window
  if ($remaining.Promotion -or $remaining.Exhausted) { throw "Tela Upgrade não foi dispensada; antes=$before; depois=$after" }
  Write-ConnectionAttempt 1 'upgrade_closed' (@{ button = 'Close'; before = $before; after = $after } | ConvertTo-Json -Compress)
}

function Assert-TunnelBearWindow {
  try { return Get-TunnelBearState }
  catch {
    $detail = $_.Exception.Message
    try { $capture = Save-TunnelBearUnexpectedWindow }
    catch { $capture = 'captura falhou: ' + $_.Exception.Message }
    throw "Janela inesperada do TunnelBear: $detail; captura=$capture"
  }
}

function Prepare-TunnelBearWindow([switch]$ForDisconnect) {
  $initial = Get-VpnProof
  Restart-UnresponsiveTunnelBear $initial
  if ($initial.Adapter -eq 'Up' -and -not $initial.Connected -and -not $ForDisconnect) {
    throw 'VPN com placa Up sem confirmação de IP de Portugal; nenhum clique autorizado.'
  }
  $deadline = [DateTime]::UtcNow.AddSeconds(30)
  $window = Find-TunnelBearWindow
  if (-not $window) { Start-TunnelBearWindow }
  while (-not $window) {
    if ([DateTime]::UtcNow -ge $deadline) { throw 'TunnelBear não abriu' }
    Start-Sleep -Milliseconds 250
    $window = Find-TunnelBearWindow
  }
  Restore-TunnelBearWindow $window
  # A freshly opened WPF window can exist before its controls are initialized.
  do {
    try { $state = Get-TunnelBearState; break }
    catch {
      if ($_.Exception.Message -ne 'Controles de estado, VPN ou país do TunnelBear não estão acessíveis.' -or
          [DateTime]::UtcNow -ge $deadline) { $null = Assert-TunnelBearWindow }
      Start-Sleep -Milliseconds 250
    }
  } while ([DateTime]::UtcNow -lt $deadline)
  if (-not $state) { $null = Assert-TunnelBearWindow }
  $proof = Get-VpnProof
  $script:CycleOwnsVpn = -not $initial.Connected -and ($proof.Adapter -eq 'Up' -or
    $state.Switch.Current.ToggleState -eq [System.Windows.Automation.ToggleState]::On)
  return @{ Initial = $initial; Proof = $proof; State = $state; ConnectedByCycle = $script:CycleOwnsVpn }
}

function Connect-TunnelBearPrepared($Prepared) {
  $proof = Get-VpnProof
  if (-not $proof.Connected) {
    $state = Assert-TunnelBearWindow
    if ($state.Countries -notcontains 'Portugal') { throw 'País selecionado no TunnelBear não é Portugal.' }
    if (-not $Prepared.Initial.Connected -and
        $state.Switch.Current.ToggleState -eq [System.Windows.Automation.ToggleState]::On) {
      $script:CycleOwnsVpn = $true
    } else {
      if ($proof.Adapter -ne 'Down') { throw "VPN não comprovadamente desligada: adaptador=$($proof.Adapter)." }
      if ($state.Switch.Current.ToggleState -ne [System.Windows.Automation.ToggleState]::Off) {
        throw 'Interruptor não está desligado; nenhum clique autorizado.'
      }
      $script:CycleOwnsVpn = $true
      $state.Switch.Toggle()
    }
    $proof = Wait-VpnProof $true 60
  }
  return @{ Proof = $proof; ConnectedByCycle = $script:CycleOwnsVpn }
}
