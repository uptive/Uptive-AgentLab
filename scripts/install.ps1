# Installs or updates AgentLab on Windows from the latest GitHub release.
#
#   irm https://github.com/uptive/Uptive-AgentLab/releases/latest/download/install.ps1 | iex
#
# From Command Prompt: powershell -NoProfile -Command "irm https://github.com/uptive/Uptive-AgentLab/releases/latest/download/install.ps1 | iex"
#
# Uses the GitHub CLI when it is logged in (needed if the repository is private), otherwise Invoke-WebRequest.
# Set MONGODB_URI to skip the prompt for the connection string, and AGENTLAB_REPO to install from
# another repository.
$ErrorActionPreference = "Stop"

$Repo = if ($env:AGENTLAB_REPO) { $env:AGENTLAB_REPO } else { "uptive/Uptive-AgentLab" }
$Asset = "AgentLab-win-x64-setup.exe"
$Tmp = Join-Path ([IO.Path]::GetTempPath()) ("agentlab-" + [guid]::NewGuid())
New-Item -ItemType Directory -Path $Tmp | Out-Null

try {
  $Installer = Join-Path $Tmp $Asset
  Write-Host "Downloading the latest AgentLab from $Repo..."
  if (Get-Command gh -ErrorAction SilentlyContinue) {
    gh auth status --hostname github.com *> $null
    if ($LASTEXITCODE -eq 0) {
      gh release download --repo $Repo --pattern $Asset --dir $Tmp
      if ($LASTEXITCODE -ne 0) { throw "gh release download failed" }
    }
  }
  if (-not (Test-Path $Installer)) {
    try {
      Invoke-WebRequest -UseBasicParsing -Uri "https://github.com/$Repo/releases/latest/download/$Asset" -OutFile $Installer
    } catch {
      throw "Download failed. If the repository is private, install the GitHub CLI (winget install GitHub.cli), run gh auth login, and try again."
    }
  }

  Get-Process AgentLab -ErrorAction SilentlyContinue | Stop-Process -Force
  # One-click per-user installer: /S installs silently into %LOCALAPPDATA%\Programs\AgentLab.
  $Process = Start-Process -FilePath $Installer -ArgumentList "/S" -Wait -PassThru
  if ($Process.ExitCode -ne 0) { throw "The installer exited with code $($Process.ExitCode)" }

  # The MongoDB connection string is a credential, so it is never built into the app. It goes into
  # the app's own .env in this user's profile.
  $EnvDir = Join-Path $env:APPDATA "AgentLab"
  $EnvFile = Join-Path $EnvDir ".env"
  if (-not (Test-Path $EnvFile)) {
    $Uri = $env:MONGODB_URI
    if (-not $Uri) {
      $Secure = Read-Host "MongoDB connection string (input hidden, leave empty to skip)" -AsSecureString
      $Uri = [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($Secure))
    }
    if ($Uri) {
      New-Item -ItemType Directory -Force -Path $EnvDir | Out-Null
      Set-Content -Path $EnvFile -Value "MONGODB_URI=$Uri" -Encoding ascii
      Write-Host "Saved the connection string to $EnvFile"
    } else {
      Write-Host "No connection string saved. Shared agents and flows need one: add MONGODB_URI=... to $EnvFile"
    }
  }

  $Exe = Join-Path $env:LOCALAPPDATA "Programs\AgentLab\AgentLab.exe"
  Write-Host "Installed AgentLab"
  if (Test-Path $Exe) { Start-Process $Exe }
} finally {
  Remove-Item -Recurse -Force $Tmp -ErrorAction SilentlyContinue
}
