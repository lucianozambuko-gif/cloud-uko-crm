# Creates the "Cloud Uko CRM" shortcut on the Desktop and in the Start menu.
# Run again if you move the project folder:
#   powershell -ExecutionPolicy Bypass -File scripts\install-shortcut.ps1
#
# Add -StartWithWindows to also start the server in the background when you sign in to Windows
# (no window opens), so the phone can reach the CRM without you starting it first.
# Add -NoStartWithWindows to remove that again.
param([switch]$StartWithWindows, [switch]$NoStartWithWindows)

$root = Split-Path -Parent $PSScriptRoot
$launcher = Join-Path $PSScriptRoot 'launch.ps1'
$icon = Join-Path $root 'public\favicon.ico'
$powershell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$shell = New-Object -ComObject WScript.Shell

function New-CrmShortcut([string]$path, [string]$extraArgs, [string]$description) {
  $shortcut = $shell.CreateShortcut($path)
  $shortcut.TargetPath = $powershell
  $shortcut.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$launcher`"$extraArgs"
  $shortcut.WorkingDirectory = $root
  $shortcut.IconLocation = "$icon,0"
  $shortcut.WindowStyle = 7  # minimised, so no console window flashes up
  $shortcut.Description = $description
  $shortcut.Save()
  "Created $path"
}

foreach ($folder in [Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('Programs')) {
  New-CrmShortcut (Join-Path $folder 'Cloud Uko CRM.lnk') '' 'Open Cloud Uko CRM'
}

$startup = Join-Path ([Environment]::GetFolderPath('Startup')) 'Cloud Uko CRM (background).lnk'
if ($StartWithWindows) {
  New-CrmShortcut $startup ' -Background' 'Start the Cloud Uko CRM server in the background'
} elseif ($NoStartWithWindows -and (Test-Path $startup)) {
  Remove-Item -LiteralPath $startup -Force
  "Removed $startup"
}
