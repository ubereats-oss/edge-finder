function Invoke-PortugalProbe([string]$Uri, [int]$TimeoutMs) {
  Add-Type -AssemblyName System.Net.Http
  $client = New-Object System.Net.Http.HttpClient
  $cancel = New-Object System.Threading.CancellationTokenSource
  try {
    $cancel.CancelAfter($TimeoutMs)
    $task = $client.GetAsync($Uri, [System.Net.Http.HttpCompletionOption]::ResponseContentRead, $cancel.Token)
    if ([Threading.Tasks.Task]::WaitAny([Threading.Tasks.Task[]]@($task), $TimeoutMs) -lt 0) {
      throw 'tempo limite atingido'
    }
    $response = $task.GetAwaiter().GetResult()
    if (-not $response.IsSuccessStatusCode) { throw "HTTP $([int]$response.StatusCode)" }
    return $response.Content.ReadAsStringAsync().GetAwaiter().GetResult() | ConvertFrom-Json
  } catch {
    if ($cancel.IsCancellationRequested) { throw 'tempo limite atingido' }
    $cause = $_.Exception
    while ($cause.InnerException) { $cause = $cause.InnerException }
    throw (Protect-VpnReason $cause.Message)
  } finally { $cancel.Cancel(); $cancel.Dispose(); $client.Dispose() }
}

function Protect-VpnReason([string]$Text) {
  $safe = $Text -replace 'https?://[^\s<>]+', '[URL removida]'
  $safe = $safe -replace '[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}', '[dado removido]'
  $safe = $safe -replace '\b(?:\d{1,3}\.){3}\d{1,3}\b', '[endereço removido]'
  $safe = $safe -replace '(?i)\b(?:[a-f0-9]{0,4}:){2,}[a-f0-9:.%]*\b', '[endereço removido]'
  $safe = $safe -replace '(?i)\b(?:token|secret|password|authorization|account|identifier|id)\s*[:=]\s*[^\s,;]+', '[dado removido]'
  $safe = $safe -replace '(?i)\b[\da-f]{8}-[\da-f-]{27,}\b|\b[\da-f]{12,}\b', '[dado removido]'
  return $safe.Substring(0, [Math]::Min(300, $safe.Length))
}

function Get-TunnelBearNativeConnection {
  $folder = $null
  try { $folder = Split-Path -Parent (Get-TunnelBearInstallation).Path } catch {}
  try {
    $json = & 'C:\Program Files\nodejs\node.exe' (Join-Path $PSScriptRoot 'tunnelbear_native.cjs') $folder
    if ($LASTEXITCODE -eq 0) { return $json | ConvertFrom-Json }
  } catch {}
  return @{ Status = 'Unavailable'; Country = $null; At = $null }
}

function Get-TunnelBearSelectedCountry {
  # Read only; never restore, handle a dialog, select or click here.
  try {
    $window = Find-TunnelBearWindow
    if (-not $window) { return $null }
    $condition = New-Object System.Windows.Automation.PropertyCondition(
      [System.Windows.Automation.AutomationElement]::AutomationIdProperty, 'cbxCountry')
    $element = $window.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $condition)
    if (-not $element) { return $null }
    $selection = $element.GetCurrentPattern([System.Windows.Automation.SelectionPattern]::Pattern)
    $names = @($selection.Current.GetSelection() | ForEach-Object { $_.Current.Name.Trim().TrimEnd(',', ';', ' ') })
    if ($names.Count -eq 1) { if ($names[0] -eq 'Portugal') { return 'PT' }; return 'OTHER' }
  } catch {}
  return $null
}

