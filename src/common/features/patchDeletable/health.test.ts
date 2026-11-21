// eslint-disable-next-line import-js/no-extraneous-dependencies
import { describe, expect, it } from 'vitest';

import { getPatchFileQuickHealth } from './health.js';

describe('getPatchFileQuickHealth', () => {
  it('accepts a file with a size and a duration', () => {
    expect(getPatchFileQuickHealth({ size: 1024, duration: 12.5 })).toBe('ok');
  });

  it('reports a file that could not be read at all', () => {
    // `stat` failed: the file is gone, or nothing can read it.
    expect(getPatchFileQuickHealth({ size: undefined, duration: undefined })).toBe('unreadable');
  });

  it('reports a zero-byte file as empty, not as an unreadable duration', () => {
    expect(getPatchFileQuickHealth({ size: 0, duration: undefined })).toBe('empty');
  });

  it('reports a file whose duration could not be read', () => {
    expect(getPatchFileQuickHealth({ size: 1024, duration: undefined })).toBe('duration-unreadable');
    expect(getPatchFileQuickHealth({ size: 1024, duration: 0 })).toBe('duration-unreadable');
    expect(getPatchFileQuickHealth({ size: 1024, duration: NaN })).toBe('duration-unreadable');
  });
});
