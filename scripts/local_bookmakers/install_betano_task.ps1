$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$node = (Get-Command node.exe).Source
$reader = Join-Path $project 'pipeline\local_betano_reader.js'
$logDir = Join-Path $project '.local_logs\betano'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

$taskName = 'EdgeFinder-Betano-Local'
$service = New-Object -ComObject Schedule.Service
$service.Connect()
$folder = $service.GetFolder('\')
$task = $service.NewTask(0)
$task.RegistrationInfo.Description = 'Coleta Betano JSON com TunnelBear; leitura a cada 12 horas.'
$task.Settings.Enabled = $true
$task.Settings.StartWhenAvailable = $true
$task.Settings.WakeToRun = $true
$task.Settings.MultipleInstances = 2
$task.Settings.ExecutionTimeLimit = 'PT20M'
$task.Principal.UserId = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$task.Principal.LogonType = 3
$task.Principal.RunLevel = 0
$trigger = $task.Triggers.Create(2)
$trigger.StartBoundary = (Get-Date -Hour 0 -Minute 0 -Second 0).ToString('s')
$trigger.DaysInterval = 1
$trigger.Repetition.Interval = 'PT12H'
$trigger.Repetition.Duration = 'PT23H59M'
$trigger.Enabled = $true
$action = $task.Actions.Create(0)
$action.Path = $node
$action.Arguments = "`"$reader`""
$action.WorkingDirectory = $project
$folder.RegisterTaskDefinition($taskName, $task, 6, $task.Principal.UserId, $null, 3) | Out-Null
Write-Output "Tarefa $taskName registrada. Próximas execuções: 00:00 e 12:00; wake-to-run: ativo."