function Get-VpnProof([int]$BudgetMs = 20000, [switch]$ForDisconnect) {
  $clock = [Diagnostics.Stopwatch]::StartNew()
  $adapter = Get-VpnAdapter
  $status = if ($adapter) { $adapter.OperationalStatus.ToString() } else { 'NotFound' }
  $native = Get-TunnelBearNativeConnection
  $proof = @{ Connected = $false; Disconnected = ($status -eq 'Down' -and $native.Status -eq 'Disconnected');
    Adapter = $status; Country = $null; NativeStatus = $native.Status; NativeAt = $native.At;
    Service = 'TunnelBear'; ElapsedMs = $clock.ElapsedMilliseconds; Attempts = @(); WindowMs = $BudgetMs }
  if ($ForDisconnect) {
    $proof.Error = if ($proof.Disconnected) { $null } else { "Desconexão não confirmada: adaptador=$status; TunnelBear=$($native.Status)" }
    return $proof
  }
  if ($status -ne 'Up') { $proof.Error = "Adaptador VPN não ligado: $status"; return $proof }
  if ($native.Status -notin @('Connected', 'Unavailable')) {
    $proof.Error = "TunnelBear não conectado: $($native.Status)"; return $proof
  }
  if ($script:VpnAttemptSince -and $native.At -and [DateTimeOffset]::Parse($native.At) -lt $script:VpnAttemptSince) {
    $proof.Error = 'TunnelBear sem confirmação da tentativa atual'; return $proof
  }
  $country = $native.Country; $source = 'TunnelBear registro'
  if (-not $country) { $country = Get-TunnelBearSelectedCountry; $source = 'TunnelBear janela (somente leitura)' }
  if ($country -and $native.Status -eq 'Connected') {
    $proof.Country = $country; $proof.Service = $source; $proof.Connected = $country -eq 'PT'
    $proof.Error = if ($proof.Connected) { $null } else { 'TunnelBear conectado em outro país; conexão preservada' }
    $proof.ElapsedMs = $clock.ElapsedMilliseconds
    return $proof
  }
  if ($country -and $country -ne 'PT') {
    $proof.Country = $country; $proof.Error = 'TunnelBear selecionado em outro país; conexão preservada'; return $proof
  }
  $errors = @(); $attempts = @(); $index = 0
  do {
    $service = @('ipwho.is', 'ipapi.co')[$index % 2]
    $uri = if ($service -eq 'ipwho.is') { 'https://ipwho.is/' } else { 'https://ipapi.co/json/' }
    $remaining = $BudgetMs - [int]$clock.ElapsedMilliseconds
    if ($remaining -le 0) { break }
    $at = $clock.ElapsedMilliseconds
    try {
      $ip = Invoke-PortugalProbe $uri ([Math]::Min(5000, $remaining))
      $okay = $ip.country_code -eq 'PT' -and ($service -ne 'ipwho.is' -or $ip.success -eq $true)
      $attempts += @{ service = $service; elapsedMs = $clock.ElapsedMilliseconds - $at; connected = $okay }
      if ($okay) {
        $finalAdapter = Get-VpnAdapter; $finalNative = Get-TunnelBearNativeConnection
        if (-not $finalAdapter -or $finalAdapter.OperationalStatus.ToString() -ne 'Up' -or $finalNative.Status -notin @('Connected', 'Unavailable')) {
          $proof.Error = 'Conexão interrompida durante a confirmação'; return $proof
        }
        $proof.Connected = $true; $proof.Country = 'PT'; $proof.Service = $service
        $proof.Error = ($errors -join '; '); $proof.Attempts = $attempts; $proof.ElapsedMs = $clock.ElapsedMilliseconds
        return $proof
      }
      $errors += "${service}: país português não confirmado"
    } catch {
      $errors += "${service}: $(Protect-VpnReason $_.Exception.Message)"
      $attempts += @{ service = $service; elapsedMs = $clock.ElapsedMilliseconds - $at; connected = $false }
    }
    $index++
    $remaining = $BudgetMs - [int]$clock.ElapsedMilliseconds
    if ($remaining -gt 0) { Start-Sleep -Milliseconds ([Math]::Min(100, $remaining)) }
  } while ($clock.ElapsedMilliseconds -lt $BudgetMs)
  $proof.Error = 'VPN_COUNTRY_UNPROVEN: país sem prova pelo TunnelBear ou serviços externos; ' + ($errors -join '; ')
  $proof.ElapsedMs = $clock.ElapsedMilliseconds; $proof.Attempts = $attempts; $proof.ProofWindowExhausted = $true
  return $proof
}
