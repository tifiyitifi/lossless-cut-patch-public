import type { PatchAction } from '../patchData/keymap.js';
import type { PatchSegmentOperation } from '../patchData/segmentOperations.js';
import type { PatchFileOperation } from '../patchData/fileOperations.js';
import type { KeyboardAction } from '../../types.js';

/**
Patch command vocabulary (pure data).

The console accepts three kinds of input: the legacy two/three letter codes of the earlier
PowerShell cutting workflow, patch action ids (e.g. `cut`, `set-cut-start`) and a few
upstream action names (e.g. `export`, `addSegment`). Everything is normalized to a `PatchIntent`
which the renderer maps to something runnable.
*/

/** Intents that are not plain keyboard actions: batch flow / merging / post-processing. */
export type PatchFlowIntent = | 'import-src-txt'
  | 'generate-src-txt'
  | 'skip-file'
  | 'merge'
  | 'cut-and-merge'
  | 'post-process-cut'
  | 'post-process-merge'
  | 'finish-and-next'
  | 'open-merged'
  | 'open-clips'
  | 'resumewindows'
  | 'toggleclipswindow'
  | 'togglemergedwindow'
  | 'open-workpath-list'
  | 'clear-empty-work-dirs'
  | 'help'
  | 'clear'
  | 'toggle-batch-files-list'
  | 'toggle-command-custom-settings'
  | 'toggle-work-settings'
  /** Console-only toggle: deliberately not in `patchFlowIntents` (it is a built-in, so it is wired). */
  | 'toggle-keyboard-practice'
  | 'reorder-segments'
  | PatchSegmentOperation
  | PatchFileOperation;

/**
Everything the console can resolve to: patch actions, patch flow intents and the upstream (base)
keyboard actions, which the console can run directly by name.
*/
export type PatchIntent = PatchAction | PatchFlowIntent | KeyboardAction;

/**
Every flow intent and whether the console lists it (see `patchFlowIntents`).

The `Record<PatchFlowIntent, boolean>` makes a *new* `PatchFlowIntent` a compile error here: an
intent that the console can run but that is missing from the list would never be parseable.
*/
const flowIntentListed: Record<PatchFlowIntent, boolean> = {
  'import-src-txt': true,
  'generate-src-txt': true,
  'skip-file': true,
  merge: true,
  'cut-and-merge': true,
  'post-process-cut': true,
  'post-process-merge': true,
  'finish-and-next': true,
  'open-merged': true,
  'open-clips': true,
  resumewindows: true,
  toggleclipswindow: true,
  togglemergedwindow: true,
  'open-workpath-list': true,
  'toggle-batch-files-list': true,
  'toggle-command-custom-settings': true,
  'toggle-work-settings': true,
  'detect-black-scenes': true,
  'detect-silent-scenes': true,
  'detect-scene-changes': true,
  'segments-from-keyframes': true,
  'invert-segments': true,
  'fill-segment-gaps': true,
  'combine-overlapping-segments': true,
  'reorder-segments': true,
  'fix-invalid-duration': true,
  'extract-all-streams': true,
  html5ify: true,
  decimate: true,
  'concat-batch': true,
  'convert-batch': true,
  'export-cut-list': true,
  'import-cut-list': true,
  // Resolved as built-ins (the parser answers them before the flow intents are consulted).
  help: false,
  clear: false,
  'toggle-keyboard-practice': false,
  'clear-empty-work-dirs': false,
};

/** Flow intents that can be typed in the console and shown in the palette (everything but help/clear). */
export const patchFlowIntents: readonly PatchFlowIntent[] = (Object.keys(flowIntentListed) as PatchFlowIntent[])
  .filter((intent) => flowIntentListed[intent]);

export function isPatchFlowIntent(value: string): value is PatchFlowIntent {
  return (patchFlowIntents as readonly string[]).includes(value);
}

/** A legacy PowerShell entry point replaced by patch mode. */
export interface LegacyPatchCommand {
  /** Code as typed (lower-cased), e.g. `xc`. */
  code: string;
  /** Source script, kept for traceability. */
  script: string;
  intent: PatchIntent;
}

