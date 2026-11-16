param([Parameter(Mandatory=$true)][ValidatePattern('^2026-\d\d-\d\d$')][string]$Date,[switch]$Remove)
$ErrorActionPreference='Stop'
$root=$env:EDGE_DATA_ROOT
if(-not $root){throw 'EDGE_DATA_ROOT ausente'}
$name='EdgeFinder-NBA-Props-'+$Date
if($Remove){Unregister-ScheduledTask -TaskName $name -Confirm:$false -ErrorAction SilentlyContinue;exit}
$dir=Join-Path $root '.local_logs/nba-props-windows-20261116/tasks'
[void][IO.Directory]::CreateDirectory($dir)
$entry=Join-Path $dir ($Date+'.ps1')
$code='$env:EDGE_DATA_ROOT='''+$root.Replace("'","''")+'''; $env:EDGE_NBA_SAMPLE_DATE='''+$Date+'''; $runtime=Get-Content -Raw -LiteralPath (Join-Path $env:EDGE_DATA_ROOT ''.local_logs/nba-props-windows-20261116/runtime.json'') | ConvertFrom-Json; & ''C:\Program Files\nodejs\node.exe'' (Join-Path $runtime.release ''scripts/local_bookmakers/nba_props_sample.cjs'') launch; exit $LASTEXITCODE'
[IO.File]::WriteAllText($entry,$code,[Text.UTF8Encoding]::new($false))
$service=New-Object -ComObject Schedule.Service;$service.Connect();$folder=$service.GetFolder('\');$task=$service.NewTask(0)
$task.RegistrationInfo.Description='Amostra NBA props: execução única, critério prefixado; sem Codex.'
$task.Settings.Enabled=$true;$task.Settings.StartWhenAvailable=$true;$task.Settings.WakeToRun=$true
$task.Settings.DisallowStartIfOnBatteries=$false;$task.Settings.StopIfGoingOnBatteries=$false;$task.Settings.MultipleInstances=2;$task.Settings.ExecutionTimeLimit='PT20M'
$task.Principal.UserId=[Security.Principal.WindowsIdentity]::GetCurrent().Name;$task.Principal.LogonType=3;$task.Principal.RunLevel=0
$t=$task.Triggers.Create(1);$t.StartBoundary=$Date+'T16:10:00';$t.Enabled=$true
$a=$task.Actions.Create(0);$a.Path=Join-Path $env:WINDIR 'System32/wscript.exe';$a.Arguments='"'+(Join-Path $root 'scripts/local_bookmakers/run_hidden.vbs')+'" "'+$entry+'"';$a.WorkingDirectory=$root
[void]$folder.RegisterTaskDefinition($name,$task,6,$task.Principal.UserId,$null,3)
Write-Output ($name+' criado: '+$Date+' 16:10, disparo único')
