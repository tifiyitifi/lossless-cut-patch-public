import type { NamingPresetId } from './naming.js';
import { defaultLabelSeparator, defaultMergedNameRule } from './mergedName.js';
import { defaultCutLabelSeparator, defaultCutNameRule } from './cutName.js';
import type { PatchKeyBinding } from './keymap.js';
import type { MergeBoundaryGuard, MergeBoundaryPolicy } from '../patchExportPolicy/policy.js';
import type { PatchHistoryLockEvent, PatchHistoryLockMode } from '../patchPrivacyLock/index.js';
import { patchHistoryLockDefaultIdleMinutes } from '../patchPrivacyLock/index.js';
import { patchDetachDeleteDialogViewDefault } from '../patchDeletable/deleteDialogView.js';
import type { PatchDetachDeleteDialogView } from '../patchDeletable/deleteDialogView.js';
import {
  patchDetachGridDefaultView,
  patchDetachGroupsPerRowDefault,
} from '../patchDeletable/grid.js';
import type { PatchDetachGridView } from '../patchDeletable/grid.js';
import type { PatchDetachExtraDeletableReason } from '../patchDeletable/deletable.js';
import type { PatchPlaybackRateStepMode } from '../patchTransport/playbackRate.js';
import { defaultTimePairGap } from '../patchTimeConvert/formatTimePairs.js';
import { defaultPatchFinishedDirName, defaultPatchWorkDirName } from '../patchWork/workDirs.js';
import { defaultSourceListWidth } from './sourceList.js';

/** How the `V` view-switch key behaves. */
export type PatchViewSwitchStyle = 'candidates' | 'cycle';

/** What to do with the source file once a file has been processed. */
export type PatchSourcePostAction = 'keep' | 'move' | 'trash' | 'skip';

/** What `Ctrl+Delete` does with the results a discarded video already has (fork-owned). */
export type PatchDiscardResultsAction = 'ask' | 'delete' | 'detached';

/**
Version of the default dockview layout. Bump it whenever `buildDefaultLayout` changes so that a
layout saved by an older version is discarded instead of being restored.
*/
export const patchLayoutVersion = 7;

