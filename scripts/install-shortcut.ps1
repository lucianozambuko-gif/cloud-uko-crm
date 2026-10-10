# Creates the "Cloud Uko CRM" shortcut on the Desktop and in the Start menu.
# Run again if you move the project folder:
#   powershell -ExecutionPolicy Bypass -File scripts\install-shortcut.ps1
$root = Split-Path -Parent $PSScriptRoot
$launcher = Join-Path $PSScriptRoot 'launch.ps1'
$icon = Join-Path $root 'public\favicon.ico'
$powershell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'

$shell = New-Object -ComObject WScript.Shell
$folders = [Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('Programs')
foreach ($folder in $folders) {
  $path = Join-Path $folder 'Cloud Uko CRM.lnk'
  $shortcut = $shell.CreateShortcut($path)
  $shortcut.TargetPath = $powershell
  $shortcut.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$launcher`""
  $shortcut.WorkingDirectory = $root
  $shortcut.IconLocation = "$icon,0"
  $shortcut.WindowStyle = 7  # minimised, so no console window flashes up
  $shortcut.Description = 'Open Cloud Uko CRM'
  $shortcut.Save()
  "Created $path"
}
