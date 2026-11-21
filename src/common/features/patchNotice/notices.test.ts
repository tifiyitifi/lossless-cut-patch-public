// eslint-disable-next-line import-js/no-extraneous-dependencies
import { describe, expect, it } from 'vitest';

import {
  isNoticeSuppressed, patchNoticeExportFinished, patchNoticeFinishSummary, patchNoticeIds, shouldShowExportFinishedNotice,
  shouldShowFinishSummaryNotice, suppressNotice, unsuppressNotice,
} from './notices.js';

describe('the notice registry', () => {
  it('has unique ids', () => {
    expect(new Set(patchNoticeIds).size).toBe(patchNoticeIds.length);
  });

  it('lists the export-finished notice', () => {
    expect(patchNoticeIds).toContain(patchNoticeExportFinished);
  });

  it('lists the finish summary', () => {
    expect(patchNoticeIds).toContain(patchNoticeFinishSummary);
  });
});

describe('isNoticeSuppressed', () => {
  it('is false for a notice that was never silenced', () => {
    expect(isNoticeSuppressed([], patchNoticeExportFinished)).toBe(false);
  });

  it('is true once the notice is in the list', () => {
    expect(isNoticeSuppressed([patchNoticeExportFinished], patchNoticeExportFinished)).toBe(true);
  });
});

describe('suppressNotice', () => {
  it('silences a notice', () => {
    expect(suppressNotice([], patchNoticeExportFinished)).toStrictEqual([patchNoticeExportFinished]);
  });

  it('does not add the same id twice', () => {
    expect(suppressNotice([patchNoticeExportFinished], patchNoticeExportFinished)).toStrictEqual([patchNoticeExportFinished]);
  });

  it('keeps the other notices', () => {
    expect(suppressNotice(['other'], patchNoticeExportFinished)).toStrictEqual(['other', patchNoticeExportFinished]);
  });

  it('does not change the given list', () => {
    const list: string[] = [];
    suppressNotice(list, patchNoticeExportFinished);
    expect(list).toStrictEqual([]);
  });
});

describe('unsuppressNotice', () => {
  it('restores a notice', () => {
    expect(unsuppressNotice([patchNoticeExportFinished], patchNoticeExportFinished)).toStrictEqual([]);
  });

  it('keeps the other notices', () => {
    expect(unsuppressNotice([patchNoticeExportFinished, 'other'], patchNoticeExportFinished)).toStrictEqual(['other']);
  });

  it('does nothing for a notice that was never silenced', () => {
    expect(unsuppressNotice(['other'], patchNoticeExportFinished)).toStrictEqual(['other']);
  });
});

describe('shouldShowExportFinishedNotice', () => {
  it('shows the notice the first time', () => {
    expect(shouldShowExportFinishedNotice({ suppressed: [], hasWarnings: false })).toBe(true);
  });

  it('hides the notice once it is silenced', () => {
    expect(shouldShowExportFinishedNotice({ suppressed: [patchNoticeExportFinished], hasWarnings: false })).toBe(false);
  });

  it('always shows the notice when there is a warning', () => {
    expect(shouldShowExportFinishedNotice({ suppressed: [patchNoticeExportFinished], hasWarnings: true })).toBe(true);
  });
});

describe('shouldShowFinishSummaryNotice', () => {
  it('shows the summary the first time', () => {
    expect(shouldShowFinishSummaryNotice({ suppressed: [], ok: true, hasWarnings: false })).toBe(true);
  });

  it('hides a clean summary once it is silenced', () => {
    expect(shouldShowFinishSummaryNotice({ suppressed: [patchNoticeFinishSummary], ok: true, hasWarnings: false })).toBe(false);
  });

  it('always reports a job that only partly finished', () => {
    expect(shouldShowFinishSummaryNotice({ suppressed: [patchNoticeFinishSummary], ok: false, hasWarnings: false })).toBe(true);
  });

  it('always reports a job with a warning', () => {
    expect(shouldShowFinishSummaryNotice({ suppressed: [patchNoticeFinishSummary], ok: true, hasWarnings: true })).toBe(true);
  });

  it('keeps the two notices apart', () => {
    expect(shouldShowFinishSummaryNotice({ suppressed: [patchNoticeExportFinished], ok: true, hasWarnings: false })).toBe(true);
  });
});