/**
Patch-mode settings. Stored in a dedicated `patch-config.json` (separate from the upstream
`config.json`) so that base and patch modes keep independent settings.
*/
export interface PatchSettings {
  /** Work / output directory for patch mode. `undefined` means "same directory as input file". */
  workDir?: string | undefined;
  /**
  The working directory the user picked. The app keeps a work area of its own inside it
  (`<workRoot>/.losslesscut_work`, see `features/patchWork`), and writes the cut results there.
  `undefined` means "no working directory": the output goes next to the source file, like base.
  */
  workRoot?: string | undefined;
  /**
  The folder name the app keeps its work area under, inside the working directory (fork-owned).

  A folder *name*, not a path: the app rejects separators and the characters Windows refuses. A
  rename does not move an existing folder - only the configured name is created/used, while the
  default `.losslesscut_work` keeps being recognized as a work area (see
  `features/patchWork/dirNames`).
  */
  workDirName: string;
  /**
  The folder name a finish job moves everything the user keeps into (fork-owned).

  A sibling of the work area, with the same name rules as `workDirName`. Defaults to
  `losslesscut_finished`, and that default keeps being recognized after a rename.
  */
  finishedDirName: string;
  /** Output naming preset. Defaults to the losslesscut convention. */
  namingPreset: NamingPresetId;
  /**
  The rule that names the merged result (fork-owned, `{token}` syntax - see `mergedName.ts`).

  Kept in the patch store instead of the upstream `cutMergedFileTemplate`: the syntax is not the
  upstream `${}` template, so base mode must not see it.
  */
  mergedNameRule: string;
  /** The separator `{labels}` joins the clip labels with. */
  labelSeparator: string;
  /**
  The rule that names the cut results (fork-owned, `{token}` syntax - see `cutName.ts`).

  Its own rule, not the merged result's: a cut result and the merge of those cuts are two files,
  and naming them the same way is what makes them collide in the work area. Stored here for the
  same reason as `mergedNameRule`: base mode must not see the `{token}` syntax.
  */
  cutNameRule: string;
  /** The separator the cut rule's `{labels}` joins the clip labels with. */
  cutLabelSeparator: string;
  /** Behaviour of the view switch key. */
  viewSwitchStyle: PatchViewSwitchStyle;
  /** Serialized dockview layout (opaque to us). */
  layout?: unknown;
  /** `patchLayoutVersion` at the time `layout` was saved. */
  layoutVersion: number;
  /**
  Width of the source file list, in pixels (fork-owned).

  The list is the panel the user drags rows in and reads durations from, so its width is theirs to
  set and is remembered across restarts. Read through `clampSourceListWidth`, never as-is: the
  stored file is editable by hand (see `features/patchData/sourceList`).
  */
  sourceListWidth: number;
  /** Key bindings that override the patch defaults (per action). */
  patchKeyBindings?: PatchKeyBinding[] | undefined;
  /** What to do with the source file after finishing it (merge / post-processing). */
  sourcePostAction: PatchSourcePostAction;
  /** When cutting, merge the produced clips into one file too (`E` = cut + merge). */
  autoMerge: boolean;
  /**
  How a cut is handled when the clips will be merged (`E` key, see `features/patchExportPolicy`).

  A merged lossless cut leaves the video timeline broken at every join (a freeze, and a burst of
  fast playback after a seek). `losslessGuard` (A) and `exactTail` (B) repair it by re-encoding
  the first and last GOP of every clip; A keeps a few extra frames past every cut end. `compat`
  (C) keeps the old `-c copy` command line (fast, joins stutter).
  */
  mergeBoundaryPolicy: MergeBoundaryPolicy;
  /** How `losslessGuard` sizes the extra tail: from the B-frame count, or always 0.1 s. */
  mergeBoundaryGuard: MergeBoundaryGuard;
  /**
  Extend the last cut result to the source video's real last frame (fork-owned).

  A lossless cut is exclusive at its end, so the last result can miss the frame the user stopped
  on; and the player's duration can be shorter than the source (AV1 in Chromium). The last result
  has no clip after it, so it can keep the frame at its end (a mid-source cut) or the rest of the
  source without overlapping another clip. The rest of the source is only kept when the cut end is
  the player's end as well: a timeline-last segment that stops earlier is a deliberate cut and
  keeps its point.
  */
  tailToSourceEnd: boolean;
  /** Open a player window with the cut results right after an export. */
  autoOpenPlayer: boolean;
  /**
  Pause the other results window when one of them starts playing.

  The cutting window and the results windows always pause each other. This setting additionally
  makes the two results windows (cut results / merged result) exclusive; turning it off lets them
  play at the same time, because reviewing a clip next to the merged result is sometimes useful.
  */
  singleWindowPlayback: boolean;
  /**
  Reload a results window that never finished loading (a blank window), once.

  The window is a second renderer with its own module load; when that fails there is nothing to
  show and no dialog inside it. The retry is automatic unless the user turns it off; the failure
  message is shown either way (see `features/patchPlayer/windowLoad`).
  */
  reloadResultsWindow: boolean;
  /**
  The notices the user has silenced for good (see `features/patchNotice`).
  Only the noise can be silenced: a notice that carries a warning is never silenced.
  */
  suppressedNotices?: string[] | undefined;
  /**
  Ask before a finish job deletes files permanently (fork-owned).

  The confirmation is on by default: a permanent delete cannot be undone. Its "do not show this
  again" box starts *unchecked*, so silencing it takes a deliberate tick, and this setting is how
  the confirmation is switched back on.
  */
  confirmFinishPermanentDelete: boolean;
  /**
  Ask before the detached-source check deletes a source for good (fork-owned).

  On by default: the check panel only offers sources whose kept results are already on disk, but the
  delete itself cannot be undone. It is separate from `confirmFinishPermanentDelete`: one guards a
  finish job, the other a check run of its own.
  */
  confirmDetachedSrcPermanentDelete: boolean;
  /**
  The density of the deletion check grid (fork-owned).

  `standard` unless the user picks list / compact / large in the window's toolbar. A card of the
  compact/large presets is only wider; the list preset lays every card out horizontally.
  */
  detachGridView: PatchDetachGridView;
  /**
  How many source groups one row of the deletion check shows (fork-owned).

  `2` (the page split in half, so a group and its results always start at a predictable place)
  unless the user picks another count. A narrow window shows fewer groups, but this saved maximum is
  not changed by that.
  */
  detachGroupsPerRow: number;
  /**
  The width of each group's source column, in pixels (fork-owned).

  One entry per group position; `0` means the default (one card). Dragging the boundary between a
  group's source and results changes the entry of that group; a width that no longer fits is clamped
  when the layout is computed, so the stored value comes back when the window grows again.
  */
  detachSourceColumnWidths: number[];
  /**
  How the permanent-delete confirmation shows the files it will remove (fork-owned).

  `grid` (small thumbnails) unless the user picks the list in the dialog's own dropdown; the choice
  is remembered for the next confirmation.
  */
  detachDeleteDialogView: PatchDetachDeleteDialogView;
  /**
  The extra kinds of detached sources the deletion check may delete (fork-owned).

  Empty by default: a source is deletable only when the app kept a result of it on disk. A reason the
  user ticks in the panel's deletion settings widens that to sources the app cannot prove finished.
  Read through `parsePatchDetachExtraDeletableReasons`, never as-is.
  */
  detachExtraDeletableReasons: PatchDetachExtraDeletableReason[];
  /**
  Does "Delete all" (nothing selected) also cover the extra kinds above? (fork-owned)

  Off by default: with nothing selected the button removes only sources with a kept result, and the
  extra kinds have to be selected by hand. Turning it on makes one click cover them as well. A
  selection is unaffected: whatever the user selects is deleted, extra kinds included.
  */
  detachDeleteAllIncludesExtra: boolean;
  /**
  Ask before `Ctrl+Delete` moves the source video to the waiting-for-deletion folder (fork-owned).

  On by default. The dialog's "do not ask again" box switches it off, and this setting switches it
  back on. It is separate from `discardResultsAction`: one confirms the move, the other remembers
  what to do with results the discarded video already has.
  */
  confirmDiscardSource: boolean;
  /**
  Ask before the source file list is cleared (fork-owned).

  On by default. The confirmation's "do not ask again" box switches it off, and this setting
  switches it back on. Clearing drops the queue, not the files: the open video and its results stay
  as they are.
  */
  confirmClearFileList: boolean;
  /**
  What `Ctrl+Delete` does with the cut/merged results a discarded video already has.

  `ask` shows the radio buttons; `delete` and `detached` remember the choice and skip the radio.
  Both are reversible in the settings.
  */
  discardResultsAction: PatchDiscardResultsAction;
  /**
  How far before the end of the current segment `Shift+Right` stops, in seconds. Pressing it
  again from inside that stretch goes to the end. Shared by the source and the player window.
  */
  segmentLeadInSeconds: number;
  /**
  Is the cut queue's guide (the "How the cut queue works" notes above the segment buttons) open?
  It starts open, and the user closes it by hand; the choice is remembered.
  */
  segmentQueueHelpOpen: boolean;
  /**
  Is the format help in the `g` (seek to timecode) dialog open? It starts open, and the user
  closes it by hand; the choice is remembered (see `features/timecodeInput` in the renderer).
  */
  timecodeHelpOpen: boolean;
  /**
  Are plain numbers read as compact time in the patch-mode `g` dialog? On (the default) a plain
  number is a compact time and `..` asks for the active timecode format; off, the two are
  swapped back.
  */
  timecodeCompactSwapped: boolean;
  /**
  How many spaces separate the fields of the text `Tools -> Time convert...` generates (fork-owned).

  Two by default, so the start, the end and the label read as three columns. Clamped to
  `minTimePairGap`..`maxTimePairGap` on read (see `features/patchTimeConvert`).
  */
  timeConvertGap: number;
  /** Does the generated time text start with the video's file name and a blank line? */
  timeConvertNameLine: boolean;
  /** The folder the last project file was opened from / saved to (fork-owned). */
  timeConvertLastLlcDir?: string | undefined;
  /** File that was open when patch mode was last used (restored on start). */
  lastFilePath?: string | undefined;
  /**
  How the patch speed keys (`X` / `C`) change the playback rate (fork-owned).

  `base` keeps the upstream multiplier (three presses double the rate); `fixed` adds or subtracts
  0.1 per press (PotPlayer style). `Z`'s 1x / last-speed toggle is not affected.
  */
  playbackRateStep: PatchPlaybackRateStepMode;
  /**
  The last non-1x playback speed the user chose (fork-owned).

  Patch mode's `Z` key toggles between 1x and this rate. It survives a restart and is
  not cleared when a file is closed. Stored here (not in the upstream config) because
  it is patch behaviour.
  */
  rememberedPlaybackRate: number;
  /**
  The last choices of the finish dialog (`Shift+E`), per mode.

  Stored as plain JSON: the renderer validates it on read (`parsePatchFinishMergeOptions`), so an
  older or hand-edited value falls back to the defaults instead of breaking the dialog.
  */
  finishMergeOptions?: unknown;
  finishCutOptions?: unknown;
  /**
  The remembered choices of the `Shift+F` workflow, kept apart from `Shift+E`'s.

  Sharing one slot would let a skip job (source → `finished_skip_src`) decide what the next
  `Shift+E` job does, which is how a video meant for the waiting-for-deletion folder ended up in
  the skipped-sources folder.
  */
  finishKeepSourceMergeOptions?: unknown;
  finishKeepSourceCutOptions?: unknown;
  /**
  The privacy lock of the work-folder history (fork-owned).

  The lock is not a security feature: it hides the history list until the password is entered and
  records resets/unlocks, nothing more.
  */
  historyLockMode: PatchHistoryLockMode;
  historyLockIdleMinutes: number;
  /**
  Has the password file been created (or adopted) once?

  It separates the first-run seed of the default password from a later missing file. A missing file
  after this flag is set is a reset to the default password and is logged, not a fresh install.
  */
  historyLockInitialized: boolean;
  /**
  The lock state `manual` mode remembers across restarts.

  `startup` and `idle` ignore it and always start locked. It is written by the main process on every
  lock/unlock; the settings only read it through the lock status.
  */
  historyLockLocked: boolean;
  /**
  A default password record (the first seed or a reset) is in memory but its write has not landed.

  This is separate from `historyLockInitialized`: it separates "the file was never written" (a
  read-only folder) from "the file was deleted", so a restart does not log a reset that never
  happened. It clears as soon as the write succeeds.
  */
  historyLockSeedPending: boolean;
  /** The newest password events, at most `patchHistoryLockEventLimit`, newest first. */
  historyLockEvents: PatchHistoryLockEvent[];
}

