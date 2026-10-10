# Starts the CRM in the background (if it is not already running) and opens it in its own app window.
# Used by the "Cloud Uko CRM" desktop shortcut. Create the shortcut with scripts\install-shortcut.ps1.
# -Background starts the server without opening a window (used by the Windows start-up shortcut).
param([switch]$Background)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot

function Show-Error([string]$message) {
  Add-Type -AssemblyName System.Windows.Forms
  [System.Windows.Forms.MessageBox]::Show($message, 'Cloud Uko CRM', 'OK', 'Error') | Out-Null
}

function Test-Port([int]$port) {
  $client = New-Object System.Net.Sockets.TcpClient
  try { $client.Connect('127.0.0.1', $port); return $true } catch { return $false } finally { $client.Close() }
}

try {
  # Same port the server will use: PORT from .env if set, otherwise 3000.
  $port = 3000
  $envFile = Join-Path $root '.env'
  if (Test-Path $envFile) {
    $line = Get-Content $envFile | Where-Object { $_ -match '^\s*PORT\s*=\s*(\d+)\s*$' } | Select-Object -Last 1
    if ($line -match '(\d+)') { $port = [int]$Matches[1] }
  }

  if (-not (Test-Port $port)) {
    $node = (Get-Command node -ErrorAction SilentlyContinue).Source
    if (-not $node) { throw 'Node.js was not found. Install it from https://nodejs.org and try again.' }

    $data = Join-Path $root 'data'
    New-Item -ItemType Directory -Force $data | Out-Null
    $log = Join-Path $data 'crm.log'
    $errLog = Join-Path $data 'crm-error.log'
    Start-Process -FilePath $node -ArgumentList '--env-file-if-exists=.env', 'src/server.js' -WorkingDirectory $root `
      -WindowStyle Hidden -RedirectStandardOutput $log -RedirectStandardError $errLog

    $ready = $false
    foreach ($i in 1..40) {
      if (Test-Port $port) { $ready = $true; break }
      Start-Sleep -Milliseconds 500
    }
    if (-not $ready) {
      $detail = if (Test-Path $errLog) { (Get-Content $errLog -Tail 8) -join "`n" } else { '' }
      throw "The CRM did not start within 20 seconds.`n`n$detail`n`nLog files are in $data"
    }
  }

  if ($Background) { exit 0 }

  # APP_URL in .env (e.g. the Tailscale HTTPS address) is what the window opens, if it answers.
  # Otherwise, for example when Tailscale is switched off, fall back to the local address.
  $url = "http://localhost:$port"
  if (Test-Path $envFile) {
    $appLine = Get-Content $envFile | Where-Object { $_ -match '^\s*APP_URL\s*=\s*(https?://\S+)\s*$' } | Select-Object -Last 1
    if ($appLine -match '(https?://\S+)') {
      $appUrl = $Matches[1].TrimEnd('/')
      try {
        Invoke-WebRequest "$appUrl/favicon.ico" -UseBasicParsing -TimeoutSec 5 | Out-Null
        $url = $appUrl
      } catch { }
    }
  }
  $browser = @(
    "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
    "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe"
  ) | Where-Object { Test-Path $_ } | Select-Object -First 1

  if ($browser) {
    # --app opens a window without tabs or an address bar, so it behaves like a desktop app.
    Start-Process -FilePath $browser -ArgumentList "--app=$url"
  } else {
    Start-Process $url
  }
} catch {
  # At Windows start-up nobody asked for the CRM, so fail quietly into the log instead of a pop-up.
  if ($Background) {
    Add-Content -Path (Join-Path $root 'data\crm-error.log') -Value "[$(Get-Date -Format s)] start-up launch failed: $($_.Exception.Message)" -ErrorAction SilentlyContinue
  } else {
    Show-Error $_.Exception.Message
  }
  exit 1
}
