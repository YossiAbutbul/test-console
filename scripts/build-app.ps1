<#
.SYNOPSIS
    Build the DUT-only desktop bundle: a folder anyone can unzip and run.

.DESCRIPTION
    Produces dist\TestConsole\, holding TestConsole.exe, a private Python
    interpreter, the pip packages and the built UI. Nothing needs installing on
    the machine it is copied to -- no Python, no Node, no venv. The DUT is BLE,
    which bleak drives through the OS Bluetooth stack, so there is no driver to
    install either.

    The build happens in .venv-build, made fresh from requirements-desktop.txt,
    NOT in the rig's .venv. That is the whole mechanism behind "DUT-only": the
    instrument packages are absent from the interpreter PyInstaller analyses,
    so they cannot be bundled, and backend/capabilities.py then reports no
    instrument support because that is a true statement about the bundle rather
    than a flag someone set. Building from .venv would produce a bundle that
    claims the rig pages work and then fails at connect time.

    The bundle carries no rig pages' worth of hardware, but it does carry the
    pages: they show greyed out with a reason, so the app looks the same
    everywhere.

.EXAMPLE
    .\scripts\build-app.ps1
.EXAMPLE
    .\scripts\build-app.ps1 -Zip
#>
[CmdletBinding()]
param(
    # Reuse .venv-build as it stands instead of reinstalling into it.
    [switch]$NoVenv,
    # Use frontend\dist as it stands instead of rebuilding the UI.
    [switch]$NoFrontend,
    # Also produce dist\TestConsole.zip, which is the shippable artefact.
    [switch]$Zip
)

$ErrorActionPreference = 'Stop'

$Root       = Split-Path -Parent $PSScriptRoot
$Frontend   = Join-Path $Root 'frontend'
$BuildVenv  = Join-Path $Root '.venv-build'
$BuildPy    = Join-Path $BuildVenv 'Scripts\python.exe'
$Spec       = Join-Path $Root 'TestConsole.spec'
$OutDir     = Join-Path $Root 'dist\TestConsole'

function Fail($msg) { Write-Host "`n  $msg`n" -ForegroundColor Red; exit 1 }
function Step($msg) { Write-Host "`n  $msg" -ForegroundColor Cyan }

Push-Location $Root
try {
    # --- 1. the UI ------------------------------------------------------
    # Built first and unconditionally (unless waived): the spec refuses to run
    # without frontend\dist, and a stale dist is the one failure that yields a
    # bundle which starts perfectly and serves last week's UI.
    if (-not $NoFrontend) {
        Step 'Building the UI...'
        Push-Location $Frontend
        try {
            npm run build
            if ($LASTEXITCODE -ne 0) { Fail 'npm run build failed.' }
        } finally { Pop-Location }
    }
    if (-not (Test-Path (Join-Path $Frontend 'dist\index.html'))) {
        Fail 'frontend\dist\index.html is missing. Drop -NoFrontend.'
    }

    # --- 2. the build venv ----------------------------------------------
    if (-not $NoVenv) {
        Step 'Preparing the build venv...'
        # Removed rather than updated. pip will not uninstall what a previous
        # build installed and a later edit removed, and a package left behind
        # here is a package silently shipped in the bundle.
        if (Test-Path $BuildVenv) { Remove-Item -Recurse -Force $BuildVenv }
        # Spelled out, like everywhere else in this repo: a bare `python` picks
        # up whichever is first on PATH.
        & (Join-Path $Root '.venv\Scripts\python.exe') -m venv $BuildVenv
        if ($LASTEXITCODE -ne 0) { Fail 'Could not create .venv-build.' }
        & $BuildPy -m pip install --quiet --upgrade pip
        & $BuildPy -m pip install --quiet -r (Join-Path $Root 'requirements-desktop.txt')
        if ($LASTEXITCODE -ne 0) { Fail 'Installing the desktop requirements failed.' }
    }
    if (-not (Test-Path $BuildPy)) { Fail 'No .venv-build. Drop -NoVenv.' }

    # A build venv that can import pyvisa is a build venv someone has installed
    # the rig requirements into, and the bundle would inherit that. Cheaper to
    # catch here than to discover from a bundle that offers the rig pages on a
    # PC with no rig.
    & $BuildPy -c "import importlib.util,sys; sys.exit(1 if importlib.util.find_spec('pyvisa') else 0)"
    if ($LASTEXITCODE -ne 0) {
        Fail "The build venv has pyvisa in it. Rebuild it without -NoVenv."
    }

    # --- 3. freeze -------------------------------------------------------
    Step 'Freezing...'
    # --clean discards the cached analysis. Without it a changed exclude or
    # hidden import is quietly ignored and the bundle is built from the old
    # graph, which is a genuinely baffling half hour.
    & $BuildPy -m PyInstaller --noconfirm --clean $Spec
    if ($LASTEXITCODE -ne 0) { Fail 'PyInstaller failed.' }
    if (-not (Test-Path (Join-Path $OutDir 'TestConsole.exe'))) {
        Fail 'PyInstaller reported success but produced no exe.'
    }

    # --- 4. ship ---------------------------------------------------------
    # Copied next to the exe rather than declared as a `datas` entry in the
    # spec: PyInstaller puts datas under _internal\, and the one file that has
    # to be found without being looked for is the one telling the recipient
    # what to double-click.
    Step 'Adding README.txt...'
    Copy-Item (Join-Path $Root 'packaging\README.txt') (Join-Path $OutDir 'README.txt') -Force

    if ($Zip) {
        Step 'Zipping...'
        $zipPath = Join-Path $Root 'dist\TestConsole.zip'
        if (Test-Path $zipPath) { Remove-Item -Force $zipPath }
        Compress-Archive -Path $OutDir -DestinationPath $zipPath
        Write-Host "`n  $zipPath" -ForegroundColor Green
    }

    $size = (Get-ChildItem $OutDir -Recurse -File | Measure-Object Length -Sum).Sum / 1MB
    Write-Host ("`n  Built $OutDir ({0:N0} MB)." -f $size) -ForegroundColor Green
    Write-Host "  Copy the folder anywhere and run TestConsole.exe.`n"
} finally {
    Pop-Location
}