export const defaultPatchSettings: PatchSettings = {
  workDirName: defaultPatchWorkDirName,
  finishedDirName: defaultPatchFinishedDirName,
  namingPreset: 'losslesscut',
  mergedNameRule: defaultMergedNameRule,
  labelSeparator: defaultLabelSeparator,
  cutNameRule: defaultCutNameRule,
  cutLabelSeparator: defaultCutLabelSeparator,
  viewSwitchStyle: 'candidates',
  sourcePostAction: 'keep',
  autoMerge: false,
  mergeBoundaryPolicy: 'losslessGuard',
  mergeBoundaryGuard: 'bFrames',
  tailToSourceEnd: true,
  autoOpenPlayer: true,
  singleWindowPlayback: true,
  reloadResultsWindow: true,
  confirmFinishPermanentDelete: true,
  confirmDetachedSrcPermanentDelete: true,
  detachGridView: patchDetachGridDefaultView,
  detachGroupsPerRow: patchDetachGroupsPerRowDefault,
  detachSourceColumnWidths: Array.from({ length: patchDetachGroupsPerRowDefault }, () => 0),
  detachDeleteDialogView: patchDetachDeleteDialogViewDefault,
  detachExtraDeletableReasons: [],
  detachDeleteAllIncludesExtra: false,
  confirmDiscardSource: true,
  confirmClearFileList: true,
  discardResultsAction: 'ask',
  segmentLeadInSeconds: 3,
  segmentQueueHelpOpen: true,
  timecodeHelpOpen: true,
  timecodeCompactSwapped: true,
  timeConvertGap: defaultTimePairGap,
  timeConvertNameLine: true,
  rememberedPlaybackRate: 1,
  playbackRateStep: 'fixed',
  layoutVersion: patchLayoutVersion,
  sourceListWidth: defaultSourceListWidth,
  historyLockMode: 'manual',
  historyLockIdleMinutes: patchHistoryLockDefaultIdleMinutes,
  historyLockInitialized: false,
  historyLockLocked: true,
  historyLockSeedPending: false,
  historyLockEvents: [],
};
