// eslint-disable-next-line import-js/no-extraneous-dependencies
import { describe, expect, it } from 'vitest';

import { getFinishDialogTitleVariant } from './dialogTitle.js';

describe('getFinishDialogTitleVariant', () => {
  it('says the video is skipped, not cut, whenever the source is skipped', () => {
    expect(getFinishDialogTitleVariant('cut', 'skip')).toBe('skip');
    expect(getFinishDialogTitleVariant('merge', 'skip')).toBe('skip');
  });

  it('keeps the mode-based title for every other source', () => {
    expect(getFinishDialogTitleVariant('cut', 'detached')).toBe('cut');
    expect(getFinishDialogTitleVariant('cut', 'finished')).toBe('cut');
    expect(getFinishDialogTitleVariant('cut', 'keep')).toBe('cut');
    expect(getFinishDialogTitleVariant('merge', 'detached')).toBe('merge');
    expect(getFinishDialogTitleVariant('merge', 'finished')).toBe('merge');
  });
});
