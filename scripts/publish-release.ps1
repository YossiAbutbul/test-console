<#
.SYNOPSIS
    Create (or update) the GitHub Release page for a pushed tag.

.DESCRIPTION
    A pushed tag is not a GitHub Release: the Releases panel only lists what
    was created through GitHub itself. This makes that page with the GitHub
    CLI, titled with the version and with that version's section of
    CHANGELOG.md as its notes, so the page and the changelog say the same
    thing. Run again for the same tag and it updates the notes rather than
    failing.

    -Bundle also builds the DUT-only desktop bundle (scripts/build-app.ps1
    -Zip) and attaches it as TestConsole-<version>.zip. That takes minutes.

    scripts/release.ps1 -Push calls this; run it alone for a tag that is
    already pushed.

    Needs the GitHub CLI signed in to the account that owns the repo
    (winget install GitHub.cli, then gh auth login).

.EXAMPLE
    .\scripts\publish-release.ps1 -Tag v1.0.0
.EXAMPLE
    .\scripts\publish-release.ps1 -Tag v1.1.0 -Bundle
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [ValidatePattern('^v\d+\.\d+\.\d+$')]
    [string]$Tag,
    # Build the DUT-only zip and attach it.
    [switch]$Bundle
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

function Fail($msg) { Write-Host "publish-release: $msg" -ForegroundColor Red; exit 1 }

# winget puts gh on PATH only for shells opened after the install.
$gh = (Get-Command gh -ErrorAction SilentlyContinue).Source
if (-not $gh) {
    $fallback = Join-Path $env:ProgramFiles 'GitHub CLI\gh.exe'
    if (Test-Path $fallback) { $gh = $fallback } else { Fail 'GitHub CLI not found; winget install GitHub.cli, then gh auth login.' }
}
& $gh auth status *> $null
if ($LASTEXITCODE) { Fail 'GitHub CLI is not signed in; run gh auth login.' }

# The tag has to be on GitHub already: a release made for a tag that is only
# local would have GitHub create a new tag at the default branch's tip.
git ls-remote --exit-code --tags origin "refs/tags/$Tag" *> $null
if ($LASTEXITCODE) { Fail "$Tag is not on origin; push it first (git push origin $Tag)." }

$version = $Tag.Substring(1)

# This version's changelog section: from its heading to the next one, or to
# the link references at the bottom.
$cl = Get-Content (Join-Path $Root 'CHANGELOG.md') -Raw
$m = [regex]::Match($cl, "(?ms)^## \[$([regex]::Escape($version))\][^\r\n]*\r?\n(.*?)(?=^## \[|^\[[^\]]+\]: |\z)")
if (-not $m.Success -or -not $m.Groups[1].Value.Trim()) { Fail "no notes for $version in CHANGELOG.md." }
$notesFile = New-TemporaryFile
[IO.File]::WriteAllText($notesFile, $m.Groups[1].Value.Trim() + "`n", [Text.UTF8Encoding]::new($false))

$assets = @()
if ($Bundle) {
    & (Join-Path $PSScriptRoot 'build-app.ps1') -Zip
    $zip = Join-Path $Root 'dist\TestConsole.zip'
    if (-not (Test-Path $zip)) { Fail 'the bundle build did not produce dist\TestConsole.zip.' }
    $named = Join-Path $Root "dist\TestConsole-$version.zip"
    Copy-Item $zip $named -Force
    $assets += $named
}

try {
    & $gh release view $Tag *> $null
    if ($LASTEXITCODE -eq 0) {
        & $gh release edit $Tag --title $version --notes-file $notesFile
        if ($LASTEXITCODE) { Fail "could not update the $Tag release." }
        if ($assets) {
            & $gh release upload $Tag @assets --clobber
            if ($LASTEXITCODE) { Fail 'could not attach the bundle.' }
        }
        Write-Host "publish-release: updated the $Tag release." -ForegroundColor Green
    } else {
        & $gh release create $Tag @assets --title $version --notes-file $notesFile --verify-tag
        if ($LASTEXITCODE) { Fail "could not create the $Tag release." }
        Write-Host "publish-release: created the $Tag release." -ForegroundColor Green
    }
} finally {
    Remove-Item $notesFile -ErrorAction SilentlyContinue
}
