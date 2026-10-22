param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('minimize', 'restore', 'state')]
  [string]$Action
)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class EdgeWindowNative {
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr handle, int command);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr handle);
}
'@
$processInfo = Get-CimInstance Win32_Process -Filter "Name = 'msedge.exe'" |
  Where-Object { $_.CommandLine -match 'remote-debugging-port=9331' -and $_.CommandLine -notmatch '--type=' } |
  Select-Object -First 1
if (-not $processInfo) { throw 'Edge persistente da coleta não encontrado.' }
$process = Get-Process -Id $processInfo.ProcessId -ErrorAction Stop
$handle = $process.MainWindowHandle
if ($handle -eq [IntPtr]::Zero) { throw 'Janela principal do Edge persistente não encontrada.' }
if ($Action -eq 'minimize') { $null = [EdgeWindowNative]::ShowWindowAsync($handle, 2) }
if ($Action -eq 'restore') { $null = [EdgeWindowNative]::ShowWindowAsync($handle, 9) }
Start-Sleep -Milliseconds 350
[pscustomobject]@{ action = $Action; pid = $process.Id; minimized = [EdgeWindowNative]::IsIconic($handle) } |
  ConvertTo-Json -Compress
