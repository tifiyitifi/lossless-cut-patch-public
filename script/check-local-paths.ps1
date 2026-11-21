# Checks that local, private material is not about to be committed.
#
# The repository is shared and may be published; the machine it is built on is
# not. Three shapes must never reach a tracked file or a commit message:
#
#   1. a local path        a drive letter with a separator, a UNC share, a home
#                          directory or a leading `~/`
#   2. local data          a project file (`.llc`), or anything under `ai-tmp/`
#   3. a private term      a real person, video title, download-site or batch
#                          name; the list is ai-tmp/local_text/deny-list.txt
#
# Modes:
#
#   (default)   check what is staged, file names included. If nothing is
#               staged, check the working diff of tracked files. A staged binary
#               file is named in a warning: its bytes are never read, only its
#               name is checked.
#   -All        audit every tracked file. A drive letter that is already
#               committed is a warning, not a failure, so the mode stays
#               usable as an audit.
#   -Pushed     check the commits that are about to leave the machine. The
#               pre-push hook passes the exact `<remote sha>..<local sha>`
#               range git reported, so only what this push publishes is read;
#               without a range the branch upstream (or the last commit) is
#               used. Unlike -All, a path here is a failure: it belongs to
#               this push.
#   -Message    check the message git just wrote. It is found with
#               `git rev-parse --git-path COMMIT_EDITMSG`, because a linked
#               worktree keeps it under the main repository's .git, not beside
#               the sources.
#
# A path inside `tests/` fails like any other: a tracked test is expected to use
# the stand-in roots listed below, and a real path there is still local
# material.
#
# The stand-in roots are a deliberate trade-off: the repository already uses
# `C:\work\...`, `C:\videos\...`, `C:\a\...` and a few others in its tests and
# docs, so those roots are accepted. A real name below one of them is not
# detectable here; the deny list and the manual rule in AGENTS.md cover it.
#
# The script is deliberately plain ASCII: Windows PowerShell 5.1 reads a .ps1
# without a byte-order mark in the system code page, so a pattern written with a
# literal non-ASCII character silently becomes a different pattern there, and the
# check then passes on everything. Samples are assembled at run time for the
# same reason, and the self-test below fails loudly if a pattern ever stops
# matching what it is supposed to.
#
# Exit code 1 means something it must not. Exit code 2 means the check itself is
# broken (a pattern or a filter no longer answers its sample).

param(
    [switch]$All,
    [switch]$Pushed,
    [switch]$Message,
    [string]$Range = "",
    [string]$Root = ""
)

$ErrorActionPreference = "Stop"

