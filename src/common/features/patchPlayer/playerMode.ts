import type { KeyboardAction } from '../../types.js';
import type { FileNameTemplateContext } from '../../userTypes.js';
import type { RuleCutNameContext } from '../patchData/cutName.js';
import type { PatchMergedChapter } from '../patchMerged/mergedChapters.js';

import type { PatchDetachOrigin } from './playlistOrigin.js';

/**
The player window (fork-owned, see `main/features/patchPlayer`).

The player window is the untouched upstream player itself: it mounts the same `App` as the main
window (with `playerMode`) and shows the cut results as a playlist (the upstream batch list).
Every player capability therefore comes for free (timeline, waveform, keyframes, thumbnails,
playback speed, full screen, snapshots, segment inspection, file switching).

What it does *not* have is the cutting itself: marking cut points, editing the cut list and
exporting are disabled there. Detection/analysis actions stay enabled on purpose - reviewing a
result may need them, and they only ever touch the throw-away cut list of the player window.
*/

/** Keyboard actions the player window does not run (they would produce cuts). */
export const patchPlayerDisabledActions = [
  // Cut-point marking (the I/O keys and their buttons)
  'setCutStart',
  'setCutEnd',
  'removeCurrentCutpoint',
  // Cut-list editing
  'splitCurrentSegment',
  'addSegment',
  'removeCurrentSegment',
  'duplicateCurrentSegment',
  'clearSegments',
  // Exporting the cuts
  'export',
  'exportForce',
  'exportYouTube',
] as const satisfies readonly KeyboardAction[];

type Noop = () => void;

/** Replace the disabled actions with no-ops, leaving every other action untouched. */
export function disablePatchPlayerActions<T extends Record<string, Noop>>(actions: T): T {
  const patched: Record<string, Noop> = { ...actions };
  for (const action of patchPlayerDisabledActions) {
    if (action in patched) patched[action] = () => undefined;
  }
  return patched as T;
}

/** Query parameter that makes the renderer run the player window (`playerMode`). */
export const patchPlayerQueryParam = 'patchPlayer';

/**
How a cut result got its file name.

Two naming systems exist in patch mode: the upstream `${}` template and the patch `{token}` rule
(`cutName.ts`, used for every new export). The record says which one rendered the name, so
changing a label re-renders it the same way instead of guessing which part of the file name is the
label (the template may not even use it, and the export sanitizes it).
*/

/** A result named by the upstream `${}` template (base mode, and patch results of older builds). */
export interface PatchTemplateNameContext {
  /** The naming system. Absent means `template`: records written before the cut rule existed. */
  kind?: 'template' | undefined;
  /** The name template that produced the current file name. */
  template: string;
  /** The output directory the template was rendered into (`getOutDir`). */
  outputDir: string;
  /** The resolved template variables at export time (all of them, so any template can be re-run). */
  context: FileNameTemplateContext;
  /** The `${SEG_SUFFIX}` an empty label gets (e.g. `-seg01`, or `''` for a single segment). */
  emptyLabelSuffix: string;
  /** How labels were sanitized at export time (`maxLabelLength` in App). */
  maxLabelLength: number;
  /** Whether the export sanitized names (`safeOutputFileName`). */
  safeOutputFileName: boolean;
}

export type PatchNameContext = PatchTemplateNameContext | RuleCutNameContext;

/** One entry of the cut-results playlist the player window shows. */
export interface PatchCutResultEntry {
  path: string;
  /** The segment label at export time (also the default of the rename dialog). */
  label?: string | undefined;
  /** Stable segment identity (used by the incremental export to reuse results). */
  segId?: string | undefined;
  /** The source file the result was cut from. */
  sourcePath?: string | undefined;
  /** Name template context; absent for a merged result, which has no single segment label. */
  nameContext?: PatchNameContext | undefined;
  /**
  The merged timeline's read-only chapters (only on a merged-result entry).

  Built at merge time from the clips (actual durations, source labels and colors) and shown in
  the merged window instead of an editable cut list; a new merge replaces them.
  */
  mergedChapters?: PatchMergedChapter[] | undefined;
  /**
  The export that produced this playlist really cut this result again (`ffmpeg` wrote the file).

  It is a property of one playlist push, not of the result: reused, renamed, blocked and skipped
  results do not have it, and nothing stores it in the manifest. The results window uses it to
  show the earliest re-cut result instead of the one that happened to be playing
  (see `planPlaylistUpdate`).
  */
  recut?: boolean | undefined;
  /**
  The playlist section this entry belongs to (fork-owned).

  The check player groups the whole check list by source: every entry of one source carries the
  same group (its file name), and the sidebar starts a header when the group changes. Absent in the
  cut-results and merged windows, which have no such grouping.
  */
  group?: string | undefined;
  /**
  The folder the file sits in, for the check player's yellow badge (fork-owned).

  Absent in the cut-results and merged windows; an entry without it shows no badge.
  */
  origin?: PatchDetachOrigin | undefined;
}

/**
Query parameter that marks the merged-result window.

It is a player window as well (it plays with the same viewer), but it plays one file: the merged
result. `E` (merge) is not bound there, see `common/features/patchTransport`.
*/
export const patchMergedQueryParam = 'patchMerged';

/**
Query parameter that marks the check player window (fork-owned).

It is a player window as well (the same viewer, one file at a time), opened by the
detached-source check when a file is double-clicked. It plays the whole check list (the sources and
their results, grouped by source), but it holds no result claim: a finish job that reaches a result
the check player has open find it in use and reports that instead of moving it. It still takes part
in the playback exclusion (`playback.ts`).
*/
export const patchInspectQueryParam = 'patchInspect';

/** IPC channel: main -> player, the playlist (the cut results of an export). */
export const patchPlayerPlaylistChannel = 'patchPlayerPlaylist';

/** IPC channel: player -> main, "my player window is mounted, send me the playlist". */
export const patchPlayerReadyChannel = 'patch-player-ready';

/** IPC channel: main -> player, "an export is starting, release the file you are playing". */
export const patchPlayerReleaseChannel = 'patchPlayerRelease';

/**
IPC channel: results window -> main, "a cut result started playing".

The cut results are played in their own window, so the source in the cutting window would keep
playing at the same time. The results window announces the playback, and the cutting window
pauses its source.
*/
export const patchPlayerPlaybackChannel = 'patchPlayerPlayback';

/** IPC channel: main -> cutting window, "pause the source video". */
export const patchSourcePauseChannel = 'patchSourcePause';

/**
IPC channel: cutting window -> main, "the source video started playing".

The other direction of `patchPlayerPlaybackChannel`: the results windows pause their result so
the two windows never play audio at the same time.
*/
export const patchSourcePlaybackChannel = 'patchSourcePlayback';

/** IPC channel: main -> results windows, "pause the result you are playing". */
export const patchResultsPauseChannel = 'patchResultsPause';