/**
Legacy codes, derived from the earlier PowerShell cutting workflow (script filename + header):
- xa take the next queued video (move it to working, generate src, open it)
- xb generate the src text from the videos in the working folder
- xc cut from src
- xrc re-cut part of a clip
- xm concat-merge the clips
- xts re-merge as ts
- xk cut and merge in one step
- ne finish the merge and take the next one
- xs skip the current file
- zc post-process a cut (archive clips, rename, handle the source)
- zm post-process a merge
- zsm move into the merge folder and take the next one
- im / ic / its / is open the merged / clip videos
*/
export const legacyPatchCommands: readonly LegacyPatchCommand[] = [
  { code: 'xa', script: 'xa_get_a_video_from_wait.ps1', intent: 'next-file' },
  { code: 'xb', script: 'xb_create_common_prefix_src_txt.ps1', intent: 'generate-src-txt' },
  { code: 'xc', script: 'xc_cut_video_base_src_txt.ps1', intent: 'cut' },
  { code: 'xrc', script: 'xrc_recut_clip_base_precut.ps1', intent: 'cut' },
  { code: 'xm', script: 'xmc_concat_merge.ps1', intent: 'merge' },
  { code: 'xts', script: 'xts_ts_merge.ps1', intent: 'merge' },
  { code: 'xk', script: 'xk_all_cut_and_concat_merge.ps1', intent: 'cut-and-merge' },
  { code: 'ne', script: 'ne_emxk_end_merge_and_get_next.ps1', intent: 'finish-and-next' },
  { code: 'xs', script: 'xs_skip-one-file.ps1', intent: 'skip-file' },
  { code: 'zc', script: 'zc_end_clip_post_process.ps1', intent: 'post-process-cut' },
  { code: 'zm', script: 'zm_end_merge_post_process.ps1', intent: 'post-process-merge' },
  { code: 'zsm', script: 'zsm_src_to_merge.ps1', intent: 'finish-and-next' },
  { code: 'im', script: 'im_invoke_merged_video.ps1', intent: 'open-merged' },
  { code: 'ic', script: 'ic_ivoke_cut_clip_videos.ps1', intent: 'open-clips' },
  { code: 'its', script: 'its_invoke_ts_merged_video.ps1', intent: 'open-merged' },
  { code: 'is', script: 'is_invoke_src_excluprefix.ps1', intent: 'open-merged' },
];

/** Upstream / legacy action names, keyed lower-cased, mapped onto patch intents. */
export const upstreamActionAliases: Readonly<Record<string, PatchIntent>> = {
  export: 'cut',
  cut: 'cut',
  addsegment: 'add-segment',
  removesegment: 'remove-segment',
  splitsegment: 'split-segment',
  toggleplay: 'play-pause',
  play: 'play-pause',
  pause: 'play-pause',
  nextfile: 'next-file',
  previousfile: 'prev-file',
  prevfile: 'prev-file',
  importsrctxt: 'import-src-txt',
  merge: 'merge',
  skip: 'skip-file',
  detectblackscenes: 'detect-black-scenes',
  detectsilentscenes: 'detect-silent-scenes',
  detectscenechanges: 'detect-scene-changes',
  createsegmentsfromkeyframes: 'segments-from-keyframes',
  invertallsegments: 'invert-segments',
  fillsegmentsgaps: 'fill-segment-gaps',
  combineoverlappingsegments: 'combine-overlapping-segments',
  reordersegsbystarttime: 'reorder-segments',
  fixinvalidduration: 'fix-invalid-duration',
  extractallstreams: 'extract-all-streams',
  html5ify: 'html5ify',
  decimate: 'decimate',
  concatbatch: 'concat-batch',
  convertformatbatch: 'convert-batch',
  exportcutlist: 'export-cut-list',
  exportedlfile: 'export-cut-list',
  importcutlist: 'import-cut-list',
};
