# Features ✨

LosslessCut cuts, merges and edits video and audio files without re-encoding them, so it's fast and keeps the original quality.

Here's everything it can do, and what people use it for. Which functions are available depends on the file and its format and codecs. See also the [Recipe cookbook](recipes.md) for step-by-step instructions.

## Cutting

- Lossless cutting of most video and audio formats
- Cut away parts of a file (for example commercials), or keep only the parts you want
- Export each segment as its own file, merge them into one file, or both
- Rearrange the order of the segments
- Type in cut point times
- Timeline with zoom and frame/keyframe jumping, for cutting around keyframes
- Video thumbnails and audio waveform on the timeline
- Play or loop the current segment, or all selected segments in order
- [Smart cut](https://github.com/mifi/lossless-cut/issues/126) (experimental), to allow cutting between keyframes. It doesn't work for all files.
- Choose between keyframe cut and normal cut, and fine-tune other export options
- Extremely fast removal of all non-keyframes, "Decimate video" (for example for a timelapse)
- Speed up or slow down a video or audio file ([by changing the FPS](https://github.com/mifi/lossless-cut/issues/1712)). Do this as a separate step, not while cutting.
- Lossless crop and aspect ratio change of H.264/H.265 video (not all players respect it)
- In patch mode, discard a source you do not want to cut (`Ctrl+Delete`): the video is moved (not deleted) to the work area's waiting-for-deletion folder and its cut/merged results are deleted or moved aside
- In patch mode, read the workflow's known limitations without leaving the app: `Help` → `Known issues` lists the same notes as the landing page (where they are only reachable with no file open), with the keys of the current window
- In patch mode, finish a source with one key and keep it: `Shift+F` opens the finish dialog on its own workflow — the video is skipped (not cut), so the title says so instead of "cut only". It offers `finished_skip_src` and keeps its own remembered choices, apart from `Shift+E`, which does not offer that destination and does not let a skip job decide where its video goes. `Shift+F` also confirms the job's own summary and delete confirmation, while the arrow keys and Enter still choose a button
- In patch mode, `Shift+E` ends the job the way the window shows it: the cut-results window ends with the clips (a merged result it already has moves to `finished_merged` by default, and can be permanently deleted or kept where it is instead), the merged-result window ends with the merge, and the source window ends with the clips as well even when the source already has a merged result — `zm` ends with the merge there, `zc` with the clips
- In patch mode, see where the files really end up: the finish dialog lists the final path of the merged result and of every kept cut result before anything moves, and its completion summary lists the paths the job left behind (merged result first; in the skip workflow the source video first). A path is selectable text and a click copies it; in the skip workflow the summary's own button copies them all, and its second button opens the file manager with the source already selected (or its folder when the file is gone). A silenced summary stays silent and only reports how many files moved
- In patch mode, the finish dialog names the cut results as they move (`{token}` rule, on by default; `{source}-clip-{seg_num}`), so a source cut into a single result ends with a readable file name instead of the working title. The names are shown before anything moves, the dialog shows why a rule cannot be used (it then blocks the job until the rule is fixed or the rename is turned off), and a rule that gives several results the same name gets the position and the time appended instead of overwriting. A name that is already taken in the target folder gets a number in brackets. Renaming is part of the cut-only finish; a merge or a discard moves the intermediate clips aside under the names the export gave them. While the finish dialog is open the export keys wait, so the list it shows cannot gain results behind it.
- In patch mode, the merge dialog says what its "replace a file with the same name" choice is about: a previous merged result of the same video is replaced even with it unchecked, the box covers other files with the same name, and a short explanation next to it states both, with the numbering and the per-merge scope under "When a name is already taken"
- In patch mode, finish a video in several passes: `Leave them in the work area` (the `Keep working on the same video, reusing its cut list` preset chooses it for a merge) ends the job while the cut results stay in `clips/` and stay tracked. The merged result still leaves, so a later pass can cut other segments. The finish step handles this export's results and the results of earlier passes separately: only this export's clips move to finish, and a stale result is never taken for the merge's input. While the video is still being worked on (the loop preset, or any choice that stays on the video) the earlier results stay in `clips/`, so the next pass reuses them instead of cutting them again; when the job ends the video and moves on, the earlier results are permanently deleted by default (the `Cut results` section's checkbox keeps them instead). The section (`Cut clips`) states each group next to its action — `This export: N cut results → move to finished_clips`, `Earlier passes: M temporary clips → permanently deleted` (or `→ stay in the work area`) — and the checkbox names the number of temporary clips it deletes, so the count that moves and the count that is deleted cannot be confused. A clip is called a cut result only when the job moves it out of the work area; one that stays, is deleted or is a merge's input is a cut clip. The total says it counts the work area only, and a line under it lists the results of this source that an earlier finish already moved to `finished_clips` (hovering it lists the files), leaving out the segments this export cuts again: that is why the work-area count can be smaller than the number of segments in the project file. The last pass moves this export's results out together with the source, and only then is the record forgotten.
- In patch mode, review a whole batch in one dialog: it lists the work folders the app has created, newest first, and expanding one shows what each source became — its cut and merged results, the sources without results first, and how many are complete, cut-only, merged-only or empty. Every group of a work folder (no results, partial, complete, source gone, unclaimed results) folds on its own, and a folded group keeps its count in the title. Only the folders you expand are read; each file row also shows its size and duration, read in the background as the folder opens, so a result can be judged without opening it. The buttons open the stage folders of that work folder, including the two finished source folders: `finished_src_media` (kept after processing) and `finished_skip_src` (skipped with Shift+F). Open it from the File menu, from a right-click anywhere in a patch window (the landing page, the video, the timeline, a segment row, a source file row, the source list, or a results window), or from the command console (`opl`). The short hint at the bottom is a folded guide: open it for the reading rules, the group and row meanings, every key, the filter and the lock behavior.
- In patch mode, hide the work-folder history behind a privacy lock: while it is locked, the dialog still shows the work folder and results of the video you have open, and every other folder is replaced by one locked line. The lock button at the top right unlocks it with the password; the gear opens the settings, where you can change the password, choose when it locks (manually, at every app start, or after the computer has been idle for a number of minutes), and read the recent password events. The default password is `123456`; deleting the password file restores that default and keeps the history locked, and the reset is recorded. The event log also records every successful unlock, so a reset or a look while the computer was lent out leaves a trace. This is not a security feature: the password is a salted hash, but the history file and the videos are not encrypted, and someone who knows the password can unlock without a reset.
- In patch mode, check which waiting-for-deletion sources may really be deleted: each work folder in that dialog offers "Check deletable source videos", a window of its own that shows `detached_src_media` as one scrolling grid. Sources and their results are the same kind of video card — a 16:9 frame, the name, a state line, duration/size/modification time and play, decode-check and locate buttons — with the source marked by a "Source video" chip and a gray bar on its left edge (gray, not blue: blue is the selected card's outline). Every row is split into equal group panels (2 by default, so the second group starts exactly at half the page), numbered straight through the list (1, 2, then 3, 4), each panel framed and titled with the source name, how many cut results, temporary clips and merged results it has, and its missing count (hovering the missing count lists the full paths of the files that are gone; hovering the counts explains which folder each kind lives in), and the gap between two panels is much wider than the gap between a source and its results. Inside a panel the source column and the results column are set well apart - a gutter three times the gap between two result cards, with a two-pixel rule down its middle - and that rule can be dragged: the column follows the pointer freely, does not get narrower than one card, and leaves at least one result card; the source card keeps its size and the results reflow into as many columns as fit, so nothing is compressed. The group count is a saved maximum: a narrow window shows fewer groups than requested - with a notice saying how many are shown instead - and a wider one shows the saved layout again. The action bar above the groups is one left-aligned row, its source actions, result actions and hints separated by vertical rules, with each column's select all/none and full decode check next to its label. Kept results come first, then parked ones, then dashed strips for the recorded results that are gone. A source that a finish job moved inside the work area keeps the results of every pass: the finished-job ledger recognises the file again by its exact size and a hash of its head and tail, so the previous pass's results are not stranded under the old path (entries written before the fingerprint existed fall back to a unique file name). A click selects one card, Ctrl+click adds or removes, Shift+click takes the visual range, and select all/none work per column; a source without a kept result can still be played and checked, by default only a source with a kept cut or merged result on disk counts toward the permanent delete (the window's settings button can allow the other kinds, all off by default), whose confirmation lists exactly the files it will remove as a scrollable thumbnail grid or list (the choice is remembered) and names the selected sources that will stay; with nothing selected the delete button offers every source that is ready for deletion and asks for confirmation, even when the permanent-delete confirmation is switched off. Both headers run a full decode check over their column (selected cards first; with nothing selected a dialog asks whether to check all sources, all results or both), one file at a time: only the column whose button started the batch shows the counter, which moves as each file ends and adds the percentage of the file being decoded now, while the other column waits for it to finish; a thin bar then sums up the last batch (passed, failed, stopped, could not run) until it is dismissed. The tooltip of that button says what a check covers and what it leaves out — the first video stream and every audio stream, packet by packet, stopping at the first one FFmpeg cannot decode, with subtitles, attachments and extra video tracks skipped, and no promise that a particular player opens a file that passes — and every finished result (passed, failed, stopped early, could not start) is a button itself that runs the check again in place of the old result. The view switches between list, compact, standard and large cards, and one button restores the default view, group count and source columns. Double-clicking any file plays it — in the check player, which receives the whole check set grouped by source, jumps to the clicked file and marks every row with a yellow badge naming its folder, or in whatever program the system associates with it, as chosen in the window's own list. The work folder is read asynchronously - one scan shared by every window that asks, and a refresh that skips the short reuse window - so a work root on a network share is slower to fill in without freezing the app, and the window says when the folder is on a network share. The window follows the app's light/dark theme. A settings button at the far right opens the deletion settings: each kind of source the app cannot prove finished (no result at all, recorded results gone from disk, only parked results) can be allowed for permanent deletion - all off by default - with a fold explaining what each kind is and why it exists, and another switch decides whether a no-selection "Delete all" covers them; the same dialog restates why this window only offers permanent deletion (moving a file into another folder, or deleting it to the recycle bin, does not free disk space)
- In patch mode, clear the source file list from its right-click menu (a row, the list header or the panel around the rows): the rows are removed while the open video and its results stay, and the confirmation can be switched off and back on in the settings
- In patch mode, Shift+click the cut queue's rows to select several at once (the block between two clicks toggles, the same row again takes it back out) and act on exactly those rows from the bar under the list: delete them, mark them as exported or not exported, or keep only them (only rows with an end time can be exported, so markers alone keep nothing). This selection is separate from the export selection (the circle on the row), so nothing about the export changes until a button is pressed; Escape or a plain click leaves it
- In patch mode, the merge joins the cut results in the cut queue order, not the timeline order: reordering the queue and exporting again records the new order (nothing is cut a second time), and a segment taken out of the queue is left out of the next merge
- In patch mode, an export locks the cut list but not the player: the progress box can be dragged anywhere, and playing, pausing, seeking, stepping frames, changing the playback speed, entering a timecode and clicking the timeline keep working while it runs. Clicking the box dims the window again, clicking anywhere else fades that dim. The cut controls stay visibly off and inert (cut points, time inputs, invert, rotation, cleanup, and every edit in the queue and its context menu), and the keyboard keys that would change the cut list only report "wait for the export"
- In patch mode, the cut result and merged result windows do not ask "This file has embedded chapters…": a result carries its source's chapter table with the source's own times, and neither window can cut. The cutting window keeps asking for a source it can still cut, but not for a result it can only view

Lossless cuts can only start at a keyframe, so a cut starts at the keyframe before your cut point, a fraction of a second up to several seconds earlier depending on the encoding. See [Troubleshooting](troubleshooting.md) for more.

## Segments

- Segments, and markers (segments without an end)
- Divide the timeline into segments of a length, a file size (X MB) or a number of segments, or randomized segments
- Detect black scenes, silent audio and scene changes, and create segments from them
- Create segments from keyframes, and from the file's chapters
- Invert, split, duplicate, shift, shuffle and combine segments, fill the gaps between them, and align them to keyframes
- Give segments labels and tags
- Select and change segments with a JavaScript-based [expression language](expressions.md)
- [Import](index.md#importexport-projects) segments from MP4/MKV chapters, CSV, EDL (MPlayer, CMX 3600), YouTube chapters, Cutlist, CUE, DaVinci Resolve/Final Cut Pro XML, FCPXML, PotPlayer bookmarks, SRT subtitles, OpenTimelineIO and DV Analyzer
- Export segments as CSV, TSV/TXT, SRT subtitles or YouTube chapter timestamps
- In patch mode, `Tools → Time convert...` turns hand-written cut points (`000130 000132`, `000250 001023 name`, optional video name on the first line, quoted or bare as "Copy as path" writes it, blank lines and any spacing between the fields) into the cut list of the open video or into a project file, and turns a project file back into plain time pairs that anyone can read and paste back. A line that cannot be read is tinted in the editor with the reason written next to it (and `012366` says that 66 is not a valid second instead of silently becoming a minute), the generated spacing and the optional file-name first line are remembered, a name in the text that differs from the local copy only by `[...]` tags or the extension still finds that video (unless several videos match), and a project file can be picked straight from the folders the app saves them in (next to the video, `finish_llc`, the app data or installation `llc` folder)
- Turn segments into chapters in an otherwise unmodified file ("Segments to chapters" export mode)
- Segments are saved per file in a project file (`.llc`); a cut list named after the video itself (`a.mp4` → `a.llc`) is loaded too, but saving still writes `a-proj.llc`
- Undo/redo of segment changes

## Merging

- Lossless merge/concatenation of files with identical codec parameters (for example from the same camera)
- Checks that the files are compatible before merging
- Optionally create chapters from the merged files

## Tracks

- Combine tracks from multiple files (for example add a music or subtitle track to a video)
- Remove tracks you don't need
- Shift the tracks of an added file in time, for example to sync audio from another recording
- Extract all tracks from a file into separate files: video, audio, subtitles, attachments and others
- Keep data tracks, like GoPro telemetry (GPMF)
- Choose the video and audio tracks for playback, and play several audio tracks at once
- View subtitles

## Metadata

- View technical data about all tracks
- Edit the file's metadata, and each track's metadata and disposition
  - Suggestions for common metadata keys and languages
  - Copy metadata from another track or file, or apply a value to all tracks of the same type
  - See which tracks have changed, and reset the changes
- Change the rotation/orientation metadata of videos
- Set the codec tag, for example `hvc1` so H.265 plays on Apple devices, and apply bitstream filters
- Set the cover art from a frame on the timeline
- Apply a per-file timecode offset (and load the timecode from the file)
- Set the output files' modification date, for example to the original's
- Show the embedded GPS track (for example from DJI drones) on a map

## Formats and export

- Opens almost any format FFmpeg can read. Files that the built-in player can't play are played through FFmpeg automatically, while the export is still lossless from the original file.
- Losslessly remux video/audio into a different container (file) format
- Fix an incorrect file duration
- Output file names from a customizable template
- Take full-resolution snapshots from videos as JPEG/PNG (low or high quality), or copy them to the clipboard
- Export ranges of video frames to images: every frame, every nth frame or second, at scene changes, or the best image every nth second
  - Only from a selected time range (segment)
  - Optionally with the original timestamps in the image file names
- Losslessly download videos over HTTP (for example HLS `.m3u8`), saved as MKV

## Workflow

- Open many files as a batch list, and go through them one at a time (there's no batch export, but see [Batch processing](batch.md))
- In patch mode, every source file row shows a number badge, the file name, and its duration, size and modification time, and the list says which of those it is ordered by. Drag the list's right edge to make it wider (the width is remembered). Sort by name, extension, file size, modification time or duration, ascending or descending (the sort menu sits next to the list title; clicking the active key flips the direction, and "manual order" returns to the order you dragged the rows into). Durations are read from the container header without starting FFmpeg, and everything that was read once is kept for the session, so a second sort is instant. The eye button with the list's name at the left of the top bar (or `tbfl` in the command console) shows and hides the list without losing its width, order or rows, and with no files yet the panel stays visible and says how to add them
- In patch mode, walk the batch without a second key: `Shift+PageUp` / `Shift+PageDown` open the previous / next source and start playing it (`Shift+Up` / `Shift+Down` only move the highlight, `Ctrl+Shift+Up` / `Ctrl+Shift+Down` open it paused)
- Convert a whole batch of files to a supported format
- Keyboard shortcut workflow, with customizable shortcuts: base mode keeps the official LosslessCut keys and nothing more, patch mode adds its own layout on top (patch wins where both claim a key, and every other key works in both modes). Default keys are not deleted, only switched off, and a key you add carries a scope (yours, base or patch) that decides whether it may collide with a default. A key bound to a patch-only action says so in base mode instead of doing nothing. The shortcut list opens with a table of every key patch mode runs differently, then a table of what your own settings changed. In patch mode the speed keys are PotPlayer-style: `X`/`Z`/`C` slow down, toggle between 1x and the last speed you chose, and speed up (the chosen speed is remembered; `X`/`C` step by a fixed 0.1 by default, or by the base multiplier when the settings ask for it), and `D`/`F` step one frame back and forward (a step while playing pauses only for the seek and resumes playback right after it lands). Patch mode also keeps the app menu bar hidden so a bare Alt cannot take the focus away from the cutting keys; `Alt+Q`, or the same entry in the right-click menu of the video and the start screen, shows or hides it. The preview volume is `M` (mute), `-` (down) and `=` (up), while `Alt+Up` / `Alt+Down` mark the in/out point (as do `I`/`O` and `Up`/`Down`). A bare mouse wheel over the video also steps the volume (up louder, down quieter); Ctrl, Alt and Shift with the wheel keep their zoom / frame-seek / keyframe-seek behavior. The volume slider opens while the volume changes (from the keys or the wheel) and hides again a few seconds after the last change.
- See the FFmpeg commands that were run, so you can change and re-run them on the command line
- Basic [CLI](cli.md) and [HTTP API](api.md)
- Simple and advanced mode, dark and light themes, and 35 languages

## Example use cases

Everything here is lossless unless noted.

- Cut out commercials from a recorded TV show (and change it from TS to MP4)
- Join clips from the same camera or phone into one file
- Rough-cut long recordings, keeping only the good parts, to save disk space
- Remove an audio track from a file
- Extract the music track from a video and cut it to your needs
- Add music to a video, or replace its audio track
- Combine audio and video tracks from separate recordings, and shift the audio to sync it
- Add an external subtitle file to a video
- Copy track titles and languages from one file to another when combining tracks
- Change the language of a file's audio or subtitle tracks
- Change an H264/H265 MKV video to MOV or MP4, for example for playback on an iPhone (set the `hvc1` codec tag for H.265)
- Cut a file by its MP4/MKV chapters
- Add chapters to a video, or remove them
- Make chapter timestamps for a YouTube video description
- Cut a YouTube video (downloaded with [yt-dlp](https://github.com/yt-dlp/yt-dlp)) by its chapters, or by a list of times from a comment
- Import a list of cut times from another tool as an EDL (edit decision list, CSV) and make those cuts, or export your cut times as a CSV EDL for another tool
- Save an HLS (`.m3u8`) live stream or video to a file
- Attach cover art or a thumbnail to a video or audio file, from a JPEG file or a frame on the timeline
- Change the author, title, GPS position or recording time of a video
- Fix the rotation of a video that has the wrong orientation flag
- Crop away black bars (H.264/H.265)
- Make a timelapse by keeping only the keyframes
- Fix a file that shows the wrong duration
- Loop a video or audio clip X times without re-encoding (see [#284](https://github.com/mifi/lossless-cut/issues/284))
- Split a video into one file per scene (you'll probably have to shift the segments, see [#330](https://github.com/mifi/lossless-cut/issues/330))
- Cut away the silent parts of an audio or video file
- Split a video into parts of a maximum length, for example for a social media platform's limit
- Tag segments, then use the tags to organize them, or to create an output folder structure for them
- Mark moments with markers and take a screenshot of each (not lossless)
- Convert a video, or parts of it, into image files (not lossless)

## Updates

- Checks this fork's own [GitHub releases](https://github.com/tifiyitifi/lossless-cut-patch-public/releases) for a newer version
- Shows the result (including why GitHub could not be reached) when you choose *Help → Check for updates from GitHub...*
- Downloads and installs a new release in place: the package is verified against the `SHA256SUMS.txt` the release publishes, unpacked next to the running app and swapped in, then the app restarts
- Keeps `llc` and `config.json` from the installation folder across the swap, and rolls back to the previous build when the swap cannot finish
- Reports at the next start what became of the last update, and keeps the downloaded package when it did not land so it can be installed by hand
- Falls back to the GitHub release page whenever the update cannot be applied automatically (read-only folder, no checksum published, too little free space)
