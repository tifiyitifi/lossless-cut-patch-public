import type { PatchAction } from '../patchData/keymap.js';
import type { PatchFlowStage } from './flow.js';

/** Non-keyboard commands that can appear in the guide. */
export type PatchGuideCommand = | 'open-file'
  | 'import-src-txt'
  | 'choose-directory'
  | 'console'
  | 'palette'
  | 'settings';

/** Sections the guide groups its entries into. */
export type PatchGuideGroup = 'mark' | 'transport' | 'file' | 'view' | 'ui';

/** Render order of the sections. */
export const patchGuideGroupOrder: readonly PatchGuideGroup[] = ['mark', 'transport', 'file', 'view', 'ui'];

export interface PatchGuideEntry {
  group: PatchGuideGroup;
  /** A keyboard action (its bound key is shown). */
  action?: PatchAction | undefined;
  /** A UI command without a key binding. */
  command?: PatchGuideCommand | undefined;
}

const marking: PatchGuideEntry[] = [
  { group: 'mark', action: 'set-cut-start' },
  { group: 'mark', action: 'set-cut-end' },
  { group: 'mark', action: 'add-segment' },
  { group: 'mark', action: 'split-segment' },
  { group: 'mark', action: 'remove-segment' },
  { group: 'mark', action: 'prev-segment' },
  { group: 'mark', action: 'next-segment' },
  { group: 'mark', action: 'toggle-select' },
  { group: 'mark', action: 'play-selected' },
];

const transport: PatchGuideEntry[] = [
  { group: 'transport', action: 'play-pause' },
  { group: 'transport', action: 'seek-back' },
  { group: 'transport', action: 'seek-forward' },
  { group: 'transport', action: 'frame-prev' },
  { group: 'transport', action: 'frame-next' },
];

const views: PatchGuideEntry[] = [
  { group: 'view', action: 'view-candidates' },
  { group: 'view', action: 'view-previous' },
];

const ui: PatchGuideEntry[] = [
  { group: 'ui', command: 'console' },
  { group: 'ui', command: 'palette' },
  { group: 'ui', command: 'settings' },
];

/**
Which shortcuts are relevant for each flow stage, grouped the same way the panel renders them.

Only structure lives here (pure + testable). The human labels and the "what do I do now" sentence
per stage are resolved in the UI with literal translation calls so the i18n extractor finds them.
*/
export const patchGuideByStage: Record<PatchFlowStage, PatchGuideEntry[]> = {
  'no-file': [
    { group: 'file', command: 'open-file' },
    { group: 'file', command: 'import-src-txt' },
    { group: 'file', command: 'choose-directory' },
    ...ui,
  ],
  marking: [
    ...marking,
    ...transport,
    { group: 'transport', action: 'snapshot' },
    { group: 'file', action: 'cut' },
    { group: 'file', action: 'next-file' },
    ...views,
    ...ui,
  ],
  'segment-preview': [
    { group: 'mark', action: 'prev-segment' },
    { group: 'mark', action: 'next-segment' },
    { group: 'mark', action: 'split-segment' },
    { group: 'mark', action: 'remove-segment' },
    { group: 'mark', action: 'toggle-select' },
    { group: 'mark', action: 'play-selected' },
    ...transport,
    { group: 'transport', action: 'snapshot' },
    { group: 'file', action: 'cut' },
    { group: 'file', action: 'next-file' },
    ...views,
    ...ui,
  ],
  cut: [
    ...transport,
    { group: 'file', action: 'cut' },
    { group: 'file', action: 'next-file' },
    { group: 'file', action: 'prev-file' },
    ...views,
    ...ui,
  ],
  'merge-preview': [
    ...transport,
    ...views,
    ...ui,
  ],
  merged: [
    { group: 'file', action: 'next-file' },
    { group: 'file', action: 'prev-file' },
    ...ui,
  ],
  finish: [
    { group: 'file', action: 'next-file' },
    ...ui,
  ],
};
