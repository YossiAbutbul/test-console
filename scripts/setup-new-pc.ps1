<#
.SYNOPSIS
  One-shot setup + diagnosis for a fresh test-console PC.

.DESCRIPTION
  Written after a new machine failed every `pip install` with
  "[Errno 9] Bad file descriptor" and saw no VISA instruments. It:

    1. dumps an environment report (paths, disk, AV, VISA runtime, USB devices)
    2. clones the repo to a plain local path (folder redirection is the prime
       EBADF suspect, so the default destination avoids Documents entirely)
    3. installs deps with `uv`, which never runs pip's install code path
    4. verifies pyvisa loads a real VISA runtime and can see the instruments

  Everything is transcribed to a log next to the destination folder.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\setup-new-pc.ps1
#>
[CmdletBinding()]
param(
    [string]$Dest = 'C:\dev\test-console',
    [string]$RepoUrl = 'https://github.com/YossiAbutbul/test-console.git'
)

$ErrorActionPreference = 'Continue'

$root = Split-Path $Dest -Parent
if (-not (Test-Path $root)) { New-Item -ItemType Directory -Path $root -Force | Out-Null }
$log = Join-Path $root 'setup-log.txt'
Start-Transcript -Path $log -Force | Out-Null

function Section($title) { Write-Host "`n=== $title ===" }

# ---------------------------------------------------------------- diagnostics
Section 'Machine'
Write-Host "Host: $env:COMPUTERNAME   User: $env:USERNAME"
[System.Environment]::OSVersion.VersionString

Section 'Python'
foreach ($p in @('python', 'py')) {
    $cmd = Get-Command $p -ErrorAction SilentlyContinue
    if ($cmd) { Write-Host "$p -> $($cmd.Source)"; & $cmd.Source -V }
}

Section 'Documents redirection (EBADF suspect)'
# A Documents folder that is a reparse point (OneDrive KFM, or a network share
# pushed by policy) drops file handles mid-install, which surfaces as EBADF.
$docs = Join-Path $env:USERPROFILE 'Documents'
Get-Item $docs -Force | Select-Object FullName, LinkType, Target | Format-List
fsutil reparsepoint query $docs 2>&1 | Select-Object -First 3
Write-Host "Shell Personal path: $([Environment]::GetFolderPath('MyDocuments'))"

Section 'Disk'
Get-PSDrive C | Select-Object @{n = 'UsedGB'; e = { [math]::Round($_.Used / 1GB, 1) } },
@{n = 'FreeGB'; e = { [math]::Round($_.Free / 1GB, 1) } } | Format-Table
Get-WinEvent -FilterHashtable @{LogName = 'System'; Id = 7, 11, 51, 153 } -MaxEvents 10 -ErrorAction SilentlyContinue |
Select-Object TimeCreated, Id | Format-Table

Section 'Antivirus / Controlled Folder Access'
Get-CimInstance -Namespace root/SecurityCenter2 -ClassName AntiVirusProduct -ErrorAction SilentlyContinue |
Select-Object displayName | Format-Table
Get-MpPreference -ErrorAction SilentlyContinue |
Select-Object EnableControlledFolderAccess | Format-Table

Section 'VISA runtime'
# visa32.dll is only the IVI shim; the vendor lib behind it is what binds USB.
# ktvisa32/agvisa32 = Keysight IO Libraries (required for the N6705B USBTMC).
Get-Item C:\Windows\System32\visa32.dll, C:\Windows\System32\ktvisa32.dll,
C:\Windows\System32\agvisa32.dll, C:\Windows\System32\nivisa64.dll -ErrorAction SilentlyContinue |
Select-Object Name, @{n = 'Version'; e = { $_.VersionInfo.ProductVersion } } | Format-Table

Section 'USB instruments (VID_0957 = Keysight/Agilent)'
Get-PnpDevice -PresentOnly -ErrorAction SilentlyContinue |
Where-Object InstanceId -like 'USB\VID_0957*' |
Select-Object Status, Class, FriendlyName, InstanceId | Format-Table -Wrap

# ------------------------------------------------------------------ get repo
Section 'Repo'
if (Test-Path (Join-Path $Dest '.git')) {
    Write-Host "$Dest exists; pulling"
    git -C $Dest pull --ff-only
}
else {
    git clone $RepoUrl $Dest
}
if (-not (Test-Path (Join-Path $Dest 'requirements.txt'))) {
    Write-Host 'ERROR: clone failed or requirements.txt missing; stopping.'
    Stop-Transcript | Out-Null
    exit 1
}

# ---------------------------------------------------------------------- uv
Section 'uv'
$uv = Get-Command uv -ErrorAction SilentlyContinue
if (-not $uv) {
    Invoke-RestMethod https://astral.sh/uv/install.ps1 | Invoke-Expression
    $env:Path = "$env:USERPROFILE\.local\bin;$env:Path"
    $uv = Get-Command uv -ErrorAction SilentlyContinue
}
if (-not $uv) {
    Write-Host 'ERROR: uv not on PATH after install; open a new shell and re-run.'
    Stop-Transcript | Out-Null
    exit 1
}
uv --version

Section 'Install deps'
Push-Location $Dest
uv venv --python 3.12 .venv
uv pip install --python .venv\Scripts\python.exe -r requirements.txt
Pop-Location

# ------------------------------------------------------------------- verify
Section 'Verify'
$py = Join-Path $Dest '.venv\Scripts\python.exe'
& $py -c @"
import pyvisa
rm = pyvisa.ResourceManager()
print('backend:', rm.visalib)
print('resources:', rm.list_resources())
import dc_power_analyzer, power_sensor, network_analyzer
print('wrappers: ok')
"@

Write-Host "`nLog written to $log"
Stop-Transcript | Out-Null
