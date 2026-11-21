// eslint-disable-next-line import-js/no-extraneous-dependencies
import { describe, expect, it } from 'vitest';

import type { PatchChapterImportWindow } from './chapterImport.js';
import { planEmbeddedChapterImport, resolveChapterImportWindow } from './chapterImport.js';

const allWindows: PatchChapterImportWindow[] = ['base', 'cutting', 'cut-results', 'merged'];

describe('resolveChapterImportWindow', () => {
  it('maps the mode props to the window the file is opened in', () => {
    expect(resolveChapterImportWindow({ patchMode: false, playerMode: false, mergedMode: false })).toBe('base');
    expect(resolveChapterImportWindow({ patchMode: true, playerMode: false, mergedMode: false })).toBe('cutting');
    expect(resolveChapterImportWindow({ patchMode: true, playerMode: true, mergedMode: false })).toBe('cut-results');
    expect(resolveChapterImportWindow({ patchMode: true, playerMode: true, mergedMode: true })).toBe('merged');
  });

  it('ignores the window flags in base mode', () => {
    expect(resolveChapterImportWindow({ patchMode: false, playerMode: true, mergedMode: true })).toBe('base');
  });
});

describe('planEmbeddedChapterImport', () => {
  it('keeps the upstream setting in the cutting window', () => {
    const plan = (enableImportChapters: 'always' | 'ask' | 'never') => planEmbeddedChapterImport({
      chapterCount: 3, enableImportChapters, readOnlySource: false, windowKind: 'cutting',
    });
    expect(plan('always')).toBe('import');
    expect(plan('ask')).toBe('ask');
    expect(plan('never')).toBe('skip');
  });

  it('keeps base mode verbatim', () => {
    const plan = (enableImportChapters: 'always' | 'ask' | 'never') => planEmbeddedChapterImport({
      chapterCount: 3, enableImportChapters, readOnlySource: false, windowKind: 'base',
    });
    expect(plan('always')).toBe('import');
    expect(plan('ask')).toBe('ask');
    expect(plan('never')).toBe('skip');
  });

  it('never imports chapters in a result window, whatever the setting says', () => {
    for (const windowKind of ['cut-results', 'merged'] as const) {
      for (const enableImportChapters of ['always', 'ask', 'never'] as const) {
        expect(planEmbeddedChapterImport({ chapterCount: 3, enableImportChapters, readOnlySource: false, windowKind })).toBe('skip');
      }
    }
  });

  it('never imports chapters for a result opened read-only in the cutting window', () => {
    for (const enableImportChapters of ['always', 'ask', 'never'] as const) {
      expect(planEmbeddedChapterImport({ chapterCount: 3, enableImportChapters, readOnlySource: true, windowKind: 'cutting' })).toBe('skip');
    }
  });

  it('does not let the read-only flag change base mode', () => {
    expect(planEmbeddedChapterImport({ chapterCount: 3, enableImportChapters: 'ask', readOnlySource: true, windowKind: 'base' })).toBe('ask');
  });

  it('skips a file without usable chapters everywhere', () => {
    for (const windowKind of allWindows) {
      for (const enableImportChapters of ['always', 'ask', 'never'] as const) {
        expect(planEmbeddedChapterImport({ chapterCount: 0, enableImportChapters, readOnlySource: false, windowKind })).toBe('skip');
      }
    }
  });
});
