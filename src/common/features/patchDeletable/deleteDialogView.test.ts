// eslint-disable-next-line import-js/no-extraneous-dependencies
import { describe, expect, it } from 'vitest';

import { parsePatchDetachDeleteDialogView, patchDetachDeleteDialogViewDefault, patchDetachDeleteDialogViews } from './deleteDialogView.js';

describe('delete dialog view', () => {
  it('offers grid and list, with the grid as the default', () => {
    expect(patchDetachDeleteDialogViews).toStrictEqual(['grid', 'list']);
    expect(patchDetachDeleteDialogViewDefault).toBe('grid');
  });

  it('reads a stored value and falls back to the default', () => {
    expect(parsePatchDetachDeleteDialogView('list')).toBe('list');
    expect(parsePatchDetachDeleteDialogView('grid')).toBe('grid');
    expect(parsePatchDetachDeleteDialogView('table')).toBe('grid');
    expect(parsePatchDetachDeleteDialogView(undefined)).toBe('grid');
    expect(parsePatchDetachDeleteDialogView(42)).toBe('grid');
  });
});
