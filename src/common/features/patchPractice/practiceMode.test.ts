// eslint-disable-next-line import-js/no-extraneous-dependencies
import { describe, expect, it } from 'vitest';

import type { KeyboardAction } from '../../types.js';
import { practiceGuides } from './practiceGuides.js';
import { actionFromFallbackGuideId, defaultPracticePopupMode, fallbackGuideId, findPracticeGuide, guideRelatedActions, isFallbackGuideId, practicePopupModes, resolveGuideIdForAction, shouldShowPracticePopup } from './practiceMode.js';

describe('practiceGuides', () => {
  it('never lets two guides trigger on the same action', () => {
    const seen = new Map<string, string>();
    for (const guide of practiceGuides) {
      for (const action of guide.triggers) {
        expect(seen.has(action), `${action} is a trigger of both ${seen.get(action)} and ${guide.id}`).toBe(false);
        seen.set(action, guide.id);
      }
    }
  });

  it('has unique guide ids', () => {
    const ids = practiceGuides.map((guide) => guide.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('repeats related shortcuts across guides on purpose', () => {
    const helpGuides = practiceGuides.filter((guide) => (guide.related as readonly string[]).includes('toggleKeyboardShortcuts'));
    expect(helpGuides).toHaveLength(practiceGuides.length);
  });
});

describe('resolveGuideIdForAction', () => {
  it('maps an action onto its guide', () => {
    expect(resolveGuideIdForAction('increasePlaybackRate')).toBe('speed');
    expect(resolveGuideIdForAction('reducePlaybackRate')).toBe('speed');
    expect(resolveGuideIdForAction('export')).toBe('export');
    expect(resolveGuideIdForAction('toggleKeyboardShortcuts')).toBe('help');
  });

  it('falls back to a per-action card for unknown actions', () => {
    const futureAction = 'someFutureAction' as KeyboardAction;
    const id = resolveGuideIdForAction(futureAction);
    expect(id).toBe(fallbackGuideId(futureAction));
    expect(isFallbackGuideId(id)).toBe(true);
    expect(actionFromFallbackGuideId(id)).toBe(futureAction);
    expect(findPracticeGuide(id)).toBeUndefined();
  });
});

describe('the L / J example', () => {
  it('sends the speed-up key to the playback speed guide, which points at slow-down and the help key', () => {
    const guide = findPracticeGuide(resolveGuideIdForAction('increasePlaybackRate'));
    expect(guide?.id).toBe('speed');
    const related = guide?.related as readonly string[];
    expect(related).toContain('reducePlaybackRate');
    expect(related).toContain('reducePlaybackRateMore');
    expect(related).toContain('toggleKeyboardShortcuts');
  });
});

describe('the full screen key', () => {
  it('belongs to the playback guide, not to the view guide', () => {
    expect(resolveGuideIdForAction('toggleFullscreenVideo')).toBe('transport');
    expect(findPracticeGuide('transport')?.related).toContain('toggleFullscreenVideo');
    expect(findPracticeGuide('view')?.triggers).not.toContain('toggleFullscreenVideo');
    expect(findPracticeGuide('view')?.related).not.toContain('toggleFullscreenVideo');
  });
});

describe('guideRelatedActions', () => {
  it('contains every trigger of every guide', () => {
    for (const guide of practiceGuides) {
      const related = guideRelatedActions(guide);
      for (const action of guide.triggers) {
        expect(related, `${guide.id} lists its trigger ${action}`).toContain(action);
      }
    }
  });

  it('does not repeat an action', () => {
    for (const guide of practiceGuides) {
      const related = guideRelatedActions(guide);
      expect(new Set(related).size, guide.id).toBe(related.length);
    }
  });
});

describe('the cut results card', () => {
  it('owns the playlist, rename and merge actions', () => {
    for (const action of ['playlistPrev', 'playlistNext', 'playlistFirst', 'playlistLast', 'renameResultLabel', 'renameResultFull', 'mergeCutResults'] as const) {
      expect(resolveGuideIdForAction(action)).toBe('cut-results');
      expect(guideRelatedActions(findPracticeGuide('cut-results')!)).toContain(action);
    }
  });
});

describe('the cards list the bound keys they own', () => {
  const guideKeys: [string, string[]][] = [
    ['view', ['increaseRotation', 'makeCursorTimeZero']],
    ['zoom', ['timelineToggleComfortZoom']],
    ['segment-nav', ['jumpSeekFirstSegment', 'jumpSeekLastSegment', 'jumpSegmentEndPreview']],
    ['segment-select', ['labelCurrentSegment']],
    ['batch-tools', ['cleanupFilesDialog']],
    ['files', ['batchOpenSelectedFile']],
  ];

  it.each(guideKeys)('%s lists its own bound keys', (id, actions) => {
    const related = findPracticeGuide(id)?.related as readonly string[] | undefined;
    for (const action of actions) {
      expect(related, `${id} lists ${action}`).toContain(action);
    }
  });
});

describe('shouldShowPracticePopup', () => {
  it('per-guide: notes on the first key of a guide, then silence', () => {
    expect(shouldShowPracticePopup('per-guide', 'increasePlaybackRate', undefined)).toBe(true);
    expect(shouldShowPracticePopup('per-guide', 'increasePlaybackRate', 'speed')).toBe(false);
    expect(shouldShowPracticePopup('per-guide', 'reducePlaybackRate', 'speed')).toBe(false);
  });

  it('per-guide: entering another guide shows its notes again', () => {
    expect(shouldShowPracticePopup('per-guide', 'reducePlaybackRate', 'seek')).toBe(true);
  });

  it('every-press: always', () => {
    expect(shouldShowPracticePopup('every-press', 'reducePlaybackRate', 'speed')).toBe(true);
    expect(shouldShowPracticePopup('every-press', 'reducePlaybackRate', undefined)).toBe(true);
  });

  it('defaults to per-guide', () => {
    expect(defaultPracticePopupMode).toBe('per-guide');
    expect(practicePopupModes).toContain(defaultPracticePopupMode);
  });
});
