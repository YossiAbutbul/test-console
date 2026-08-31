<#
.SYNOPSIS
    One command to bring the whole test console up.

.DESCRIPTION
    Default (production) mode runs ONE process. The backend already serves the
    built SPA out of frontend/dist (see backend/main.py), so there is no second
    server to babysit and no proxy in the path -- API and UI both answer on
    :8000. The frontend is rebuilt only when something under frontend/ is newer
    than the last build.

    -Dev is the other shape: Vite on :5173 with HMR, proxying to uvicorn on
    :8000, which is what you want while editing the UI.

    In both modes uvicorn runs in the FOREGROUND of this window on purpose.
    Ctrl+C then reaches it directly and the lifespan hook gets to hand the BLE
    link, the VISA sessions and the COM ports back. A force-kill skips that and
    is the usual reason the next connect refuses.

.EXAMPLE
    .\scripts\launch.ps1
.EXAMPLE
    .\scripts\launch.ps1 -Dev
#>
[CmdletBinding()]
param(
    # Vite dev server + HMR on :5173 instead of the bundled build.
    [switch]$Dev,
    # Skip the staleness check and use frontend/dist as it stands.
    [switch]$NoBuild,
    # Do not open a browser window.
    [switch]$NoBrowser,
    [int]$Port = 8000
)

$ErrorActionPreference = 'Stop'

$Root     = Split-Path -Parent $PSScriptRoot
$Python   = Join-Path $Root '.venv\Scripts\python.exe'
$Frontend = Join-Path $Root 'frontend'
$Dist     = Join-Path $Frontend 'dist'

function Fail($msg) { Write-Host "`n  $msg`n" -ForegroundColor Red; exit 1 }
function Step($msg) { Write-Host "  $msg" -ForegroundColor Cyan }

# The venv interpreter is spelled out rather than inherited: a bare `python`
# picks up whichever is first on PATH, and the system install has neither the
# instrument wrappers nor uvicorn.
if (-not (Test-Path $Python)) {
    Fail "No virtualenv at .venv. Run scripts\setup-new-pc.ps1, or:`n    python -m venv .venv`n    .\.venv\Scripts\pip.exe install -r requirements.txt"
}

# npm.cmd by name, not `npm`: Start-Process cannot launch the bare shim, and
# resolving it here keeps that failure out of -Dev mode.
$npm = Get-Command npm.cmd -ErrorAction SilentlyContinue
if (-not $npm) { $npm = Get-Command npm -ErrorAction SilentlyContinue }
if (-not $npm) { Fail "npm is not on PATH. Install Node.js (see README)." }
$npm = $npm.Source

# ---------------------------------------------------------------- frontend --

if (-not (Test-Path (Join-Path $Frontend 'node_modules'))) {
    Step 'Installing frontend dependencies (first run only)...'
    & $npm install --prefix $Frontend
    if ($LASTEXITCODE -ne 0) { Fail 'npm install failed.' }
}

function Test-BuildStale {
    $index = Join-Path $Dist 'index.html'
    if (-not (Test-Path $index)) { return $true }
    $built = (Get-Item $index).LastWriteTimeUtc
    # package.json and vite.config change what gets built as surely as src does.
    $watch = @('src', 'index.html', 'package.json', 'vite.config.ts') |
             ForEach-Object { Join-Path $Frontend $_ } |
             Where-Object   { Test-Path $_ }
    foreach ($path in $watch) {
        $newest = Get-ChildItem $path -Recurse -File -ErrorAction SilentlyContinue |
                  Sort-Object LastWriteTimeUtc -Descending |
                  Select-Object -First 1
        if ($newest -and $newest.LastWriteTimeUtc -gt $built) { return $true }
    }
    return $false
}

if (-not $Dev -and -not $NoBuild) {
    if (Test-BuildStale) {
        Step 'Building the UI (only happens when frontend/ changed)...'
        Push-Location $Frontend
        try { & $npm run build } finally { Pop-Location }
        if ($LASTEXITCODE -ne 0) { Fail 'Frontend build failed -- see the errors above.' }
    } else {
        Step 'UI build is current.'
    }
}

if (-not $Dev -and -not (Test-Path (Join-Path $Dist 'index.html'))) {
    Fail "frontend\dist is empty and -NoBuild was given. Drop -NoBuild, or run: npm run build --prefix frontend"
}

