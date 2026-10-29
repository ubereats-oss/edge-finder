param([Parameter(Mandatory=$true)][string]$ReleaseRoot)
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
$desktopName='EdgeFinderCollection'
$env:EDGE_COLLECTION_DESKTOP=$desktopName
Add-Type -Path (Join-Path $PSScriptRoot 'background_desktop.cs')
if([EdgeBackgroundDesktop]::IsInputDesktop($desktopName)){throw 'Desktop da coleta está sendo usado manualmente; ciclo não executado.'}
$desktop=[EdgeBackgroundDesktop]::CreateDesktop($desktopName,[IntPtr]::Zero,[IntPtr]::Zero,0,0x10000000,[IntPtr]::Zero)
if($desktop -eq [IntPtr]::Zero){throw 'Não foi possível criar o desktop oculto da coleta.'}
try {
  $pidFile=Join-Path $env:EDGE_DATA_ROOT '.local_logs/betano/background-worker.pid'
  $arguments=@('-NoProfile','-ExecutionPolicy','Bypass','-File',(Join-Path $PSScriptRoot 'background_worker.ps1'),'-ReleaseRoot',$ReleaseRoot)
  $code=[EdgeBackgroundDesktop]::Run((Join-Path $env:WINDIR 'System32/WindowsPowerShell/v1.0/powershell.exe'),$arguments,$desktopName,$ReleaseRoot,$pidFile)
  exit $code
} finally { [void][EdgeBackgroundDesktop]::CloseDesktop($desktop) }
