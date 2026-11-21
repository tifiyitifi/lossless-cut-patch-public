import { useTranslation } from 'react-i18next';

import type { PatchFlowIntent, PatchIntent } from '../../../../../common/features/patchCommand';
import type { PatchAction } from '../../../../../common/features/patchData';

export interface PatchCommandLabels {
  /** Human label for every command intent. */
  intents: Record<PatchIntent, string>;
}

/**
 * Command labels, built with literal translation calls (an id → label map) so the i18n extractor can
 * find the keys — `t(variable)` keys would be dropped by `scan-i18n` (`removeUnusedKeys`).
 */
export default function usePatchCommandLabels(): PatchCommandLabels {
  const { t } = useTranslation();

  const actionLabels: Record<PatchAction, string> = {
    'play-pause': t('Play / pause'),
    fullscreen: t('Fullscreen'),
    mute: t('Mute'),
    'seek-back': t('Seek back'),
    'seek-forward': t('Seek forward'),
    'volume-up': t('Volume up'),
    'volume-down': t('Volume down'),
    'frame-next': t('Next frame'),
    'frame-prev': t('Previous frame'),
    'rate-down': t('Slower'),
    'rate-up': t('Faster'),
    'rate-reset': t('Reset speed'),
    'set-cut-start': t('Set cut start'),
    'set-cut-end': t('Set cut end'),
    'split-segment': t('Split segment'),
    'add-segment': t('Add segment'),
    'remove-segment': t('Remove segment'),
    'prev-segment': t('Previous segment'),
    'next-segment': t('Next segment'),
    'prev-file': t('Previous file'),
    'next-file': t('Next file'),
    'view-candidates': t('Switch view'),
    'view-previous': t('Previous view'),
    snapshot: t('Take snapshot'),
    'snapshot-clipboard': t('Snapshot to clipboard'),
    'toggle-select': t('Toggle segment selected'),
    'select-all-segments': t('Select all segments'),
    'clear-selection': t('Clear segment selection'),
    'invert-selection': t('Invert segment selection'),
    'play-selected': t('Play selected segments'),
    cut: t('Cut'),
  };

  const flowLabels: Record<PatchFlowIntent, string> = {
    'import-src-txt': t('Import src txt'),
    'generate-src-txt': t('Generate src txt'),
    'skip-file': t('Skip file'),
    merge: t('Merge'),
    'cut-and-merge': t('Cut and merge'),
    'post-process-cut': t('Post-process clips'),
    'post-process-merge': t('Post-process merge'),
    'finish-and-next': t('Finish and open next'),
    'open-merged': t('Open merged video'),
    'open-clips': t('Open cut clips'),
    help: t('Help'),
    clear: t('Clear console'),
    'detect-black-scenes': t('Detect black scenes'),
    'detect-silent-scenes': t('Detect silent scenes'),
    'detect-scene-changes': t('Detect scene changes'),
    'segments-from-keyframes': t('Create segments from keyframes'),
    'invert-segments': t('Invert all segments'),
    'fill-segment-gaps': t('Fill gaps between segments'),
    'combine-overlapping-segments': t('Combine overlapping segments'),
    'reorder-segments': t('Sort segments by start time'),
    'fix-invalid-duration': t('Fix invalid duration'),
    'extract-all-streams': t('Extract all tracks'),
    html5ify: t('Convert to a supported format'),
    decimate: t('Decimate video'),
    'concat-batch': t('Concatenate the files in the work directory'),
    'convert-batch': t('Convert the files in the work directory'),
    'export-cut-list': t('Export cut list'),
    'import-cut-list': t('Import cut list'),
  };

  return { intents: { ...actionLabels, ...flowLabels } };
}
