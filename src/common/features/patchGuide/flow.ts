/**
Patch-mode flow stages and the context-aware shortcut guide (pure logic).

The guide is inferred from observable state, not from explicit key presses, so the right set of
shortcuts is always shown without the user having to switch a mode.
*/

export type PatchFlowStage = | 'no-file'
  | 'marking'
  | 'segment-preview'
  | 'cut'
  | 'merge-preview'
  | 'merged'
  | 'finish';

export interface PatchFlowInput {
  /** A media file is open. */
  hasFile: boolean;
  /** At least one real (non-initial) cut segment exists. */
  hasSegments: boolean;
  /** Clips were produced for the current file. */
  hasCutClips: boolean;
  /** The virtual merge preview is open. */
  mergePreviewActive: boolean;
  /** A merged output was produced. */
  hasMergedOutput: boolean;
  /** The current file has been fully processed / moved on. */
  isFinished: boolean;
}

/** Infer the current flow stage from observable state. */
export function inferPatchFlowStage(input: PatchFlowInput): PatchFlowStage {
  if (!input.hasFile) return 'no-file';
  if (input.isFinished) return 'finish';
  if (input.hasMergedOutput) return 'merged';
  if (input.mergePreviewActive) return 'merge-preview';
  if (input.hasCutClips) return 'cut';
  if (input.hasSegments) return 'segment-preview';
  return 'marking';
}
