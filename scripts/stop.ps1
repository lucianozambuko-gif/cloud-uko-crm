# Stops the CRM server, whether it was started from the desktop shortcut or start-crm.bat.
# The server writes its process id to data\crm.pid when it starts, so this never touches other Node apps.
$root = Split-Path -Parent $PSScriptRoot
$dataDir = if ($env:DATA_DIR) { $env:DATA_DIR } else { Join-Path $root 'data' }
$pidFile = Join-Path $dataDir 'crm.pid'

if (-not (Test-Path $pidFile)) { "Cloud Uko CRM is not running."; exit 0 }

$serverPid = [int](Get-Content $pidFile -TotalCount 1)
$proc = Get-CimInstance Win32_Process -Filter "ProcessId=$serverPid"

# The id could have been reused by another program since a crash, so check it is still our server.
if ($proc -and $proc.Name -eq 'node.exe' -and $proc.CommandLine -match 'server\.js') {
  Stop-Process -Id $serverPid -Force
  "Cloud Uko CRM stopped."
} else {
  "Cloud Uko CRM is not running."
}
Remove-Item -LiteralPath $pidFile -Force
