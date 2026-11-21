# AGENTS.md

LosslessCut — Electron + React + TypeScript FFmpeg GUI. Main process (`src/main`), React UI (`src/renderer`), preload bridge (`src/preload`), shared code (`src/common`).

## Fork scope
- This fork (patch-lossless-cut) **only supports and maintains Windows**. Windows x64 is the only shipped target (`.github/workflows/release-win.yml` → `LosslessCut-Patch-win-x64.7z` / `.zip`); macOS, Linux, Mac App Store and Windows ARM64 packaging, signing and platform support are upstream concerns — we do not build or ship them. (`test.yml` still runs its `ubuntu-latest` job for upstream base parity: keep it green, but don't add Linux-only work.)
- Corollary: don't take work on that assumes a mac/linux build, a signed bundle or a non-Windows dev machine. Cross-platform fixes that come for free (pure `src/common` logic) are fine; a change that can only be verified on another OS is out of scope.
- "Windows only" narrows the target platform — it does not relax the fork discipline below (`patchMode` gating, no rewrites of upstream-owned trees, etc.).

## Fork identity (coexists with the official build)
- The fork ships as **`LosslessCut-Patch`** so it can be installed next to the official `LosslessCut` on the same machine: `appName` in `src/main/common.ts` (drives the userData dir `%APPDATA%\LosslessCut-Patch`, the Windows AppUserModelID, and Electron's single-instance lock, which is per userData), `productName` + `build.appId` (`io.github.tifiyitifi.losslesscut-patch`) in `package.json`.
- Because the *official* app's userData is `%APPDATA%\LosslessCut`, never reintroduce a shared name, config path or appId "for convenience" — that silently couples both installs' config, logs, cache and single-instance lock again. Do not add an automatic config migration from the official directory for the same reason; it is a one-time manual copy if a user wants it.
- Update check: `forkReleaseOwner` / `forkReleaseRepoName` in `src/common/constants.ts` point at this fork's public repository (`tifiyitifi/lossless-cut-patch-public`); `checkNewVersion()` reads that repo's releases and does nothing while the constants are empty (`isForkReleaseConfigured()`). Never point the check at `mifi/lossless-cut` — it would offer the official build as an "update" over this fork. The "Download {{version}}" menu item and the release-notes link follow the same constants.

## Privacy: never commit real local paths
- Work happens on the user's real machine, so terminals, logs, screenshots and test runs show their drives, folders and file names (often personal video titles). None of that may end up in the repository, a commit message, a release note or an issue.
- Use stand-ins: `a.mp4`, `b.mp4`, `001.mp4`, `002.mp4`, `C:\work\inbox`, `E:\work\batch`, `abcd`, `USERNAME`. The tests already do this (`C:\work\inbox\...` in `batchPaths.test.ts`); keep the shape of the path, never the person (`<work>\.losslesscut_work\detached_src_media\a.mp4`).
- A real path that genuinely explains a bug belongs in `ai-tmp/` (gitignored) or in a plain description ("a video in the output folder"), never in a source comment, doc, test, fixture, changelog, commit message or issue.
- Screenshots and log excerpts pasted into `docs/`, `versions/` or an issue are cropped or renamed the same way: no drive letters, account names, download-site titles or batch/series names.
- Check before committing: read the staged diff for absolute paths and personal names (`git diff --cached` - search `C:\`, `D:\`, `/Users/`, `/home/`) and re-read the message. Only stand-ins like `C:\work\...` may match. When a commit does leak, rewrite it (amend/squash) instead of "fixing it later", even before it is pushed.

### Local privacy gate
- `script/check-local-paths.ps1` checks what git is about to commit: an absolute path (drive letter, UNC, `/Users/`, `/home/`, `~/`), a local project file (`.llc`), anything under `ai-tmp/`, and any term in the gitignored `ai-tmp/local_text/deny-list.txt`. It also rejects the machine's own profile and this checkout, even when they sit under an accepted root. The default mode reads the staged diff (or the working diff when nothing is staged); `-Message` reads `COMMIT_EDITMSG`; `-Pushed` reads the exact `<remote sha>..<local sha>` range git reports; `-All` audits the tracked tree, where a path that is already committed is a warning. Exit code 2 means the checker failed its own sample, not that the tree is clean.
- Install once per clone: `pwsh -NoProfile -ExecutionPolicy Bypass -File script/install-git-hooks.ps1` (pre-commit, commit-msg, pre-merge-commit, pre-push). `-Remove` uninstalls; `-Force` replaces a hook written by another tool. Worktrees share the hooks directory, and a fresh clone has no gate until this runs.
- The deny list is local and gitignored: the install script copies `script/local-gate-deny-list.example.txt` to `ai-tmp/local_text/deny-list.txt` on first install and adds the current account name. Add real folder names, download-site titles, and series/batch names there; never commit the filled-in file. A fresh clone has to rebuild it.
- Limits: documented stand-in roots (`C:\work`, `C:\videos`, `C:\a`, `C:/tmp`, ...) and the roots already used by `*.test.ts` / `test/fixtures/` are accepted, so a real name below one of them is not detectable — the deny list and the manual read above cover that. Binary files are only name-checked (the run warns), `ai-tmp/` is not audited, CI does not run the check, the hooks fail open when PowerShell is missing, and `--no-verify` can skip a hook (pre-push is the last one that can still catch it).

## Setup
- Node 22+ (CI pins 22; a newer local Node is fine). Yarn 4 (Berry) pinned via `yarnPath` in `.yarnrc.yml`. Use `yarn`, never npm.
- `yarn install` (slow first run). `.yarnrc.yml` sets `enableScripts: false` and `npmMinimalAgeGate: 2880`; `YN0004 "lists build scripts"` warnings are expected — do NOT set `enableScripts: true` (see `CONTRIBUTING.md`).
- `yarn dev` = electron-vite dev, renderer HMR on `127.0.0.1:3001`. In dev, ffmpeg/ffprobe come from `PATH`; the bundled `ffmpeg/` dir is only for packaged builds (`yarn download-ffmpeg-win32-x64`, etc.).

## Dependency placement (electron-vite quirk)
- `src/main` / `src/preload` deps are externalized → runtime `require`d packages belong in `dependencies`.
- Renderer is bundled → its packages go in `devDependencies`. Most "runtime-looking" libs live in `devDependencies` on purpose; don't "fix" this.

## Commands
- `yarn tsc` — `tsc --build` project refs; emits gitignored `common-ts-dist/` + `main-ts-dist/`. Never edit those. (vitest excludes `common-ts-dist` so tests don't run twice.)
- `yarn test` — vitest in watch; one-shot `yarn test run`; single file `yarn test run src/main/ffmpegUtil.test.ts`; snapshots in `src/renderer/src/__snapshots__/`, update with `yarn test run -u`.
- `yarn lint` — eslint (`eslint-config-mifi`).
- `yarn build` — `generate-icon` + `electron-vite build` → `out/`.
- `yarn check` — tsc → lint → test → build → check-licenses → scan-i18n → dedupe → generate-docs. CI (`test.yml`) runs dedupe/test/tsc/lint/build/scan-i18n/generate-docs/check-licenses/generate-licenses. `yarn dedupe --check` must pass.
- `yarn ci` — `script/ci.ts`, a local replica of `test.yml` (dedupe → test → tsc → lint → build → scan-i18n → generate-docs + stale-generated-files assert → check-licenses → generate-licenses). Use it before pushing or when Actions is blocked; it never runs `git reset --hard`, it only fails when a generated file (`docs/generated/types.md`, `locales/en/translation.json`) is stale.
- `script/install-git-hooks.ps1` — install the local privacy hooks; see "Local privacy gate".

## Generated files — regenerate, don't hand-edit
- `docs/generated/types.md` from `src/common/userTypes.ts` via `yarn generate-docs`. CI fails if stale after public-type changes.
- `src/renderer/src/versions.json` from `versions/*.md` via `node script/generateVersions.ts`.
- `locales/en/translation.json` via `yarn scan-i18n`. User-facing strings use `t()` / `<Trans>`; key & namespace separators are disabled, so keys are literal English sentences. Keep `i18next.config.base.ts` in sync with `src/main/i18nCommon.ts`.

## Packaging
- `yarn build`, then electron-builder. `pack-win` (`--win zip`) OVERRIDES the `win.target` (`7z`+`appx`) in `package.json`, yielding a `.zip`. Official CI (`.github/workflows/build.yml`) runs `electron-builder --win --x64` with no target flag → `dist/LosslessCut-Patch-<version>-win-x64.7z`. Use the no-target form for the official-style portable 7z.
- Fork release CI (`.github/workflows/release-win.yml`): push to the `squash-release` branch builds Windows x64 `7z`+`zip` via `electron-builder --win 7z zip --x64`, then tags `v<package.json version>` at the pushed commit and publishes a GitHub release. The tag is skipped when it already exists, so a release requires bumping `version` in `package.json` first. Release notes come from `versions/<version>.md`. No mac/linux/appx/signing.
- mac/mas/appx builds need certs/secrets; portable win 7z/zip needs none.
- Upstream's nightly (`build.yml` → `schedule`) is opt-in via the repository variable `NIGHTLY_ENABLED=true` and is off by default: one full-platform run uploads ~0.9 GB of artifacts, and GitHub Free (private repos) only includes 500 MB of artifact storage with 90-day retention, so a nightly here would blow the quota daily. It also needs signing secrets this fork does not have. `script/uploadArtifacts.ts` caps retention at 3 days. Do not enable it without checking the artifact-storage allowance.

## Release (squash branch)
- `patch-cut-dev` is where work happens; `squash-only` and `squash-release` are release-only staging branches, and `release` holds release-only commits (version bumps) from before the squash line existed. Never commit feature work to `release`, `squash-only` or `squash-release`.
- A release starts with ONE commit on `patch-cut-dev`: bump `version` in `package.json`, add `versions/<version>.md`, and regenerate `src/renderer/src/versions.json`. The tree of that commit is what the squash carries; the dev branch is never rewritten.
- `squash-only` holds the squashed commit built from the dev tip. Push it to `origin` (private) for safekeeping; its push does not trigger the release CI.
- `squash-release` is the same tip as `squash-only` (a clean release branch, not a second squash). Push it to the public repository: `squash-release` triggers `release-win.yml`, and `main` is fast-forwarded to the same commit so the repository homepage and the release show the same tree.
- The squash commit's parent must be the current public `main` tip, so the push to `main` is a fast-forward. Build it without checking the branch out, so the working tree is untouched:
  ```bash
  tree=$(git show -s --format=%T <dev-commit>)
  new=$(git commit-tree "$tree" -p <public-main-tip> -m "feat: X.Y.Z — <headline items>")
  git branch -f squash-only "$new"
  git branch -f squash-release "$new"
  git diff squash-release <dev-commit> -- .   # must be empty
  ```
- Then push, in this order:
  ```bash
  git push origin squash-only                              # private backup, no CI
  git push public squash-release:refs/heads/main           # fast-forward, homepage
  git push public squash-release:refs/heads/squash-release # triggers release-win.yml
  ```
  CI tags `v<package.json version>` at the pushed commit and publishes a GitHub release with the two Windows archives and `SHA256SUMS.txt`. Bump the version first; a tag that already exists makes the run a no-op.
- `build.yml`'s `v*` tag trigger and the release-published trigger of `website-release-deploy.yml` are guarded in the fork, so a release only builds the Windows x64 packages and never starts the upstream full-platform build or the website deploy. Do not re-enable them for a fork release.

## Architecture
- `src/main/index.ts` is the Electron entry (package main = `./out/main/index.js`); it owns ffmpeg exec, HTTP server, menu, config store, and the RPC actions the renderer calls.
- `src/preload/index.ts` bridges renderer→main via `ipcRenderer.invoke('__electron_rpc__')`, exposed as `window.electron`.
- `src/common` is shared. Import-extension quirk: renderer uses extensionless paths (`../../common/util`); main/preload use explicit `.js` (`../common/util.js`). `src/common/userTypes.ts` is the public type surface.
- CLI + HTTP API: launch with `--http-api <port>`, dispatch actions via `POST /api/action/<name>` (see `docs/api.md`). `script/e2e.ts` drives the built app this way for CI screenshots.

## Git / fork
- `origin` = the private fork. Its address is deliberately not written down here or anywhere in the tree: it lives only in `.git/config`, so it is entered at clone/remote-add time. `upstream` = `mifi/lossless-cut` with `push` set to `no_push` — never push to upstream. Current work branch: `patch-cut-dev`. `release`, `squash-only` and `squash-release` are release-only (see "Release (squash branch)").
- `yarn sync-upstream <target-repo>` (`script/syncUpstream.ts`) mirrors upstream into the target passed on the command line (a remote name such as `origin`, or a URL), so the private address is entered per run instead of being committed. It fetches `upstream` with `--prune --tags` (that prunes its remote-tracking branches, not the local tags), then pushes **every upstream branch and tag under the `upstream/` namespace** (`upstream/master`, `upstream/v3.70.2`, `upstream/stores/apple`), and verifies every mirrored sha afterwards. The namespace is mandatory: the public repository's own `main` and its release tags (`v3.70.2-patch.1`) share the same repo, and upstream's workflows trigger on `master` and on plain `v*` tags — a namespaced ref matches neither, so mirroring can never overwrite the release line or start an upstream CI run. Only tags that exist on the upstream remote are mirrored, so the fork's own tags (e.g. `pre-upstream-merge`) are never published under a name that claims they came from upstream. Nothing is force-pushed and no ref is deleted: a ref that collides with an existing one is rejected and fails the run without overwriting it, and branches or tags removed upstream stay on the target until removed by hand. Local `master` still tracks `upstream/master` (with push disabled), so pushing it needs an explicit `git push origin master`.
- Commit with the GitHub *noreply* identity (`<id>+<login>@users.noreply.github.com`, already set in this checkout's `git config user.email`); never use or paste a real email address.

## Fork discipline
- Default to upstream conventions (logging / config / imports / i18n all follow upstream as-is).
- Do NOT rework existing code in upstream-owned trees (`src/main`, `src/renderer`, `src/preload`, `src/common`); only do the minimum cross-cutting wiring a task needs. No drive-by refactors, renames, or reformats.
- Any fork-only practice must first justify that it is worth carrying as a permanent diff against upstream.

## Feature slices (fork-only)
- `src/common/features/<name>/` — cross-process shared types + pure logic.
- `src/main/features/<name>/` — main-process part (ffmpeg / config / files).
- `src/renderer/src/features/<name>/` — UI + hooks.
- Cross-process wiring only in `src/main/index.ts` (RPC actions) and `src/preload/index.ts`.
- Tests are colocated (`*.test.ts` next to source); a slice must be deletable as a whole.

## Patch mode (stepwise)
- Progress source of truth: `ai-tmp/patch-mode-steps.md` (gitignored). Update its step table in the same commit as the step.
- Patch mode is base parity plus workflow layers: `PatchApp` renders the upstream `App` with a `patchMode` prop, so every base feature stays available. Patch behavior is added one step at a time as separate layers, never by rewriting base.
- The old multi-panel patch UI is frozen in `src/renderer/src/features/patchLegacy/`: not imported, not type-checked (`tsconfig.web.json` excludes it), not linted (`.eslintignore`), not bundled. Never edit or extend it, and never delete it unless the user explicitly asks for removal after the new patch mode is complete (`patchLegacyUiEnabled = false` in `features/patch/patchLegacyPolicy.ts` records the intent).
- Upstream seams: only small `// patch:`-marked blocks in `src/renderer/src/App.tsx` / `NoFileLoaded.tsx` / `src/main/menu.ts`, gated by `patchMode` / `entryMode`. Never change base-mode behavior.
- New patch features go into new slice dirs under `src/{common,main,renderer/src}/features/<name>/`; one step = one commit.
- Fork code must honor upstream loader contracts: `useSegments.loadCutSegments` throws a user-facing error on an **empty** list (an empty EDL is a broken file — base semantics, never change it). A fork caller whose data may be empty must clear instead (`clearSegments`), and put that decision in a pure `common` function with a test (e.g. `planMergedChapterSync`).

## Testing (TDD, scoped)
- Write the failing test first for behavior changes, covering: pure functions in `src/common`, ffmpeg args / migrations / config in `src/main`, and model/services of new slices.
- Exempt: UI layout, Electron natives (dialog/tray/window), packaging, e2e.
- Colocated vitest; single file via `yarn test run <file>`; `yarn tsc && yarn test run` must pass.

## i18n
- **No hardcoded UI strings (zero exemptions)**: renderer JSX/components AND any user-facing copy in the main process — dialog text, menu labels, notifications, error/prompt messages — must all go through `t()` / `<Trans>`. No raw string literals for user-visible text.
- Add the English key for every new UI string in the same change (keys are literal English sentences; separators are disabled), then run `yarn scan-i18n`.
- Never build display text by concatenation; use i18next interpolation (placeholders + runtime args).
- Out of scope: log messages, technical constants (URLs, storage keys, enum names, routes), test names.
- Keep `i18next.config.base.ts` in sync with `src/main/i18nCommon.ts`.

## Upstream conventions (inherited with the 3.70.2 merge)
- **Changelog trailer**: a commit that changes user-visible behaviour ends with a `Changelog: <one line for users>` trailer (omit it for refactors/tests/CI/dependency bumps). They are collected at release time, see `RELEASING.md`.
- **Features list**: `docs/features.md` is the full feature list; update it in the same commit as a user-visible feature change. `README.md` and the homepage only show the 9 highlights.
- **FFmpeg**: only the bundled version (`script/downloadFfmpeg.ts`) is supported — never keep compatibility code for older FFmpeg versions.
- **Releasing**: follow `RELEASING.md`; never publish a release or post an announcement without the user's approval of the exact text.