# -------------------------------------------------------------------- urls --

$url = if ($Dev) { 'http://localhost:5173' } else { "http://localhost:$Port" }

# Probed over 127.0.0.1 rather than localhost. uvicorn binds IPv4 only, and
# Invoke-WebRequest tries the ::1 that localhost resolves to first, so every
# probe burns its full timeout -- measured at 2000 ms to fail against 73 ms to
# succeed -- and the browser opens minutes late or not at all. Browsers fall
# back off ::1 on their own, so the address bar keeps the friendly name.
$probe = if ($Dev) { 'http://127.0.0.1:5173' } else { "http://127.0.0.1:$Port" }

function Test-Listening($p) {
    [bool](Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue)
}

function Test-BackendHealthy($p) {
    try { return (Invoke-WebRequest "http://127.0.0.1:$p/health" -UseBasicParsing -TimeoutSec 3).StatusCode -eq 200 }
    catch { return $false }
}

function Open-App($target) {
    # explorer.exe is the fallback because Start-Process on a bare URL throws
    # outright on a machine with no default browser association, and the whole
    # point of this script is that a window appears.
    try { Start-Process $target; return $true }
    catch { try { & explorer.exe $target; return $true } catch { return $false } }
}

# ------------------------------------------------------------------- ports --

if ($Dev -and (Test-Listening 5173)) {
    # Vite would quietly take 5174 instead, and then the browser opens a port
    # nothing is serving. Better to stop than to open the wrong window.
    Fail 'Port :5173 is already taken -- a Vite dev server is probably still running. Stop it and try again.'
}

if (Test-Listening $Port) {
    # A backend from an earlier run is not a failure, it is the app already
    # being up -- refusing to start here is what makes a double-click look
    # like it did nothing. Attach to it instead, but only once /health proves
    # it is ours; anything else holding the port is a genuine clash.
    if (-not (Test-BackendHealthy $Port)) {
        Fail "Port :$Port is held by something that is not the backend. Free it and try again."
    }
    if ($Dev) {
        Fail "A backend is already running on :$Port. Stop it (Ctrl+C in its window) first -- dev mode needs to own it."
    }
    Write-Host ''
    Step "Backend is already running on :$Port -- opening the app against it."
    Write-Host ''
    if (-not $NoBrowser -and -not (Open-App $url)) {
        Write-Host "  Could not open a browser. Go to $url" -ForegroundColor Yellow
    }
    exit 0
}

# --------------------------------------------------------------- processes --

$vite   = $null
$opener = $null

try {
    if ($Dev) {
        Step 'Starting Vite (:5173)...'
        $vite = Start-Process -FilePath $npm -ArgumentList 'run', 'dev' `
                              -WorkingDirectory $Frontend -PassThru
    }

    if (-not $NoBrowser) {
        # Polled in a job so uvicorn can own the foreground: the browser opens
        # when /health actually answers, not on a fixed guess at startup time.
        $opener = Start-Job -ScriptBlock {
            param($probe, $url)
            for ($i = 0; $i -lt 120; $i++) {
                $up = $false
                try { $up = (Invoke-WebRequest "$probe/health" -UseBasicParsing -TimeoutSec 2).StatusCode -eq 200 }
                catch { }
                if ($up) {
                    # Deliberately outside the probe's catch. Folded in, a
                    # browser that fails to launch is indistinguishable from a
                    # server that is not up yet, so the loop retries in silence
                    # and no window ever appears with nothing said about why.
                    try { Start-Process $url }
                    catch { try { & explorer.exe $url } catch { } }
                    return
                }
                Start-Sleep -Milliseconds 500
            }
        } -ArgumentList $probe, $url
    }

    Write-Host ''
    Step "Test console -> $url    (Ctrl+C here to stop)"
    Write-Host ''

    Set-Location $Root
    & $Python -m uvicorn backend.main:app --timeout-graceful-shutdown 3 --port $Port
}
finally {
    if ($opener) { Stop-Job $opener -ErrorAction SilentlyContinue; Remove-Job $opener -Force -ErrorAction SilentlyContinue }
    if ($vite) {
        # /T because npm.cmd is a shim -- killing it alone orphans the node
        # process that actually holds :5173.
        Step 'Stopping Vite...'
        & taskkill.exe /PID $vite.Id /T /F 2>&1 | Out-Null
    }
}
