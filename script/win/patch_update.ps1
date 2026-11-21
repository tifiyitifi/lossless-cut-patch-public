<#
.SYNOPSIS
  LosslessCut-Patch portable updater: replaces the program files with a downloaded ZIP.

.DESCRIPTION
  Windows cannot replace a running executable, so the app never touches its own files. It downloads
  and verifies the package, copies this script next to the package, records the hand-off and quits;
  this script waits for the app to disappear and then swaps the program folder.

  The swap is a directory rename, not a file-by-file copy: the new build is unpacked next to the
  running folder, the two folders exchange names, and the old one is deleted. A rename either
  happens or does not, which is what makes a rollback possible at all.

  User data is preserved by moving it from the old folder into the new one *before* the swap:
  `llc` (patch project store) and `config.json` (portable configuration). Everything else in the
  installation folder belongs to the build.

  Every failure ends the same way: the transcript says what happened and the app is started again,
  because a user left at a desktop with no app and no explanation is the worst outcome here.

.PARAMETER PackagePath
  The verified ZIP. Supplied by the app.

.PARAMETER InstallDir
  The folder that holds the running executable. Supplied by the app.

.PARAMETER LogPath
  The transcript. Lives outside the folder being replaced.

.PARAMETER ExeName
  The executable the package must contain and the word used to find the running process.

.PARAMETER NonInteractive
  Runs without asking anything. The app uses this because nobody is at the keyboard once it quit.

.PARAMETER NoLaunch
  Does not start the app afterwards. Used by the smoke test of this script.
#>
param(
    [Parameter(Mandatory = $true)][string]$PackagePath,
    [Parameter(Mandatory = $true)][string]$InstallDir,
    [Parameter(Mandatory = $true)][string]$LogPath,
    [string]$ExeName = 'LosslessCut-Patch.exe',
    [switch]$NonInteractive,
    [switch]$NoLaunch
)

$ErrorActionPreference = 'Stop'

$script:HasConsole = $false
try {
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
    $script:HasConsole = $true
} catch {
    $script:HasConsole = $false
}

