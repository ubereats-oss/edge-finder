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
  $null = [TunnelBearNativeWindow]::ShowWindowAsync([IntPtr]$Window.Current.NativeWindowHandle, 9)
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

function Save-TunnelBearUnexpectedWindow {
  Add-Type -AssemblyName System.Windows.Forms
  Add-Type -AssemblyName System.Drawing
  $directory = Join-Path $PSScriptRoot '..\..\.local_logs\betano'
  $null = [System.IO.Directory]::CreateDirectory($directory)
  $file = Join-Path $directory ('tunnelbear-unexpected-' + [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfff') + '.png')
  $bounds = [System.Windows.Forms.SystemInformation]::VirtualScreen
  $bitmap = New-Object System.Drawing.Bitmap($bounds.Width, $bounds.Height)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  try {
    $graphics.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
    $bitmap.Save($file, [System.Drawing.Imaging.ImageFormat]::Png)
  } finally { $graphics.Dispose(); $bitmap.Dispose() }
  return $file
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
