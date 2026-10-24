function Write-LocalSafeLog([string]$Path, [string]$Text) {
  $deadline = [DateTime]::UtcNow.AddSeconds(3)
  do {
    try { [IO.File]::AppendAllText($Path, $Text + [Environment]::NewLine, [Text.UTF8Encoding]::new($false)); return }
    catch [IO.IOException] { if ([DateTime]::UtcNow -ge $deadline) { break }; Start-Sleep -Milliseconds 150 }
    catch [UnauthorizedAccessException] { if ([DateTime]::UtcNow -ge $deadline) { break }; Start-Sleep -Milliseconds 150 }
  } while ($true)
  $alternate = $Path + '.alternate-' + [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfff') + '-' + $PID
  [IO.File]::WriteAllText($alternate, "Arquivo original bloqueado: $Path" + [Environment]::NewLine + $Text, [Text.UTF8Encoding]::new($false))
}