function Write-Log {
    param([Parameter(Position = 0)][string]$Text)
    try {
        Add-Content -LiteralPath $LogPath -Value ('[{0}] {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Text) -Encoding UTF8
    } catch { }
    if ($script:HasConsole) {
        try { Write-Host $Text } catch { }
    }
}

function Start-App {
    if ($NoLaunch) { return }
    $exe = Join-Path $InstallDir $ExeName
    if (-not (Test-Path -LiteralPath $exe)) { return }
    try {
        Write-Log "Starting $ExeName ..."
        Start-Process -FilePath $exe -WorkingDirectory $InstallDir
    } catch {
        Write-Log "Could not start the app again: $_"
    }
}

function Exit-WithFailure {
    param([Parameter(Position = 0)][string]$Message)
    Write-Log "FAILED: $Message"
    if ($script:SwapStarted -and -not $script:SwapCompleted) {
        # Put the old folder back rather than leaving the user with neither build.
        Write-Log 'Rolling back to the previous build ...'
        if ((Test-Path -LiteralPath $script:OldDir) -and -not (Test-Path -LiteralPath $InstallDir)) {
            try { Move-Item -LiteralPath $script:OldDir -Destination $InstallDir } catch { Write-Log "Rollback failed: $_" }
        }
    }
    if (-not $NonInteractive -and $script:HasConsole) { [void](Read-Host 'Press Enter to close') }
    Start-App
    exit 1
}

$script:SwapStarted = $false
$script:SwapCompleted = $false
$script:OldDir = $null
$script:NewDir = $null

# The safety net: with $ErrorActionPreference = Stop, any unexpected failure would otherwise end the
# script mid-flight, leave the extracted folder behind and never restart the app.
trap {
    Write-Log "Unexpected error: $_"
    Write-Log ($_.ScriptStackTrace | Out-String)
    if ($script:NewDir -and (Test-Path -LiteralPath $script:NewDir)) {
        Remove-Item -LiteralPath $script:NewDir -Recurse -Force -ErrorAction SilentlyContinue
    }
    Exit-WithFailure 'unexpected error'
}

Add-Type -AssemblyName System.IO.Compression.FileSystem

Write-Log '========================================'
Write-Log ' LosslessCut-Patch portable update'
Write-Log '========================================'
Write-Log "Package:    $PackagePath"
Write-Log "InstallDir: $InstallDir"

if (-not (Test-Path -LiteralPath $InstallDir)) { Exit-WithFailure "The installation folder does not exist: $InstallDir" }
if (-not (Test-Path -LiteralPath $PackagePath)) { Exit-WithFailure "The package does not exist: $PackagePath" }

$installFull = [System.IO.Path]::GetFullPath($InstallDir).TrimEnd('\')
$parentDir = Split-Path -Parent $installFull
$folderName = Split-Path -Leaf $installFull
if ([string]::IsNullOrWhiteSpace($folderName)) { Exit-WithFailure 'Refusing to replace a drive root.' }

# The package must be a ZIP that contains the executable. The app already verified the digest; this
# is the structure check, so a renamed HTML error page can never be unpacked over the build.
function Test-PackageContent {
    $archive = $null
    try {
        $archive = [System.IO.Compression.ZipFile]::OpenRead($PackagePath)
        foreach ($entry in $archive.Entries) {
            if ($entry.FullName -match ('(^|[\\/])' + [regex]::Escape($ExeName) + '$')) { return $true }
        }
        return $false
    } catch {
        Write-Log "The package cannot be read as a ZIP: $_"
        return $false
    } finally {
        if ($null -ne $archive) { $archive.Dispose() }
    }
}

if (-not (Test-PackageContent)) { Exit-WithFailure "The package does not contain $ExeName." }

# The app quits right after starting this script, so a short wait is expected. The bound keeps a
# second instance the user opened in the meantime from blocking the update forever.
Write-Log 'Waiting for the app to exit ...'
$watch = [Diagnostics.Stopwatch]::StartNew()
while ($true) {
    $running = @(Get-Process -Name ([System.IO.Path]::GetFileNameWithoutExtension($ExeName)) -ErrorAction SilentlyContinue |
        Where-Object { try { $_.Path -and $_.Path.StartsWith($installFull, [StringComparison]::OrdinalIgnoreCase) } catch { $false } })
    if ($running.Count -eq 0) { break }
    if ($watch.ElapsedMilliseconds -gt 60000) { Exit-WithFailure 'Timed out waiting for the app to close.' }
    Start-Sleep -Milliseconds 250
}

$timestamp = Get-Date -Format 'yyyyMMdd_HHmmss'
$script:NewDir = Join-Path $parentDir ('{0}.update-{1}_{2}' -f $folderName, $timestamp, $PID)
$script:OldDir = Join-Path $parentDir ('{0}.old-{1}_{2}' -f $folderName, $timestamp, $PID)

Write-Log "Unpacking into $script:NewDir ..."
try {
    New-Item -ItemType Directory -Path $script:NewDir -Force | Out-Null

    # Zip-slip guard: Windows PowerShell (.NET Framework) performs no entry-path validation, so a
    # crafted package could write outside the destination (`..\..\` entries or rooted names).
    $newFull = [System.IO.Path]::GetFullPath($script:NewDir).TrimEnd('\') + '\'
    $archive = [System.IO.Compression.ZipFile]::OpenRead($PackagePath)
    try {
        foreach ($entry in $archive.Entries) {
            $destination = [System.IO.Path]::GetFullPath((Join-Path $script:NewDir $entry.FullName))
            if (-not $destination.StartsWith($newFull, [System.StringComparison]::OrdinalIgnoreCase)) {
                throw "The package contains an entry outside its root: $($entry.FullName)"
            }
        }
    } finally {
        $archive.Dispose()
    }

    [System.IO.Compression.ZipFile]::ExtractToDirectory($PackagePath, $script:NewDir)
} catch {
    Exit-WithFailure "Unpacking failed: $_"
}

# The archive's root is the app folder itself. A package with one wrapper folder is accepted too,
# because that is what a hand-made ZIP looks like.
$sourceDir = $script:NewDir
if (-not (Test-Path -LiteralPath (Join-Path $sourceDir $ExeName))) {
    $candidate = Get-ChildItem -LiteralPath $script:NewDir -Directory | Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName $ExeName) } | Select-Object -First 1
    if ($null -eq $candidate) { Exit-WithFailure "The unpacked package does not contain $ExeName." }
    $sourceDir = $candidate.FullName
}

# Everything the user owns moves into the new folder first, so the swap itself is just two renames.
foreach ($preserved in @('llc', 'config.json')) {
    $from = Join-Path $installFull $preserved
    if (-not (Test-Path -LiteralPath $from)) { continue }
    $to = Join-Path $sourceDir $preserved
    Write-Log "Preserving $preserved ..."
    try {
        if (Test-Path -LiteralPath $to) { Remove-Item -LiteralPath $to -Recurse -Force }
        Move-Item -LiteralPath $from -Destination $to
    } catch {
        Exit-WithFailure "Could not preserve $preserved : $_"
    }
}

Write-Log 'Replacing the program folder ...'
$script:SwapStarted = $true
try {
    Move-Item -LiteralPath $installFull -Destination $script:OldDir
} catch {
    $script:SwapStarted = $false
    Exit-WithFailure "Could not rename the installation folder (is the app still running?): $_"
}

try {
    Move-Item -LiteralPath $sourceDir -Destination $installFull
} catch {
    Exit-WithFailure "Could not move the new build into place: $_"
}
$script:SwapCompleted = $true

Write-Log 'Update applied.'
Start-App

# The old folder is deleted after the new build is in place and running; a locked file only leaves
# it for the next launch to clean up.
try {
    Remove-Item -LiteralPath $script:OldDir -Recurse -Force -ErrorAction Stop
    Write-Log 'Removed the previous build.'
} catch {
    Write-Log "The previous build is still on disk and can be deleted by hand: $script:OldDir"
}

Write-Log 'Done.'
exit 0
