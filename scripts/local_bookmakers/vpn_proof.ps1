function Invoke-PortugalProbe([string]$Uri, [int]$TimeoutMs) {
  Add-Type -AssemblyName System.Net.Http
  $client = New-Object System.Net.Http.HttpClient
  $cancel = New-Object System.Threading.CancellationTokenSource
  try {
    $task = $client.GetAsync($Uri, [System.Net.Http.HttpCompletionOption]::ResponseContentRead, $cancel.Token)
    if (-not $task.Wait($TimeoutMs)) {
      $cancel.Cancel()
      throw 'tempo limite atingido'
    }
    $response = $task.GetAwaiter().GetResult()
    if (-not $response.IsSuccessStatusCode) { throw "HTTP $([int]$response.StatusCode)" }
    return $response.Content.ReadAsStringAsync().GetAwaiter().GetResult() | ConvertFrom-Json
  } finally { $cancel.Cancel(); $cancel.Dispose(); $client.Dispose() }
}

function Get-VpnProof([int]$BudgetMs = 20000) {
  $clock = [Diagnostics.Stopwatch]::StartNew()
  $adapter = Get-VpnAdapter
  if (-not $adapter) { return @{ Connected = $false; Adapter = 'NotFound'; Country = $null;
    Error = 'Adaptador TunnelBear Adapter V9 não encontrado.'; ElapsedMs = $clock.ElapsedMilliseconds } }
  if ($adapter.OperationalStatus -ne [System.Net.NetworkInformation.OperationalStatus]::Up) {
    return @{ Connected = $false; Adapter = $adapter.OperationalStatus.ToString(); Country = $null;
      ElapsedMs = $clock.ElapsedMilliseconds }
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
      if ($okay) { return @{ Connected = $true; Adapter = 'Up'; Country = 'PT'; PublicIp = $ip.ip;
        Service = $service; Error = ($errors -join '; '); ElapsedMs = $clock.ElapsedMilliseconds;
        Attempts = $attempts; WindowMs = $BudgetMs } }
      $errors += "${service}: país português não confirmado"
    } catch {
      $errors += "${service}: $($_.Exception.Message)"
      $attempts += @{ service = $service; elapsedMs = $clock.ElapsedMilliseconds - $at; connected = $false }
    }
    $index++
    $remaining = $BudgetMs - [int]$clock.ElapsedMilliseconds
    if ($remaining -gt 0) { Start-Sleep -Milliseconds ([Math]::Min(100, $remaining)) }
  } while ($clock.ElapsedMilliseconds -lt $BudgetMs)
  return @{ Connected = $false; Adapter = 'Up'; Country = $null; Error = ($errors -join '; ');
    ElapsedMs = $clock.ElapsedMilliseconds; Attempts = $attempts; WindowMs = $BudgetMs; ProofWindowExhausted = $true }
}
