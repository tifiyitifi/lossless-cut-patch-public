// eslint-disable-next-line import-js/no-extraneous-dependencies
import { describe, expect, it } from 'vitest';

import { isPatchExportFormat, patchExportFormats } from './exportFormats.js';

describe('patchExportFormats', () => {
  it('lists each format once', () => {
    expect(new Set(patchExportFormats).size).toBe(patchExportFormats.length);
  });

  it('includes the formats the console accepts by name', () => {
    expect(patchExportFormats).toContain('csv');
    expect(patchExportFormats).toContain('srt');
    expect(patchExportFormats).toContain('llc');
  });
});

describe('isPatchExportFormat', () => {
  it('accepts every listed format', () => {
    for (const format of patchExportFormats) expect(isPatchExportFormat(format)).toBe(true);
  });

  it('rejects anything else', () => {
    expect(isPatchExportFormat('mp4')).toBe(false);
    expect(isPatchExportFormat('')).toBe(false);
  });
});
