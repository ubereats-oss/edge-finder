param([string]$ReleaseRoot,[string]$Worker,[string]$Date)
$ErrorActionPreference='Stop';$env:EDGE_COLLECTION_DESKTOP='EdgeFinderCollection'
Add-Type -Path (Join-Path $ReleaseRoot 'scripts/local_bookmakers/background_desktop.cs')
$inputDesktop=[EdgeBackgroundDesktop]::IsInputDesktop('EdgeFinderCollection')
if($inputDesktop){throw 'Desktop oculto virou desktop de entrada'}
$desktop=[EdgeBackgroundDesktop]::CreateDesktop('EdgeFinderCollection',[IntPtr]::Zero,[IntPtr]::Zero,0,0x10000000,[IntPtr]::Zero)
if($desktop -eq [IntPtr]::Zero){throw 'Falha ao criar desktop oculto'}
try{exit [EdgeBackgroundDesktop]::Run('C:\Program Files\nodejs\node.exe',@($Worker,'worker',$Date),'EdgeFinderCollection',$ReleaseRoot,(Join-Path $env:EDGE_DATA_ROOT '.local_logs/nba-props-windows-20261116/worker.pid'))}finally{[void][EdgeBackgroundDesktop]::CloseDesktop($desktop)}
