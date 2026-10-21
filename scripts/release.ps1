<#
.SYNOPSIS
    Cut a release: bump the version, date the changelog, commit and tag.

.DESCRIPTION
    VERSION at the repo root is the release version. This script writes the new
    one there and into the two places that repeat it -- backend/main.py
    (APP_VERSION, shown at /docs) and frontend/package.json (plus its lock
    file's own entry) -- so they cannot drift; backend/tests/test_version.py
    fails if they ever do.

    CHANGELOG.md's "## [Unreleased]" section becomes "## [x.y.z] - <date>",
    and a fresh empty Unreleased heading goes above it. Write the notes there
    as work lands; the script refuses to release with nothing under it, since
    a release that cannot say what changed is not one.

    Then it commits "release: vX.Y.Z" and makes an annotated tag vX.Y.Z.
    Nothing leaves the machine unless -Push is given.

    Run the checks first (see CLAUDE.md); this script does not.

.EXAMPLE
    .\scripts\release.ps1 -Bump patch
.EXAMPLE
    .\scripts\release.ps1 -Bump minor -Push
.EXAMPLE
    .\scripts\release.ps1 -Version 2.0.0
#>
[CmdletBinding(DefaultParameterSetName = 'Bump')]
param(
    # Which part of the current version to raise.
    [Parameter(ParameterSetName = 'Bump', Mandatory)]
    [ValidateSet('major', 'minor', 'patch')]
    [string]$Bump,
    # Or the exact version to release.
    [Parameter(ParameterSetName = 'Exact', Mandatory)]
    [ValidatePattern('^\d+\.\d+\.\d+$')]
    [string]$Version,
    # Also push the commit to main and the tag to origin.
    [switch]$Push
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

function Fail($msg) { Write-Host "release: $msg" -ForegroundColor Red; exit 1 }
# UTF-8 without a BOM in Windows PowerShell 5.1 as well as 7: 5.1's
# Set-Content -Encoding utf8 writes one, and a BOM at the top of package.json
# breaks the JSON readers that do not strip it.
function Write-Text($path, $text) { [IO.File]::WriteAllText($path, $text, [Text.UTF8Encoding]::new($false)) }

# A release is exactly what is committed: refuse to fold stray edits into it.
if (git status --porcelain) { Fail 'the working tree has uncommitted changes; commit or set them aside first.' }

$current = (Get-Content (Join-Path $Root 'VERSION') -Raw).Trim()
if ($current -notmatch '^(\d+)\.(\d+)\.(\d+)$') { Fail "VERSION holds '$current', not x.y.z." }
$maj = [int]$Matches[1]; $min = [int]$Matches[2]; $pat = [int]$Matches[3]

if ($PSCmdlet.ParameterSetName -eq 'Exact') {
    $next = $Version
} else {
    switch ($Bump) {
        'major' { $next = "$($maj + 1).0.0" }
        'minor' { $next = "$maj.$($min + 1).0" }
        'patch' { $next = "$maj.$min.$($pat + 1)" }
    }
}
$tag = "v$next"
if (git tag --list $tag) { Fail "tag $tag already exists." }

# --- changelog ---------------------------------------------------------------
$clPath = Join-Path $Root 'CHANGELOG.md'
$cl = Get-Content $clPath -Raw
$m = [regex]::Match($cl, '(?ms)^## \[Unreleased\]\s*\r?\n(.*?)(?=^## \[)')
if (-not $m.Success) { Fail 'CHANGELOG.md has no "## [Unreleased]" section followed by a release.' }
if (-not $m.Groups[1].Value.Trim()) { Fail 'nothing under "## [Unreleased]" in CHANGELOG.md; write the release notes first.' }

$date = Get-Date -Format 'yyyy-MM-dd'
# [ \t]*, not \s*: \s would eat the blank line after the heading, leaving
# the new version's notes butted against its title.
$cl = ([regex]'(?m)^## \[Unreleased\][ \t]*\r?$').Replace($cl, "## [Unreleased]`n`n## [$next] - $date", 1)
# Link references at the bottom: Unreleased compares from the new tag, and the
# new version gets its own line.
$cl = [regex]::Replace($cl, '(?m)^\[Unreleased\]: (.*)/compare/v[\d.]+\.\.\.HEAD\s*$',
    "[Unreleased]: `$1/compare/$tag...HEAD`n[$next]: `$1/releases/tag/$tag")
Write-Text $clPath $cl

# --- version strings ---------------------------------------------------------
Write-Text (Join-Path $Root 'VERSION') "$next`n"

$mainPy = Join-Path $Root 'backend\main.py'
$py = Get-Content $mainPy -Raw
if ($py -notmatch '(?m)^APP_VERSION = "[\d.]+"') { Fail 'APP_VERSION not found in backend/main.py.' }
$py = [regex]::Replace($py, '(?m)^APP_VERSION = "[\d.]+"', "APP_VERSION = `"$next`"", 1)
Write-Text $mainPy $py

# package.json and its lock: only the package's own version, never a
# dependency's -- the first "version" key in package.json, and the first two
# in the lock (the root object and its "" package entry).
$pkg = Join-Path $Root 'frontend\package.json'
$t = Get-Content $pkg -Raw
$t = ([regex]'"version": "[^"]*"').Replace($t, "`"version`": `"$next`"", 1)
Write-Text $pkg $t
$lock = Join-Path $Root 'frontend\package-lock.json'
$t = Get-Content $lock -Raw
$t = ([regex]'"version": "[^"]*"').Replace($t, "`"version`": `"$next`"", 2)
Write-Text $lock $t

# --- commit and tag ----------------------------------------------------------
git add VERSION CHANGELOG.md backend/main.py frontend/package.json frontend/package-lock.json
git commit -q -m "release: $tag"
if ($LASTEXITCODE) { Fail 'commit failed.' }
git tag -a $tag -m "Test Console $next"
Write-Host "release: $current -> $next, committed and tagged $tag." -ForegroundColor Green

if ($Push) {
    git push origin HEAD:main
    if ($LASTEXITCODE) { Fail 'push to main failed; the tag was not pushed.' }
    git push origin $tag
    if ($LASTEXITCODE) { Fail "push of $tag failed." }
    Write-Host "release: pushed main and $tag." -ForegroundColor Green
} else {
    Write-Host "release: not pushed. When ready: git push origin HEAD:main; git push origin $tag"
}
