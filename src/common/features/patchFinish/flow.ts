import type { PatchFinishSourceChoice } from './options.js';
import type { PatchFinishPresetChoice } from './presets.js';

/**
The finish dialog's two entry points (fork-owned, pure).

`Shift+E` ends a job the user was working on. `Shift+F` ends it because the video is skipped: the
cutting intention is dropped and the source goes to `finished_skip_src`.

They are two workflows, not one workflow with a different default:

- each keeps its own remembered choices (`finishMergeOptions` / `finishCutOptions` vs
  `finishKeepSourceMergeOptions` / `finishKeepSourceCutOptions`), so a `Shift+F` job can never move
  the files a later `Shift+E` job was configured to handle;
- `skip` is a candidate only in the `Shift+F` workflow: the `Shift+E` dialog does not offer it and
  cannot resolve to it, so a stored `skip` from an older build is dropped on read (those builds
  shared one options slot between the two keys).
*/

export type PatchFinishFlow = 'finish' | 'keepSource';

export const defaultPatchFinishFlow: PatchFinishFlow = 'finish';

const finishSourceChoices: readonly PatchFinishSourceChoice[] = ['finished', 'detached', 'keep'];
const keepSourceSourceChoices: readonly PatchFinishSourceChoice[] = ['finished', 'skip', 'detached', 'keep'];

const finishPresetChoices: readonly PatchFinishPresetChoice[] = ['one-video', 'archive', 'loop-video'];
const keepSourcePresetChoices: readonly PatchFinishPresetChoice[] = ['one-video', 'archive', 'skip', 'loop-video'];

/** The source destinations the flow offers, in the dialog's order. */
export function getFinishSourceChoices(flow: PatchFinishFlow): readonly PatchFinishSourceChoice[] {
  return flow === 'keepSource' ? keepSourceSourceChoices : finishSourceChoices;
}

/** The presets the flow offers. `skip` is `Shift+F`'s own workflow, so `Shift+E` never shows it. */
export function getFinishPresetChoices(flow: PatchFinishFlow): readonly PatchFinishPresetChoice[] {
  return flow === 'keepSource' ? keepSourcePresetChoices : finishPresetChoices;
}

/** The source a flow opens with when nothing was stored for it yet. */
export function getDefaultFinishSource(flow: PatchFinishFlow): PatchFinishSourceChoice {
  return flow === 'keepSource' ? 'skip' : 'detached';
}

/**
The stored source, made valid for the flow.

`skip` belongs to `Shift+F`: a value stored by an older build (which shared one options slot
between the two keys) is dropped instead of silently moving the video the other key was about to
park for deletion.
*/
export function normalizeFinishSourceForFlow(flow: PatchFinishFlow, source: PatchFinishSourceChoice): PatchFinishSourceChoice {
  if (flow === 'finish' && source === 'skip') return getDefaultFinishSource(flow);
  return source;
}

/** Apply the flow to a stored options object (see `normalizeFinishSourceForFlow`). */
export function withFinishFlowSource<T extends { source: PatchFinishSourceChoice }>(flow: PatchFinishFlow, options: T): T {
  const source = normalizeFinishSourceForFlow(flow, options.source);
  return source === options.source ? options : { ...options, source };
}
