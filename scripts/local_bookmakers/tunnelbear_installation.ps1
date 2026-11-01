function Select-TunnelBearInstallation($Candidates) {
  return @($Candidates | Where-Object { $_.Path -and $_.Version } |
    Sort-Object @{ Expression = { [Version]$_.Version }; Descending = $true },
      @{ Expression = { $_.Path } }) | Select-Object -First 1
}

function Get-TunnelBearInstallation {
  $folders = @([Environment]::GetFolderPath([System.Environment+SpecialFolder]::ProgramFiles),
    [Environment]::GetFolderPath([System.Environment+SpecialFolder]::ProgramFilesX86))
  $locations = @($folders | Where-Object { $_ } | ForEach-Object { Join-Path $_ 'TunnelBear' })
  foreach ($key in @('HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*',
    'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*')) {
    $locations += @(Get-ItemProperty $key -ErrorAction SilentlyContinue |
      Where-Object { $_.DisplayName -eq 'TunnelBear' -and $_.InstallLocation } |
      ForEach-Object { $_.InstallLocation })
  }
  $candidates = @($locations | Select-Object -Unique | ForEach-Object {
    $file = Join-Path $_ 'TunnelBear.exe'
    if (Test-Path -LiteralPath $file -PathType Leaf) {
      $info = Get-Item -LiteralPath $file
      $versionText = $info.VersionInfo.FileVersion
      $parsed = $null
      if ([Version]::TryParse($versionText, [ref]$parsed)) {
        [pscustomobject]@{ Path = $info.FullName; Version = $parsed.ToString() }
      }
    }
  })
  $selected = Select-TunnelBearInstallation $candidates
  if (-not $selected) { throw 'TUNNELBEAR_EXECUTABLE_NOT_FOUND: executável instalado do TunnelBear não encontrado.' }
  return $selected
}