# Git writes paths and diff text as UTF-8; 5.1 reads native output with the
# console encoding, so name the encoding instead of hoping for the default.
try {
    [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
} catch {
    # No console attached; git output is then decoded with the default.
}

# -Root exists for the test suite, which runs the script against a throwaway
# repository. The hooks never pass it.
if (-not $Root) {
    $Root = Split-Path -Parent $PSScriptRoot
}
$root = [System.IO.Path]::GetFullPath($Root)
$denyList = Join-Path $root "ai-tmp/local_text/deny-list.txt"

# A drive letter followed by a separator, a UNC share, a home directory or a
# leading `~/`. A bare `C:` in prose is not matched.
#
# The roots in $publicRoot name a tool, a documented stand-in or an existing
# fixture root. Anything else after a drive letter is local.
$publicRoot = '(Program Files|Windows|work|inbox|batch|clips|videos|a|my\.clips|path)'
# The rest of the stand-in roots are a path spelled inside a test string, not a
# place on a disk: `C:/tmp/a.png`. The form is pinned to a forward slash, which
# is how a fixture is written, so the same words written with backslashes - the
# way a real scratch folder is spelled - are still local.
$fixtureRoot = '(tmp|temp|out|another)'
# Existing *.test.ts fixtures use a wider set of roots. They are accepted only
# inside a test file or a tracked fixture, so a new path in source, docs or a
# commit message still fails. `Users` is handled separately and is never a
# fixture root.
# The single-letter roots are the ones the tests actually use, listed explicitly so a path under an
# arbitrary letter is still treated as local.
$testRoot = '(\.{1,3}|\.losslesscut_work|2026-10|Apps|FFOUT|To-Re-Encode|clips|config|current|elsewhere|empty|evil\.zip|finished_merged|global|install|llc|log|merged|missing|old|older|OLDER|other|out|recent|src|updates|work[0-9A-Za-z]*|r[0-9]+|a|b|c|r|u|v|w|x)'
$pathPattern = ('\b[A-Za-z]:[\\/][^\s"''`)>]+' +
    '|\\\\[A-Za-z0-9._$-]{2,}[\\/][^\s"''`)>]*' +
    '|(^|[\s"''(])~[\\/][^\s"''`)>]*' +
    '|/Users/[A-Za-z0-9._-]+' +
    '|/home/[A-Za-z0-9._-]+')

# Files whose very presence in a commit is the leak.
$dataPattern = '(^ai-tmp/|\.llc$)'

# Text files worth reading in audit mode. The vendored Yarn release is skipped
# separately; translations are read too, because a pasted path can land there.
$textFilePattern = '\.(md|txt|json|ps1|psm1|cmd|bat|sh|ts|tsx|js|mjs|cjs|yml|yaml|py|html|css|xml|toml|csv)$'

$deny = @()
$denyMissing = -not (Test-Path -LiteralPath $denyList)
if (-not $denyMissing) {
    $deny = Get-Content -Path $denyList -Encoding UTF8 |
        ForEach-Object { $_.Trim() } |
        Where-Object { $_ -ne "" -and -not $_.StartsWith("#") }
}

# The machine's own profile and this checkout are local even when their root
# happens to be on the stand-in list. A generic placeholder account (the names
# the tests use) is skipped so the fixtures keep working.
$machinePrefixes = New-Object System.Collections.Generic.List[string]
foreach ($candidate in @($env:USERPROFILE, $env:HOME)) {
    if (-not $candidate) { continue }
    $full = [System.IO.Path]::GetFullPath($candidate).TrimEnd([char[]]'\/')
    $name = Split-Path -Leaf $full
    if ($name -in @('%USERNAME%', 'u', 'user', 'me', 'someone')) { continue }
    if ($full.Length -ge 4 -and -not $machinePrefixes.Contains($full)) { $machinePrefixes.Add($full) }
}
$rootFull = [System.IO.Path]::GetFullPath($root).TrimEnd([char[]]'\/')
# A checkout that lives under a documented stand-in root (e.g. C:\work) must
# not treat its own fixtures as the machine path.
if ($rootFull -notmatch '^[A-Za-z]:[\\/](work|inbox|batch|clips|videos|a|my\.clips|path)([\\/]|$)') {
    if ($rootFull.Length -ge 4) { $machinePrefixes.Add($rootFull) }
}

# A test file or a tracked fixture may use the wider stand-in roots.
function Test-FileName {
    param([string]$Name)
    return ($Name -match '\.test\.tsx?$') -or ($Name -match '(^|/)test/fixtures/')
}

# A drive path under a public root names a tool or a documented stand-in. The
# match keeps the whole path, so the root can be compared as a word.
function Find-LocalPath {
    param([string]$Text, [switch]$InTest)

    foreach ($match in [regex]::Matches($Text, $pathPattern)) {
        $value = $match.Value.Trim([char[]]' "''(,.;:')
        # A drive path written with escaped separators (`C:\\work`) is the same
        # stand-in; compare the collapsed form.
        $normalized = $value
        if ($normalized -match '^[A-Za-z]:') {
            $normalized = $normalized -replace '([\\/])\1+', '$1'
        }
        # A JSON escape (`B:\n[file1]`) is not a path.
        if ($normalized -match '^[A-Za-z]:[\\/](n|r|t)(?=[\[\]{}",])') { continue }
        # An interpolated test path (`C:/${name}`) names no machine.
        if ($normalized -match '^[A-Za-z]:[\\/]\$\{') { continue }
        # A bare drive root is a fixture, not a file path.
        if ($InTest -and $normalized -match '^[A-Za-z]:[\\/]?$') { continue }
        # A test fixture for UNC handling is allowed; a real share is not.
        if ($InTest -and $normalized -match '^[\\/]{2,}server[\\/]+share([\\/]|$)') { continue }
        # A user profile is never a stand-in, even in a test. Only the generic
        # placeholders and the upstream maintainer's public handle pass.
        if ($normalized -match '^[A-Za-z]:[\\/]Users([\\/]|$)') {
            if ($normalized -match '^[A-Za-z]:[\\/]Users[\\/](%USERNAME%|USERNAME|me|u|user|sindresorhus)([\\/]|$)') {
                continue
            }
            return $value
        }
        if ($InTest -and $normalized -match ('^[A-Za-z]:[\\/](' + $testRoot + ')([\\/]|$|[^\w])')) {
            continue
        }
        if ($normalized -match ('^[A-Za-z]:[\\/](' + $publicRoot + ')([\\/]|$|[^\w])')) {
            continue
        }
        if ($normalized -match ('^[A-Za-z]:/(' + $fixtureRoot + ')(/|$|[^\w])')) {
            continue
        }
        # Documented Unix paths and the public maintainer's examples.
        if ($normalized -match '^/Users/(mifi|sindresorhus|u|user)(/|$)') { continue }
        if ($normalized -match '^/home/(u|user)(/|$)') { continue }
        if ($normalized -match '^~/(\.appstoreconnect|\.config/LosslessCut|\.yarn|Library/(Application Support/LosslessCut|Containers/no\.mifi\.losslesscut(-mac)?))(/|$)') {
            continue
        }
        # "Program Files" has a space, so the path pattern stops before it.
        if ($Text.Substring($match.Index) -match '^[A-Za-z]:[\\/]Program Files([\\/]|$|[^\w])') {
            continue
        }
        if ($value) { return $value }
    }
    return $null
}

# Returns @{ Kind = 'path' | 'private'; Message = '...' } or $null.
function Find-Problem {
    param([string]$Where, [string]$Text, [switch]$InTest)

    foreach ($prefix in $machinePrefixes) {
        if ($Text.IndexOf($prefix, [StringComparison]::OrdinalIgnoreCase) -ge 0) {
            return @{ Kind = 'path'; Message = "local machine path at ${Where}: $prefix" }
        }
    }
    $path = Find-LocalPath -Text $Text -InTest:$InTest
    if ($path -ne $null) {
        return @{ Kind = 'path'; Message = "local path at ${Where}: $path" }
    }
    foreach ($term in $deny) {
        if ($Text.IndexOf($term, [StringComparison]::OrdinalIgnoreCase) -ge 0) {
            return @{ Kind = 'private'; Message = "private term at ${Where}: $term" }
        }
    }
    return $null
}

# A file whose name is the leak never reaches Find-Problem: only its content
# does. Returns a message or $null.
function Find-NameProblem {
    param([string]$Name)

    if ($Name -match $dataPattern) { return "local data in a file name: $Name" }
    if ($Name -match $pathPattern) { return "local path in a file name: $Name" }
    foreach ($term in $deny) {
        if ($Name.IndexOf($term, [StringComparison]::OrdinalIgnoreCase) -ge 0) {
            return "private term in a file name: $Name"
        }
    }
    return $null
}

# Samples are assembled here so that this file contains none of the shapes it
# refuses. Each entry says what the path pattern must answer.
$BS = [string][char]92
$FS = [string][char]47
$C = [string][char]67
$D = [string][char]68
$E = [string][char]69
$selfTests = @(
    @{ what = 'a drive letter with a backslash'; text = ($C + ':' + $BS + 'work' + $BS + 'a.mp4'); path = $true },
    @{ what = 'a drive letter with a slash'; text = ($C + ':' + $FS + 'work' + $FS + 'a.mp4'); path = $true },
    @{ what = 'a UNC share'; text = ($BS + $BS + 'server' + $BS + 'share' + $BS + 'a.mp4'); path = $true },
    @{ what = 'a home directory'; text = ($FS + 'home' + $FS + 'someone' + $FS + 'a.mp4'); path = $true },
    @{ what = 'a Mac home directory'; text = ($FS + 'Users' + $FS + 'someone' + $FS + 'a.mp4'); path = $true },
    @{ what = 'a tilde path'; text = ('~' + $FS + 'Videos' + $FS + 'a.mp4'); path = $true },
    @{ what = 'a URL'; text = ('https' + ':' + $FS + $FS + 'example.com' + $FS + 'a'); path = $false },
    @{ what = 'a drive letter in prose'; text = ('the ' + $C + ': drive'); path = $false },
    @{ what = 'a relative path'; text = ('docs' + $FS + 'features' + $FS + 'a.md'); path = $false },
    @{ what = 'a drive path with spaces'; text = ($C + ':' + $BS + 'Users' + $BS + 'someone' + $BS + 'My Videos' + $BS + 'a.mp4'); path = $true }
)

foreach ($case in $selfTests) {
    $hitPath = [bool]($case.text -match $pathPattern)
    if ($hitPath -ne $case.path) {
        Write-Host ("FAIL: self-test, {0}: path={1}" -f $case.what, $hitPath)
        Write-Host "FAIL: the check itself is broken; fix the pattern before trusting a green run"
        exit 2
    }
}

# The public roots are a filter, not a pattern, so they get their own samples.
$filterTests = @(
    @{ what = 'a documented tool root'; text = ($C + ':' + $FS + 'Program Files' + $FS + 'Qt' + $FS + 'bin'); local = $false },
    @{ what = 'a Visual Studio root'; text = ($C + ':' + $BS + 'Program Files' + $BS + 'Microsoft Visual Studio'); local = $false },
    @{ what = 'a Windows root'; text = ($C + ':' + $BS + 'Windows' + $BS + 'System32'); local = $false },
    @{ what = 'a stand-in work root'; text = ($C + ':' + $BS + 'work' + $BS + 'a.mp4'); local = $false },
    @{ what = 'a stand-in inbox root'; text = ($D + ':' + $FS + 'inbox'); local = $false },
    @{ what = 'a stand-in batch root'; text = ($E + ':' + $BS + 'work' + $BS + 'batch' + $BS + 'x.mp4'); local = $false },
    @{ what = 'a stand-in videos root'; text = ($C + ':' + $BS + 'videos' + $BS + 'a.mp4'); local = $false },
    @{ what = 'a stand-in letter root'; text = ($C + ':' + $BS + 'a' + $BS + 'README.md'); local = $false },
    @{ what = 'a stand-in clips root'; text = ($C + ':' + $BS + 'my.clips' + $BS + 'README'); local = $false },
    @{ what = 'a documented path root'; text = ($C + ':' + $FS + 'path' + $FS + 'to' + $FS + 'input.mp4'); local = $false },
    @{ what = 'a user placeholder'; text = ($C + ':' + $BS + 'Users' + $BS + '%USERNAME%' + $BS + 'AppData'); local = $false },
    @{ what = 'a fixture root spelled with a slash'; text = ($C + ':' + $FS + 'tmp' + $FS + 'a.png'); local = $false },
    @{ what = 'a fixture root on another drive'; text = ($D + ':' + $FS + 'out' + $FS + 'a.png'); local = $false },
    @{ what = 'a real user account'; text = ($C + ':' + $BS + 'Users' + $BS + 'someone' + $BS + 'Videos' + $BS + 'a.mp4'); local = $true },
    @{ what = 'a real user account in a test'; text = ($C + ':' + $BS + 'Users' + $BS + 'someone' + $BS + 'Videos' + $BS + 'a.mp4'); local = $true; inTest = $true },
    @{ what = 'a public placeholder account'; text = ($C + ':' + $BS + 'Users' + $BS + 'u' + $BS + 'Videos' + $BS + 'a.mp4'); local = $false; inTest = $true },
    @{ what = 'a test fixture root in a test'; text = ($C + ':' + $BS + 'src' + $BS + 'a.mp4'); local = $false; inTest = $true },
    @{ what = 'a test fixture root outside a test'; text = ($C + ':' + $BS + 'src' + $BS + 'a.mp4'); local = $true },
    @{ what = 'a documented Unix home'; text = ($FS + 'Users' + $FS + 'mifi' + $FS + 'Desktop'); local = $false },
    @{ what = 'a real Unix home'; text = ($FS + 'Users' + $FS + 'someone' + $FS + 'Desktop'); local = $true },
    @{ what = 'a documented tilde path'; text = ('~' + $FS + '.appstoreconnect' + $FS + 'keys'); local = $false },
    @{ what = 'a real downloads folder'; text = ('~' + $FS + 'Downloads' + $FS + 'a.mp4'); local = $true },
    @{ what = 'a root that only starts with a public word'; text = ($C + ':' + $BS + 'workd' + $BS + 'a.mp4'); local = $true },
    @{ what = 'a real folder whose name is a fixture root'; text = ($D + ':' + $BS + 'tmp' + $BS + 'a.png'); local = $true },
    @{ what = 'a non-public root'; text = ($D + ':' + $BS + 'personal' + $BS + 'a.mp4'); local = $true }
)

foreach ($case in $filterTests) {
    $hit = Find-LocalPath -Text $case.text -InTest:([bool]$case['inTest'])
    if ([bool]$hit -ne $case.local) {
        Write-Host ("FAIL: self-test, {0}: local={1}" -f $case.what, (-not $case.local))
        Write-Host "FAIL: the check itself is broken; fix the public roots before trusting a green run"
        exit 2
    }
}

$problems = New-Object System.Collections.Generic.List[string]
$warnings = New-Object System.Collections.Generic.List[string]

if ($denyMissing) {
    $warnings.Add("deny list not found at ai-tmp/local_text/deny-list.txt - private terms are not checked")
}

if ($Message) {
    # `git rev-parse --git-path` is the only reliable way to find this: in a
    # linked worktree the file lives under the main repository's .git, not
    # beside the sources.
    $gitPath = git -C $root rev-parse --git-path COMMIT_EDITMSG 2>$null
    if (-not $gitPath) {
        Write-Host "OK: no commit message to check"
        exit 0
    }
    $path = $gitPath
    if (-not [System.IO.Path]::IsPathRooted($path)) {
        $path = Join-Path $root $path
    }
    if (-not (Test-Path -LiteralPath $path)) {
        Write-Host "OK: no commit message to check"
        exit 0
    }
    $number = 0
    foreach ($line in (Get-Content -LiteralPath $path -Encoding UTF8)) {
        $number++
        $problem = Find-Problem -Where "the commit message:${number}" -Text $line
        if ($problem -ne $null) { $problems.Add($problem.Message) }
    }
    Write-Host ("message: {0} line(s) of the commit message" -f $number)
} elseif ($All) {
    $tracked = @(git -C $root -c core.quotepath=false ls-files)
    foreach ($file in $tracked) {
        $nameProblem = Find-NameProblem -Name $file
        if ($nameProblem -ne $null) { $problems.Add($nameProblem) }
        if ($file -notmatch $textFilePattern) { continue }
        # Vendored code is not our prose; its Windows path handling would only
        # add noise to the audit.
        if ($file -like '.yarn/*') { continue }
        $full = Join-Path $root $file
        if (-not (Test-Path -LiteralPath $full)) { continue }
        $number = 0
        $inTest = Test-FileName -Name $file
        foreach ($line in (Get-Content -LiteralPath $full -Encoding UTF8)) {
            $number++
            $problem = Find-Problem -Where "${file}:${number}" -Text $line -InTest:$inTest
            if ($problem -eq $null) { continue }
            if ($problem.Kind -eq 'path') { $warnings.Add($problem.Message) }
            else { $problems.Add($problem.Message) }
        }
    }
    Write-Host ("audit: {0} tracked files, {1} warning(s)" -f $tracked.Count, $warnings.Count)
} else {
    $scope = ""
    if ($Pushed) {
        if ($Range) {
            # The hook passes shas reported by git, never a branch expression.
            if ($Range -notmatch '^[0-9a-fA-F]{4,40}\.\.[0-9a-fA-F]{4,40}$') {
                Write-Host "FAIL: invalid push range"
                exit 2
            }
            $scope = $Range
        } else {
            # A branch has no remote range yet (new branch, or no upstream). Compare it
            # with its upstream merge base or the closest default branch, never only
            # with the last commit: a path in an earlier commit of a new branch must be
            # caught too. With no base at all, the whole branch is checked.
            $scope = "4b825dc642cb6eb9a060e54bf8d69288fbee4904..HEAD"
            $hasParent = $false
            try {
                $hasParent = [bool](git -C $root rev-parse --verify "HEAD~1" 2>$null)
            } catch {
                $hasParent = $false
            }
            if ($hasParent) {
                $current = $null
                try {
                    $current = git -C $root symbolic-ref --short HEAD 2>$null
                } catch {
                    $current = $null
                }
                $base = $null
                $upstream = $null
                try {
                    $upstream = git -C $root rev-parse --abbrev-ref --symbolic-full-name "@{u}" 2>$null
                } catch {
                    $upstream = $null
                }
                if ($upstream -and $upstream -notmatch '^\s*$') {
                    try {
                        $base = git -C $root merge-base $upstream HEAD 2>$null
                    } catch {
                        $base = $null
                    }
                }
                if (-not $base -or $base -match '^\s*$') {
                    foreach ($candidate in @("origin/HEAD", "origin/main", "origin/master", "upstream/master", "main", "master")) {
                        # Comparing the default branch with itself is empty; only another branch
                        # narrows the range. The current branch itself falls through to "whole tree".
                        if ($current -and $candidate -eq $current) { continue }
                        try {
                            $candidateBase = git -C $root merge-base $candidate HEAD 2>$null
                        } catch {
                            $candidateBase = $null
                        }
                        if ($candidateBase -and $candidateBase -notmatch '^\s*$') {
                            $base = $candidateBase
                            break
                        }
                    }
                }
                if ($base -and $base -notmatch '^\s*$') { $scope = "$base..HEAD" }
            }
        }
        Write-Host ("push: checking {0}" -f $scope)
        $staged = @(git -C $root -c core.quotepath=false diff --name-only --diff-filter=ACMR $scope)
        $diff = git -C $root -c core.quotepath=false diff -U0 --no-color $scope
    } else {
        $staged = @(git -C $root -c core.quotepath=false diff --cached --name-only --diff-filter=ACMR)
        if ($staged.Count -gt 0) {
            $diff = git -C $root -c core.quotepath=false diff --cached -U0 --no-color
            $scope = "cached"
        } else {
            $diff = git -C $root -c core.quotepath=false diff -U0 --no-color
            $scope = "worktree"
        }
    }

    foreach ($name in $staged) {
        $nameProblem = Find-NameProblem -Name $name
        if ($nameProblem -ne $null) { $problems.Add($nameProblem) }
    }

    $file = ""
    $number = 0
    foreach ($line in ($diff -split "`n")) {
        if ($line -match '^\+\+\+ b/(.+?)\s*$') {
            $file = $Matches[1]
            $number = 0
            continue
        }
        if ($line -match '^@@ .* \+(\d+)') {
            $number = [int]$Matches[1]
            continue
        }
        if ($line -notmatch '^\+' -or $line -match '^\+\+\+') { continue }
        $inTest = Test-FileName -Name $file
        $problem = Find-Problem -Where "${file}:${number}" -Text $line.Substring(1) -InTest:$inTest
        if ($problem -ne $null) { $problems.Add($problem.Message) }
        $number++
    }

    # git prints no `+` line for a binary file, so its bytes were never read: the
    # name was checked, the content was not. Say so instead of letting the run look
    # complete. A real video or a screenshot whose name says nothing is exactly the
    # case this cannot decide.
    if ($staged.Count -gt 0) {
        $numstat = if ($Pushed) {
            git -C $root -c core.quotepath=false diff --numstat $scope
        } elseif ($scope -eq "cached") {
            git -C $root -c core.quotepath=false diff --cached --numstat
        } else {
            git -C $root -c core.quotepath=false diff --numstat
        }
        foreach ($line in $numstat) {
            if ($line -match "^-\t-\t(.+)$") {
                $warnings.Add("binary file not scanned: $($Matches[1])")
            }
        }
    }
}

foreach ($warning in $warnings) { Write-Host "warning: $warning" }

if ($problems.Count -gt 0) {
    foreach ($problem in $problems) { Write-Host "FAIL: $problem" }
    Write-Host ("FAIL: {0} local or private item(s) would be committed" -f $problems.Count)
    exit 1
}

Write-Host "OK: nothing local in the change"
exit 0
