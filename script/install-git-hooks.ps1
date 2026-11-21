# Installs the local commit checks for this clone.
#
# The deny list that script/check-local-paths.ps1 reads is gitignored, so CI
# cannot run the check: the only place it can run is a hook on this machine.
# This writes four:
#
#   pre-commit        checks the staged change before git builds the commit
#   commit-msg        checks the message git is about to use
#   pre-merge-commit  the same staged check for a merge that commits by itself;
#                     git runs pre-commit only for `git commit`, so without this
#                     a conflict-free merge is checked for its message only
#   pre-push          checks the exact commits about to leave the machine, which
#                     is what catches a commit made with --no-verify
#
# Hooks live in .git/hooks and are not tracked. Worktrees share the hooks
# directory of the main repository, so one install covers every worktree of
# this clone, and a fresh clone has none until this script runs. The bootstrap
# fails open: when no PowerShell is found it prints a note and lets the commit
# through, which is why the pre-push audit matters.
#
# Re-running is safe: only a hook carrying this script's marker is replaced.
#
#   -Force    replace a hook this script did not write
#   -Remove   delete the four hooks and stop checking

param(
    [switch]$Force,
    [switch]$Remove
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$hooks = git -C $root rev-parse --git-path hooks
if (-not [System.IO.Path]::IsPathRooted($hooks)) {
    $hooks = Join-Path $root $hooks
}
$hooks = [System.IO.Path]::GetFullPath($hooks)

$marker = "losslesscut-local-gate"

$bootstrap = @'
#!/bin/sh
# losslesscut-local-gate: written by script/install-git-hooks.ps1, not by git.
# Remove this file, or run that script with -Remove, to stop the check.

root=$(git rev-parse --show-toplevel) || exit 0
cd "$root" || exit 0

if command -v powershell >/dev/null 2>&1; then
    PS=powershell
elif command -v pwsh >/dev/null 2>&1; then
    PS=pwsh
else
    echo "check-local-paths: no PowerShell found, the change was not checked" >&2
    exit 0
fi

run_check() {
    "$PS" -NoProfile -ExecutionPolicy Bypass -File script/check-local-paths.ps1 "$@"
}

%BODY%
'@

$stagedBody = "run_check`nexit `$?"
$messageBody = "run_check -Message`nexit `$?"
$pushedBody = @'
status=0
while read local_ref local_sha remote_ref remote_sha; do
    [ -z "$local_sha" ] && continue
    case "$local_sha" in
        *[!0]*) ;;
        *) continue ;;
    esac
    case "$remote_sha" in
        *[!0]*)
            run_check -Pushed -Range "$remote_sha..$local_sha" || status=1
            ;;
        *)
            run_check -Pushed || status=1
            ;;
    esac
done
exit $status
'@

$hookNames = @("pre-commit", "commit-msg", "pre-merge-commit", "pre-push")

function Get-HookText {
    param([string]$Name)

    $body = switch ($Name) {
        "commit-msg" { $messageBody }
        "pre-push" { $pushedBody }
        default { $stagedBody }
    }
    return $bootstrap.Replace("%BODY%", $body).Replace("`r`n", "`n")
}

if ($Remove) {
    foreach ($name in $hookNames) {
        $path = Join-Path $hooks $name
        if ((Test-Path -LiteralPath $path) -and
            ((Get-Content -LiteralPath $path -Raw) -match [regex]::Escape($marker))) {
            Remove-Item -LiteralPath $path -Force
            Write-Host "removed: $path"
        } else {
            Write-Host "kept: $path (not written by this script)"
        }
    }
    exit 0
}

if (-not (Test-Path -LiteralPath $hooks)) {
    New-Item -ItemType Directory -Path $hooks -Force | Out-Null
}

foreach ($name in $hookNames) {
    $path = Join-Path $hooks $name
    if (Test-Path -LiteralPath $path) {
        $existing = Get-Content -LiteralPath $path -Raw
        if (($existing -notmatch [regex]::Escape($marker)) -and (-not $Force)) {
            Write-Host "kept: $path (not written by this script; pass -Force to replace)"
            continue
        }
    }
    [System.IO.File]::WriteAllText($path, (Get-HookText -Name $name),
        (New-Object System.Text.UTF8Encoding($false)))
    Write-Host "wrote: $path"
}

# The deny list is gitignored and cannot live in the repository. Scaffold it
# from the tracked example on first install; never overwrite a filled-in list.
$denyDir = Join-Path $root "ai-tmp/local_text"
$denyFile = Join-Path $denyDir "deny-list.txt"
$example = Join-Path $root "script/local-gate-deny-list.example.txt"
if (-not (Test-Path -LiteralPath $denyFile) -and (Test-Path -LiteralPath $example)) {
    New-Item -ItemType Directory -Path $denyDir -Force | Out-Null
    Copy-Item -LiteralPath $example -Destination $denyFile
    Write-Host "created: $denyFile (add private terms there; it is gitignored)"
}

# The account name is the most likely word to survive a pasted path that lost
# its drive letter. Keep it in the local list, not in this script.
if ((Test-Path -LiteralPath $denyFile) -and $env:USERNAME -and $env:USERNAME.Length -ge 3) {
    $present = $false
    foreach ($line in (Get-Content -LiteralPath $denyFile -Encoding UTF8)) {
        if ($line.Trim() -eq $env:USERNAME) { $present = $true; break }
    }
    if (-not $present) {
        Add-Content -LiteralPath $denyFile -Value "" -Encoding UTF8
        Add-Content -LiteralPath $denyFile -Value "# Machine account (added automatically; remove if it is a common word)" -Encoding UTF8
        Add-Content -LiteralPath $denyFile -Value $env:USERNAME -Encoding UTF8
        Write-Host "updated: $denyFile (machine account added)"
    }
}
