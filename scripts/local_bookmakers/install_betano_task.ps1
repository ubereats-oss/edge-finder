$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$reader = Join-Path $project 'scripts\local_bookmakers\run_betano_task.ps1'
$logDir = Join-Path $project '.local_logs\betano'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

$taskName = 'EdgeFinder-Betano-Local'
$service = New-Object -ComObject Schedule.Service
$service.Connect()
$folder = $service.GetFolder('\')
$task = $service.NewTask(0)
$task.RegistrationInfo.Description = 'Coleta local aos 50 minutos de cada hora, 24 horas por dia; orçamento TunnelBear controlado antes de conectar.'
$task.Settings.Enabled = $true
$task.Settings.StartWhenAvailable = $true
$task.Settings.WakeToRun = $true
$task.Settings.DisallowStartIfOnBatteries = $false
$task.Settings.StopIfGoingOnBatteries = $false
$task.Settings.MultipleInstances = 2
$task.Settings.ExecutionTimeLimit = 'PT20M'
$task.Principal.UserId = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$task.Principal.LogonType = 3
$task.Principal.RunLevel = 0
$scheduleNow = Get-Date
$nextRun = $scheduleNow.Date.AddHours($scheduleNow.Hour).AddMinutes(50)
if ($nextRun -le $scheduleNow) { $nextRun = $nextRun.AddHours(1) }
$trigger = $task.Triggers.Create(2)
$trigger.StartBoundary = $nextRun.ToString('s')
$trigger.DaysInterval = 1
$trigger.Repetition.Interval = 'PT1H'
$trigger.Repetition.Duration = 'P1D'
$trigger.Enabled = $true
$action = $task.Actions.Create(0)
$action.Path = Join-Path $env:WINDIR 'System32\wscript.exe'
$launcher = Join-Path $project 'scripts\local_bookmakers\run_hidden.vbs'
$action.Arguments = "`"$launcher`" `"$reader`""
$action.WorkingDirectory = $project
$folder.RegisterTaskDefinition($taskName, $task, 6, $task.Principal.UserId, $null, 3) | Out-Null
Write-Output "Tarefa $taskName registrada. Um agendamento diário com repetição a cada hora, sempre aos 50 minutos; wake-to-run: ativo."
