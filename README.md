<div align="center">
  <p><img src="src/renderer/src/icon.svg" width="120" alt="LosslessCut-Patch" /></p>
  <p><b>LosslessCut-Patch</b></p>
  A Windows-only fork of <a href="https://github.com/mifi/lossless-cut">LosslessCut</a> with a guided batch-cutting workflow
  <br>
  <br>
</div>

**中文简介：[README.zh-CN.md](README.zh-CN.md)**

> **This is a fork, not the official LosslessCut.** The official app is [losslesscut.app](https://losslesscut.app/) / [mifi/lossless-cut](https://github.com/mifi/lossless-cut). This build keeps all of the upstream lossless editing and adds **patch mode**: one work area per batch, a cut list per source, incremental exports, separate result windows, an explicit finish step and a clean-up check for parked sources. It is not affiliated with the upstream author, and the upstream project does not support it.
>
> The original upstream README is kept verbatim in [README.upstream.md](README.upstream.md) — its download links and store badges are the *official* app's, not this fork's.

## Contents

- [中文简介](#中文简介)
- [Download](#download)
- [First run: patch mode is the default](#first-run-patch-mode-is-the-default)
- [The workflow](#the-workflow)
- [Keys](#keys)
- [Where the files go](#where-the-files-go)
- [What patch mode adds](#what-patch-mode-adds)
- [Command console](#command-console)
- [Settings worth knowing](#settings-worth-knowing)
- [Base mode](#base-mode)
- [Build from source](#build-from-source)
- [Releases and versioning](#releases-and-versioning)
- [Troubleshooting](#troubleshooting)
- [Upstream, license and credits](#upstream-license-and-credits)

## 中文简介

- 本仓库是 [LosslessCut](https://github.com/mifi/lossless-cut) 的 Windows-only 分支，默认进入 **Patch 模式**；用 `Mode → Base mode` 可切回上游界面。
- 流程：拖入素材 → 逐关键帧定位并打点 → `E` 导出 → 片段窗 `E` 合并 → `Shift+E` 收尾并打开下一个；不想剪的视频用 `Ctrl+Delete` 丢弃，跳过不剪但保留源用 `Shift+F`。
- 落点：工作目录下 `.losslesscut_work/`（`clips` / `merged` / `detached_*`），以及同级的 `losslesscut_finished/`（`finished_*`）；工作区和成品目录里的视频只读。
- Patch 模式默认隐藏菜单栏（`Alt+Q` 显示），传输键为剪辑重映射（`X`/`Z`/`C` 变速、`D`/`F` 逐帧、`Alt+←`/`Alt+→` 跳秒、`↑`/`↓` 打点）。
- 完整说明见中文版：**[中文简介 → README.zh-CN.md](README.zh-CN.md)**。

## Download

Windows x64 only, portable (no installer):

- [**Latest release**](https://github.com/tifiyitifi/lossless-cut-patch-public/releases/latest) — `LosslessCut-Patch-<version>-win-x64.7z` or `.zip`, plus `SHA256SUMS.txt`.
- Unpack it anywhere and run `LosslessCut-Patch.exe`. FFmpeg is bundled, nothing has to be installed.
- The build is unsigned, so Windows SmartScreen may show "Windows protected your PC": *More info* → *Run anyway*.
- Windows 7/8 are not supported (upstream dropped them in 3.50.0); use Windows 10 or 11.
- *Help → Check for updates from GitHub...* checks **this fork's** releases and shows the result, including why GitHub could not be reached. It never offers an official LosslessCut build as an update. With enough free space and a published checksum it downloads the new package, verifies it against `SHA256SUMS.txt`, unpacks it next to the running app, swaps it in and restarts. `llc` and `config.json` from the installation folder are kept; a failed swap rolls back to the previous build, and a package that could not be applied is kept for a manual install. When the folder is read-only, no checksum is published or space is short, it opens the release page instead.

Settings, logs and the config live in `%APPDATA%\LosslessCut-Patch` (`patch-config.json`, `config.json`, `app.log`). The official app keeps its own `%APPDATA%\LosslessCut`, so the two do not share anything.

## First run: patch mode is the default

`Entry mode` defaults to **Patch mode**; the choice is remembered. Change it in `Settings` → `Entry mode`, or with `Mode` → `Patch mode` / `Base mode` in the menu bar.

Patch mode is a layer on top of the upstream editor, not a replacement: every upstream feature (streams, metadata, chapters, snapshots, scene detection, the batch tools, the CLI and HTTP API) is still there. It adds the *workflow* around cutting: where files are written, how a cut is re-exported, what happens when a video is done, and how the leftovers are cleaned up.

The first time you open a video, a work area is created next to it, so nothing has to be set up first. To keep a batch in one place instead, open `Mode → Working directory...` or type `tws` in the command console and pick a folder. Dropping a folder on the window only adds its media files to the source list.

The menu bar is hidden in patch mode so a bare `Alt` cannot take focus away from the cutting keys. Press `Alt+Q` when you need a menu entry, then hide it again.

## The workflow

The landing page shows a three-step quick guide that is enough for a first clip: drop one or more videos into the box → step keyframes, mark the in/out point and export → `Shift+E` finishes the video and opens the next one. Everything below is the same workflow in five stages, also available as *The whole workflow* on the landing page.

1. **Open the videos.** Drop files anywhere in the window, or click the dashed box. By default each video gets its own work area next to it; the folder names are in the working-directory settings. The source list at the top left holds media files only — project files, subtitles, notes and images stay out of it. With an empty list the first video opens automatically, and the list panel stays visible and says how to add files.
2. **Operations and keys.** Playback is the upstream player, but the transport is re-mapped for cutting: `←`/`→` step one keyframe, `Alt+←`/`Alt+→` seek one second, `↑`/`↓` (also `I`/`O` and `Alt+↑`/`Alt+↓`) mark the in/out point. `Space` plays without changing the speed, `K` resets it to 1x, `X`/`Z`/`C` slow down / toggle 1x and the last chosen speed / speed up, and `D`/`F` step one frame. `Alt+Q` shows the menu bar, `M`/`-`/`=` handle the volume, and `Alt+Z` is comfort zoom. `Alt+/` makes the next in point start a new segment instead of moving the current one, and pressing it again cancels it. `PgUp`/`PgDn` walk the segments; `Shift+→` stops a configurable lead-in before the segment end and reaches the end on a second press. For exact times press `G` (or numpad `/`) and type a timecode. The circle at the bottom right of a segment decides whether it is exported; dragging a row changes only the export and merge order, not the segment times.
3. **Export and finish.** `E` opens the cut export settings and `E` again starts the export. Only clips that changed are re-cut; unchanged results are reused or renamed, and the notice says how many of each. The cut clips open in their own window, where `PgUp`/`PgDn` walk the playlist, `N` renames the label, `Shift+N` renames the file and `E` merges the clips into one file after opening the naming dialog. `Shift+E` is always the finish key: the dialog decides where the source goes (`finished_src_media`, `detached_src_media` for later deletion, or left where it is), whether the clips and merged file are kept, deleted or left in the work area, and whether empty work folders are cleaned up. It then opens the next file or stays on the same video, as the dialog says. Finishing can also be done in several passes: *Leave them in the work area* keeps the cut results tracked for a later export or finish. A cut-only job moves an existing merged result to `finished_merged` by default.
4. **Discard and skip.** `Ctrl+Delete` discards a video you do not want to cut: it moves the source (with its `.llc`) to `detached_src_media` and opens the next one; the results it already has are deleted by default or moved aside. `Shift+F` skips the cut processing but keeps the source, which moves to `finished_skip_src`. The last video of the batch stays open. A video inside a work or finished folder is read-only: an editing action opens a dialog asking you to move it out before cutting again. Closing the source window also closes its clip-result and merged-result windows.
5. **Clean up the sources waiting for deletion.** Open *Work folders and results* (File menu, right-click almost anywhere in a patch window, or `opl`), select the work folder and press *Check deletable source videos*. It opens a window of its own listing each parked source next to the results it produced, with a full decode check per column. By default only a source whose kept result is still on disk can be deleted there; the window's settings button can also allow sources with no result, results gone from disk or only parked results, one kind at a time. A card that cannot go says why on its state line, and the confirmation lists every file it will remove. The results themselves are left alone.

## Keys

Defaults in patch mode; every one of them can be rebound in the in-app shortcut list (`Help` → `Keyboard & mouse shortcuts`, or `Shift+/`), and the on-screen hints follow your bindings. The shortcut list opens with a table of every key patch mode runs differently and a table of your own changes. Default keys can only be switched off, never deleted; a key bound to a patch-only action reports that it has no effect in base mode instead of doing nothing.

| Key | Action |
| --- | --- |
| `Space` | play / pause, without changing the speed |
| `K` | reset the speed to 1x |
| `X` / `Z` / `C` | slow down / toggle 1x and the last speed you chose / speed up |
| `D` / `F` | step one frame back / forward |
| `,` / `.` | step one frame back / forward (upstream keys, still active) |
| `←` / `→` | step one keyframe |
| `Alt+←` / `Alt+→` | seek one second |
| `↑` / `↓` (or `I` / `O`, `Alt+↑` / `Alt+↓`) | set the in / out point |
| `Shift+←` | jump to the start of the current segment |
| `Shift+→` | stop a lead-in before the segment end; press again for the end |
| `B` | split the current segment |
| `Delete` | remove the current cut point |
| `N` | label the current segment |
| `Ctrl+D` | duplicate the current segment |
| `Alt+/` | the next in point starts a new segment |
| `PgUp` / `PgDn` | previous / next segment (and seek there) |
| `Ctrl+PgUp` / `Ctrl+PgDn` | first / last segment |
| `Shift+PgUp` / `Shift+PgDn` | open the previous / next source video and start playing |
| `Shift+↑` / `Shift+↓` | move the file-list highlight (the file is not opened) |
| `Ctrl+Shift+↑` / `Ctrl+Shift+↓` | open the previous / next source video, paused |
| `Backspace` | jump to the start of the video |
| `Enter` | toggle full screen |
| `G` / numpad `/` | go to a timecode (the same key closes the box) |
| `E` | export options, then export — in the clip window: merge |
| `Ctrl+E` | capture a snapshot |
| `Shift+E` | finish the job |
| `Shift+F` | skip the cut and keep the source in `finished_skip_src` |
| `Ctrl+Delete` | discard the video (move it to the waiting-for-deletion folder) |
| `M` / `-` / `=` | mute / volume down / volume up |
| `Alt+Z` | comfort zoom |
| `Alt+Q` | show / hide the menu bar |
| `Shift+Space` | command console |

`G` accepts a compact time: plain digits are read as `HHMMSS` (`123456` = 12:34:56), a leading `..` switches to the timecode format, and a leading `+` or `-` seeks relative to the current position. The same key opens and closes the box.

In patch mode, stepping one frame (`D` / `F`, `,` / `.`, the wheel or the buttons under the player) pauses only for the seek and resumes playback as soon as it lands, so a step taken while playing does not race the playhead.

`X`/`C` change the speed by a fixed 0.1 per press by default (PotPlayer style); the upstream multiplier can be selected in the settings. `Z` toggles between 1x and the last speed you chose, which is remembered across files and restarts; `K` is always a plain reset.

## Where the files go

```
<working directory>\
  video.mp4                    the source video, left unmodified
  .losslesscut_work\           the app's work area (leading dot keeps it out of the way)
    clips\                     cut results
    merged\                    merge results
    detached_src_media\        sources you discarded ("delete later")
    detached_clips\            cut results you discarded ("delete later")
    detached_merged\           merged results you discarded ("delete later")
  losslesscut_finished\        what a finish job keeps (sibling of the work area)
    finished_src_media\
    finished_skip_src\         sources skipped with Shift+F
    finished_merged\
    finished_clips\
    finish_llc\                archived .llc project files (one possible destination)
```

- Both folder names are configurable (`workDirName` / `finishedDirName` in the working-directory settings); the old names keep being recognized, so renaming does not expose an existing work area to cutting.
- Three names are used below: the **working directory** is the configured root (`tws`), a **work area** is the `.losslesscut_work` folder of one source, and a **work folder** is what the work-folders dialog lists (one per working directory the app has worked in).
- Right-click almost anywhere in a patch window (the landing page, the video, the timeline, a segment row, a source row or a results window) to open *Work folders and results…*. It lists every work folder with what each source became and has buttons for its stage folders; a folder that does not exist yet is greyed out.
- Without a working directory the work area is created next to the source video instead.
- The project file's destination is chosen in the finish dialog and is independent of the source: by default it is archived in the installation folder's `llc/` (grouped by date), with `finish_llc`, the app-data folder, a custom folder or "stay where it is" as alternatives.
- `detached_*` is a parking lot, not a trash can: the app does not empty it on its own. Moving a file there does not free disk space; only deleting it does. By default the deletion check deletes a parked source only when a kept result of it is on disk (see [The deletion check](#the-deletion-check)); its settings can also allow sources with no result, results gone from disk or only parked results. Anything not allowed there has to be removed in the file manager.

## What patch mode adds

### Working directory and work area

- One working directory per batch; the app maintains `.losslesscut_work` inside it and writes every cut/merge result there instead of next to the source.
- A source opened **from inside the work area or the finished folder** is read-only: the badge says `In the work directory` or `In the finished folder`, the cutting controls are greyed out (playback and seeking still work), and cutting keys open the folder dialog instead of starting a job. Move the video out to cut it again.
- A work-area lock makes sure only one export, finish or delete job writes into a work area at a time — including across two running instances.
- Only empty work areas (whitelisted stage folders and the app's export manifest) can be moved to the recycle bin, from the finish dialog or later with `cewd`; anything else is refused.

### Cutting

- The segment list is also the export queue: selection, order and labels decide what the results are and how they are named. Dragging only reorders; times change only when you mark or edit points.
- Forced new segment (`Alt+/`), duplicate (`Ctrl+D`), split (`B`), label (`N`), cut-point removal (`Delete`), keyframe-accurate stepping and a compact timecode dialog (`G`).
- `Shift+click` a row for a temporary multi-selection, then delete those rows, mark them exported or not exported, or keep only them from the bar under the list. This selection is separate from the export circles.
- `Shift+→` uses a configurable lead-in so the end point does not have to be pixel-hunted on the last frame.
- By default the last cut result reaches the source video's real last frame, including the frame the player's duration may cut off.

### Export

- Incremental: a manifest in the work area remembers which result came from which cut. Only changed clips are cut again; unchanged ones are reused or renamed, and the finished notice reports `reused / renamed / exported`. `exportforce` in the console cuts everything again.
- A renamed or reordered result only changes names in the manifest; re-cutting happens when the actual cut times or export parameters change. Signatures are kept per segment, so a partial export does not mark untouched clips as up to date.
- Result names come from a naming rule (`{source}`, `{label}`, `{seg_num}`, `{cut_from}`, `{cut_to}`, `{date}` …), separate from the merged-result rule. Two results of one export that would get the same name both receive the position and the export time. A name already taken by a file the app does not own is not overwritten silently: with overwrite off that result is skipped and reported, with overwrite on the file is replaced. If a name does not fit the file name or the Windows path budget, the export is blocked with an error in the export dialog until the rule or the working directory is shortened.
- Free disk space is checked before writing (1.1× the expected size plus a margin), so a long export does not die halfway.
- A damaged first GOP (common in downloaded files) is detected and reported: no cut can repair those frames, only a new download or re-encoding that spot can.
- While an export runs the cut list is locked, but the player stays usable: the progress box can be dragged, and playing, pausing, seeking, stepping frames, changing speed, entering a timecode and clicking the timeline keep working. Clicking the progress box dims the window again; clicking elsewhere fades the dim.

### Reviewing results

- Cut results open in their own window, merged results in another. Both belong to the cutting window and close with it. `PgUp`/`PgDn` walk the playlist, `N` renames the result label, `Shift+N` renames the file, `E` merges the clips.
- Auto-open, single-window playback and reload-after-export are settings; `rsw` (or `resumewindows`) reopens both windows for the current file, `tcw` / `tmw` toggle one. The lists also have an "other" section for results in the same folders that are not in the current playlist.
- Result windows do not ask about embedded chapters: a result carries its source's chapter table, and neither window can cut.

### Merging

- Merging in the clip window is lossless and uses exactly the clips on disk — nothing is re-encoded. It joins them in the cut-queue order, so reordering and exporting again changes the merge without re-cutting.
- Lossless joins leave a hole of a few frames at each join, so playback stutters there and races for a moment after a seek. The export options repair it: **A** keeps a little past every cut end, **B** cuts exactly where you asked, **C** keeps the old behaviour. The choice is made at the cut step, so the clips themselves are already merge-ready.
- The merged file name follows its own rule (`{source}`, `{labels}`, `{label}`, `{count}`, `{date}` …). Changing a clip makes the old merge stale; `E` in the clip window merges again. The merge window shows read-only chapters and a read-only segment list, with `S` / `Shift+S` for chapter selection.

### Finishing

- `Shift+E` and `Shift+F` are two separate workflows with their own remembered choices. `Shift+E` ends work you did on the video; `Shift+F` skips the cut and keeps the source. The window decides what `Shift+E` ends: the cut-results window ends with the clips, the merged-result window with the merge, and the source window with the clips as well; `zm` ends with the merge there and `zc` with the clips.
- `Shift+E` presets: *Process this video, then the next one* (source → `detached_src_media`, merged result → `finished_merged`, cut results → `finished_clips` or deleted, then the next video), *Process this video, keep the source, then the next one* (same, but the source goes to `finished_src_media`), *Keep working on the same video, reusing its cut list* (source and cut list stay, the merged result leaves; in a merge job the cut results stay tracked, a cut-only job moves them out), plus custom choices. `Shift+F` adds *Skip and move this video, then the next one* (source → `finished_skip_src`).
- The finish dialog lists the final path of the merged result and of every kept cut result before anything moves, and its summary lists the paths the job left behind. A path is selectable text and a click copies it.
- The finish job moves the source to `finished_src_media`, `finished_skip_src` or `detached_src_media` (or leaves it where it is), keeps, moves or deletes the cut results, archives or keeps the `.llc` project file, and moves the merged result. A cut-only job moves an existing merged result to `finished_merged` by default. Rename choices for the cut results are applied as they move.
- A confirmation guards permanent deletion (`Ask before permanently deleting files`). Both the permanent-delete confirmation and the completion summary have a "do not show again" box; on the summary it is checked by default for a clean job, so confirming once silences it, while a summary with warnings has no such box and is always shown. The finish dialog can also move the emptied work folder to the recycle bin — only when nothing but the app's own empty stage folders and its export manifest are left — and `cewd` does the same later by hand.
- The last video of a batch stays open; it is read-only if it was moved into a work or finished folder, so move it out to cut it again.

### Discarding a video

- `Ctrl+Delete` is the way out of a video you do not want to cut. It **does not delete the video**: the source is **kept** and moves to `detached_src_media` with its `.llc`, so it can be cut again later. The app does not delete it on its own; it goes for good only when you delete it in the deletion check (if a kept result of it is on disk) or in the file manager.
- The results it already has are handled on the way: permanently deleted (the default) or moved to `detached_clips` / `detached_merged`. Either way the next source opens; at the end of the list the cutting window returns to the landing page.
- Two settings keep it quiet: `Ask before moving a video to the waiting-for-deletion folder` and `When a discarded video already has cut results` (`Ask every time` / `Delete them permanently` / `Move them to the waiting-for-deletion folder`). Both can be switched back in the settings at any time.
- The dialog lists the results and gives both result folders a button, so a result can be checked before it is touched. Pressing `Ctrl+Delete` again confirms.
- A parked file can stay locked: if another player still has the video open, the moved copy cannot be opened or deleted until that player is closed, and on exFAT drives Windows reports this as *access denied* rather than *in use* (see [Troubleshooting](#troubleshooting)).

### The deletion check

- *File* → *Work folders and results…* (or `opl`) lists the work folders, newest first. Expanding one shows what each source became — cut and merged results, sources without results first, and counts of complete / cut-only / merged-only / empty groups. Only expanded folders are read, and sizes and durations arrive in the background.
- Each work folder offers *Check deletable source videos*, which opens the check in a window of its own. It shows `detached_src_media` as one scrolling grid of source-and-result groups: the same kind of video card for both (frame, name, state line, duration/size/modified time, play, full decode check, locate). The source is marked by a chip and a gray edge; the rule between the source and results columns can be dragged, the view switches between list, compact, standard and large cards, and one button restores the default layout.
- By default only a source whose kept result is still on disk (in `finished_clips` / `finished_merged`) can be deleted: parked results and results the scan only knows from the ledger do not count, and a card that cannot go says why on its state line. The window's settings button can allow the other kinds (no result, recorded results gone from disk, only parked results), all off by default. Such a source can still be played and checked.
- The delete removes the selected source videos for good and leaves every result in place. With nothing selected the button offers every source that is ready, and it asks first when it would take everything; a selection is confirmed by `Ask before permanently deleting a selected source video` (on by default). The confirmation lists the exact files as a thumbnail grid or a list, and names the selected sources that will stay.
- Both column headers run a full decode check, one file at a time: the first video stream and every audio stream, packet by packet, stopping at the first one FFmpeg cannot decode. Only the column that started the batch shows the counter and the percentage of the file being decoded now, a bar sums up the batch, and a finished result can be checked again from its own button.
- Click selects one card, `Ctrl`+click adds or removes one, `Shift`+click takes the range, double-click plays (in the check player or the system player as chosen in the window); select all/none work per column. The window follows the app's light/dark theme.

### Batch

- The source list holds only media files: project files, subtitles, notes and images are kept out of it and are not opened as videos. A file appears once even if added twice.
- Each row shows a number, the name and the duration, size and modification time; the list can be sorted by name, extension, size, modification time or duration, its width is remembered, and the eye button in the top bar (or `tbfl`) shows and hides it without losing the rows or order.
- `Shift+PgUp` / `Shift+PgDn` open the previous / next source and start playing; `Shift+↑` / `Shift+↓` only move the highlight, and `Ctrl+Shift+↑` / `Ctrl+Shift+↓` open without playing. A source that was merely opened starts paused.
- Right-click a source row to open its folder, the list header to clear the list (the files stay; only the queue is dropped), or any patch window to open the work folders and results.

### Command console and practice mode

- `Shift+Space` opens a command console with short built-in commands (see below), plus your own aliases for them.
- `tkp` turns on keyboard practice mode: keys explain what they will do before they do it, which is the quickest way to learn the re-mapped transport.

### Tools: time conversion

- `Tools → Time convert...` (or `opentimeconvert`) converts old script-style time pairs to a cut list / project file and back. Paste text like `000130 000132 intro` (with an optional video name on the first line), fix any line inline where it is tinted red with the reason, and load the pairs into the open video or save a `.llc`. The other tab takes a `.llc` and writes plain `HH:MM:SS.mmm HH:MM:SS.mmm [label]` lines that can be pasted back. The generated spacing and the optional name line are remembered.

### Safety

- The app does not delete a source on its own: a parked source goes for good only when you delete it in the deletion check, and by default only if a kept result of it is on disk; the check's settings can allow the other kinds. Everything not allowed there is left for you in the file manager.
- Deleting a result requires the choice in the finish dialog, and `Ask before permanently deleting files` is on by default.
- While an export is running, the finish job is refused with *Wait for the current export to finish* instead of moving files under it.
- Before a finish job touches files, the results windows are unloaded, so nothing is moved while a player still holds it.

## Command console

`Shift+Space`, then type one of these (`help` lists the commands, including the legacy short codes; the console also accepts base action names such as `opentimeconvert`):

| Command | Does |
| --- | --- |
| `tbfl` | show / hide the source file list (same as the eye button in the top bar) |
| `tws` | working directory settings |
| `opl` | list the work folders created so far, and open one |
| `cewd` | move empty work areas to the recycle bin (strictly whitelisted) |
| `tkp` | keyboard practice mode |
| `tccs` | command alias editor |
| `rsw` | reopen the cut-results and merged-result windows |
| `tcw` / `tmw` | toggle the cut-results / merged-result window |
| `zm` / `zc` | finish the job (merge / cut) |
| `exportforce` | cut every selected result again |
| `opentimeconvert` | open the time-conversion tool |

You can add your own short names for these commands in `tccs`; built-in names stay reserved.

## Settings worth knowing

- **Working directory** (`tws`): working directory, folder names, `Shift+→` lead-in seconds, auto-open the results window, single-window playback, reload after export, permanent-delete confirmations, the discard questions and the notice switches.
- **Discarding**: whether `Ctrl+Delete` asks before moving the video, and what it does with the results the video already has (`Ask every time` / `Delete them permanently` / `Move them to the waiting-for-deletion folder`).
- **Entry mode**: patch or base, see above.
- **Keyboard shortcuts**: every patch-mode key above is listed and reassignable; base keys are unchanged, patch keys can be switched off, and user keys can be scoped to one or both modes. Patch-only entries cannot be removed.
- **Naming rules**: one rule for cut results, one for merged results, with the available tokens, edited where you name the results.
- **Completion notices**: the "do not show again" choices for the finish summary and the permanent-delete confirmation can be reset here.
- **Playback**: `X`/`C` speed step (fixed 0.1 or upstream multiplier) and the remembered toggle speed. The time converter's field spacing and name line are set in its own dialog.

## Base mode

`Mode` → `Base mode` (or `Settings` → `Entry mode`) gives you the upstream interface unchanged: segments, export next to the source, the upstream shortcuts and menus, and the upstream default key table. Patch mode does not change base-mode behaviour, so a file or project opened in base mode behaves exactly as with official LosslessCut.

## Build from source

Windows, Node 22+, Yarn 4 via corepack:

```bash
corepack enable
yarn install
yarn dev
```

- `yarn build` builds into `out/`; packaging is `yarn electron-builder --win 7z zip --x64` (produces `dist/LosslessCut-Patch-<version>-win-x64.7z` / `.zip`).
- `yarn tsc`, `yarn lint`, `yarn test run` and `yarn ci` (a local replica of the CI pipeline) are the checks.
- In dev, FFmpeg comes from `PATH`; a packaged build uses the bundled `ffmpeg/` (`yarn download-ffmpeg-win32-x64`).
- Only the Windows x64 target is built, tested and supported by this fork. macOS/Linux packaging is inherited upstream code and is not shipped here.

## Releases and versioning

- Releases are tagged `v<version>` from the `squash-release` branch; CI builds both portable archives and publishes them with `SHA256SUMS.txt`.
- Release notes come from `versions/<version>.md`.
- The in-app update check reads this fork's GitHub releases, not the official app's, and can apply the update in place (see [Download](#download)).

## Troubleshooting

- **SmartScreen / antivirus warning**: the build is unsigned. Check the SHA-256 against `SHA256SUMS.txt` if you want to be sure the download is intact.
- **"Where are my settings?"**: `%APPDATA%\LosslessCut-Patch` (`patch-config.json`, `config.json`, `app.log`). The official app's folder is separate.
- **"Why can't I cut this video?"**: it is inside `.losslesscut_work` or `losslesscut_finished`. Both folders are read-only for cutting by design; move the video out first. The badge at the top says `In the work directory` or `In the finished folder`.
- **Keys do nothing / a key means something else**: patch-mode keys act on the focused window, and a patch-only key reports that it has no action in base mode. Check the shortcut list (`Shift+/`) for the real binding and scope; the menu bar is hidden until `Alt+Q`.
- **"The merged file plays fast right after a seek"**: that is the lossless join gap. Re-cut with join repair A or B (see [Merging](#merging)); with PotPlayer, turning off automatic A/V sync hides the symptom but does not fix it.
- **"This file is being played in another window" / "Another window is using this work folder"**: a results window is playing that clip, or another instance is running a job in the same work area. Stop it there first, then retry.
- **A parked file in `detached_src_media` says "does not exist or is locked" and cannot be deleted**: another player (PotPlayer, for example) may still have the video open from before it was moved. Windows keeps that handle alive through the rename, so every other program — including the file manager's `Shift+Delete` — is refused until the player is closed. On exFAT drives (most portable SSDs) this is reported as *access denied* instead of *file in use*, so the file looks damaged and the delete fails without deleting anything; the file itself is fine. Close the player and delete it again; if it stays, reboot or safely re-plug the drive.
- **"Where did my files go after `Shift+E`?"**: see [Where the files go](#where-the-files-go). A finish job moves or keeps files according to the dialog; nothing is deleted without its choices.
- **"I put `a.llc` next to `a.mp4` and now there are two project files"**: a cut list named after the video itself is read as well, but this build still saves to `a-proj.llc`. The copy is written when the cut list changes, an export runs or the job is finished, not merely by opening the video, and the next open prefers `a-proj.llc`. Delete the `.llc` once you have checked it, or turn the project-file auto-save off. When both exist, `-proj.llc` wins.
- **"The base mode landing page's cut-point sentence is still in English"**: upstream's own markup and stored translation key do not match, so that one line falls back to English in every translation. Patch mode's landing page is not affected.

## Upstream, license and credits

- This fork is based on [mifi/lossless-cut](https://github.com/mifi/lossless-cut), GPL-2.0-only, by Mikael Finstad. The same license applies here; see [LICENSE](LICENSE).
- The upstream documentation ([losslesscut.app/docs](https://losslesscut.app/docs)) still describes the editor itself: streams, metadata, chapters, snapshots, the CLI and the HTTP API. Only the workflow described above is fork-specific.
- The fork is synced from upstream on purpose, one merge at a time, and does not push back to `mifi/lossless-cut`. Base mode is kept byte-for-byte upstream behaviour, so upstream fixes keep working.
- The original upstream README is preserved in [README.upstream.md](README.upstream.md) for attribution and reference.
- App icon by Dimi Kazak (CC 3.0 BY), Lottie animation by Chris Gannon — see upstream's attributions in [README.upstream.md](README.upstream.md).

Issues with this fork belong in [this repository](https://github.com/tifiyitifi/lossless-cut-patch-public/issues), not upstream.
