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
$task.RegistrationInfo.Description = 'Coleta Betano JSON e Retabet HTML pré-jogo com TunnelBear; leituras a cada 2h das 11h às 23h (Brasília).'
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
foreach ($hour in @(11, 13, 15, 17, 19, 21, 23)) {
  $trigger = $task.Triggers.Create(2)
  $trigger.StartBoundary = (Get-Date -Hour $hour -Minute 0 -Second 0).ToString('s')
  $trigger.DaysInterval = 1
  $trigger.Enabled = $true
}
$action = $task.Actions.Create(0)
$action.Path = 'powershell.exe'
$action.Arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$reader`""
$action.WorkingDirectory = $project
$folder.RegisterTaskDefinition($taskName, $task, 6, $task.Principal.UserId, $null, 3) | Out-Null
Write-Output "Tarefa $taskName registrada. Leituras a cada 2h das 11:00 às 23:00 (Brasília); wake-to-run: ativo."
