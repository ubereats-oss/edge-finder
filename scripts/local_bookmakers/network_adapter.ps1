param([int]$InterfaceIndex = 0)
$ErrorActionPreference = 'Stop'
function Select-PhysicalRoute($Routes, $Adapters) {
  foreach ($route in @($Routes | Sort-Object @{Expression={ $_.RouteMetric + $_.InterfaceMetric }})) {
    $candidate = $Adapters | Where-Object { $_.ifIndex -eq $route.InterfaceIndex -and $_.Status -eq 'Up' -and
      $_.InterfaceDescription -notmatch 'TunnelBear|TAP-Windows|Loopback' } | Select-Object -First 1
    if ($candidate) { return $candidate }
  }
  throw 'Interface física da rota ativa não encontrada.'
}
if ($env:EDGE_NETWORK_LIBRARY -eq '1') { return }
$adapters = @(Get-NetAdapter -Physical)
if ($InterfaceIndex) { $adapter = $adapters | Where-Object { $_.ifIndex -eq $InterfaceIndex } | Select-Object -First 1 }
else { $adapter = Select-PhysicalRoute @(Get-NetRoute -AddressFamily IPv4 -DestinationPrefix '0.0.0.0/0') $adapters }
if (-not $adapter) { throw 'Interface física escolhida não encontrada.' }
$stats = Get-NetAdapterStatistics -Name $adapter.Name
[pscustomobject]@{ interfaceIndex = $adapter.ifIndex; name = $adapter.Name;
  receivedBytes = [double]$stats.ReceivedBytes; sentBytes = [double]$stats.SentBytes } | ConvertTo-Json -Compress
