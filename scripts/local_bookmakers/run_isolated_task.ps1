param([Parameter(Mandatory=$true)][string]$DataRoot, [Parameter(Mandatory=$true)][string]$RuntimeRoot, [switch]$PrepareOnly)
$ErrorActionPreference = 'Stop'
$arguments = @((Join-Path $PSScriptRoot 'runtime_manager.cjs'), '--data-root', $DataRoot, '--runtime-root', $RuntimeRoot)
if ($PrepareOnly) { $arguments += '--prepare-only' }
& 'C:\Program Files\nodejs\node.exe' @arguments
exit $LASTEXITCODE
