// eslint-disable-next-line import-js/no-extraneous-dependencies
import { describe, expect, it } from 'vitest';

import type { PatchNameContext } from '../patchPlayer/playerMode.js';
import type { PatchExportFileRecord } from './manifest.js';
import { applyExportRecordPatch, emptyPatchExportManifest, parsePatchExportManifest } from './manifest.js';
import { collectOwnedClipPaths, mayReplaceMergedFile, mergeExportRecords, planIncrementalExport, planMergedExport, pruneDeletedClipRecords, resolveInheritedSignature, resolveResultNameContext, resolveResultSignatures } from './plan.js';
import type { PatchExportSegmentInput } from './plan.js';

const nameContext: PatchNameContext = {
  // eslint-disable-next-line no-template-curly-in-string
  template: '${FILENAME}${SEG_SUFFIX}${EXT}',
  outputDir: '/clips',
  context: { FILENAME: 'source', FILES: [], EXT: '.mp4', EPOCH_MS: 1 },
  emptyLabelSuffix: '',
  maxLabelLength: 100,
  safeOutputFileName: true,
};

const segments: PatchExportSegmentInput[] = [
  { segId: 'a', start: 0, end: 10, label: 'a', path: '/clips/a.mp4', nameContext },
  { segId: 'b', start: 10, end: 20, label: 'b', path: '/clips/b.mp4', nameContext },
];

function record(overrides: Partial<PatchExportFileRecord> = {}): PatchExportFileRecord {
  return {
    signature: 'sig',
    segments: {
      a: { start: 0, end: 10, label: 'a', path: '/clips/a.mp4', nameContext, signature: 'sig' },
      b: { start: 10, end: 20, label: 'b', path: '/clips/b.mp4', nameContext, signature: 'sig' },
    },
    ...overrides,
  };
}

/** A record of a manifest from before the results had a signature of their own. */
function olderRecord(overrides: Partial<PatchExportFileRecord> = {}): PatchExportFileRecord {
  const older = record();
  delete older.segments['a']!.signature;
  delete older.segments['b']!.signature;
  return { ...older, ...overrides };
}

const allExist = () => true;

function plan({ segments: segs = segments, existing = record(), exists = allExist, force = false, overwriteAllowed = false, signature = 'sig', caseInsensitivePaths = false }: {
  segments?: PatchExportSegmentInput[],
  existing?: PatchExportFileRecord | undefined,
  exists?: (path: string) => boolean,
  force?: boolean,
  overwriteAllowed?: boolean,
  signature?: string,
  caseInsensitivePaths?: boolean,
} = {}) {
  return planIncrementalExport({ segments: segs, record: existing, signature, force, overwriteAllowed, exists, caseInsensitivePaths });
}

describe('planIncrementalExport', () => {
  it('reuses unchanged results', () => {
    const result = plan();
    expect(result.decisions).toStrictEqual([{ index: 0, kind: 'reuse' }, { index: 1, kind: 'reuse' }]);
    expect(result.exports).toStrictEqual([]);
    expect(result.renames).toStrictEqual([]);
  });

  it('cuts the last result again when its tail rule changed', () => {
    const withTail = [
      segments[0]!,
      { ...segments[1]!, tail: 'end' as const },
    ];
    const result = plan({ segments: withTail });
    expect(result.decisions).toStrictEqual([
      { index: 0, kind: 'reuse' },
      { index: 1, kind: 'export', previous: record().segments['b'] },
    ]);
  });

  it('reuses the last result when its tail rule still matches', () => {
    const withTail = [
      segments[0]!,
      { ...segments[1]!, tail: 'end' as const },
    ];
    const existing = record({
      segments: {
        ...record().segments,
        b: { ...record().segments['b']!, tail: 'end' },
      },
    });
    expect(plan({ segments: withTail, existing }).decisions).toStrictEqual([{ index: 0, kind: 'reuse' }, { index: 1, kind: 'reuse' }]);
  });

  it('cuts a segment that has no record yet', () => {
    const result = plan({
      segments: [segments[0]!, { segId: 'c', start: 20, end: 30, path: '/clips/c.mp4' }],
      exists: (path) => path !== '/clips/c.mp4',
    });
    expect(result.decisions).toStrictEqual([
      { index: 0, kind: 'reuse' },
      { index: 1, kind: 'export', previous: undefined },
    ]);
    expect(result.exports).toStrictEqual([{ index: 1, previous: undefined }]);
  });

  it('skips a new segment whose name is taken by a foreign file (overwrite disabled)', () => {
    const result = plan({ segments: [segments[0]!, { segId: 'c', start: 20, end: 30, path: '/clips/c.mp4' }] });
    expect(result.decisions).toStrictEqual([
      { index: 0, kind: 'reuse' },
      { index: 1, kind: 'skipped' },
    ]);
    expect(result.exports).toStrictEqual([]);
  });

  it('renames when only the name changed', () => {
    const moved = [{ ...segments[0]!, path: '/clips/a-renamed.mp4' }];
    const result = plan({ segments: moved, exists: (path) => path !== '/clips/a-renamed.mp4' });
    expect(result.decisions).toStrictEqual([{ index: 0, kind: 'rename', from: '/clips/a.mp4' }]);
    expect(result.renames).toStrictEqual([{ from: '/clips/a.mp4', to: '/clips/a-renamed.mp4' }]);
    expect(result.exports).toStrictEqual([]);
  });

  it('regenerates when the times changed and deletes the old name afterwards', () => {
    const changed = [{ ...segments[0]!, start: 1, end: 9, path: '/clips/a-new.mp4' }];
    const result = plan({ segments: changed, exists: (path) => path === '/clips/a.mp4' });
    expect(result.decisions).toStrictEqual([{ index: 0, kind: 'export', previous: record().segments['a'] }]);
    expect(result.obsoletePaths).toStrictEqual(['/clips/a.mp4']);
  });

  it('regenerates when the export settings or the source changed', () => {
    expect(plan({ signature: 'other' }).decisions.every((decision) => decision.kind === 'export')).toBe(true);
  });

  it('does not reuse a result that was cut with other parameters', () => {
    // A partial export cut segment a with the new parameters and advanced the file record, but
    // segment b was cut earlier with the old ones: b must not look current.
    const existing: PatchExportFileRecord = {
      signature: 'new',
      segments: {
        a: { ...record().segments['a']!, signature: 'new' },
        b: { ...record().segments['b']!, signature: 'old' },
      },
    };
    const result = plan({ existing, signature: 'new', segments: [segments[1]!] });
    expect(result.decisions).toStrictEqual([{ index: 0, kind: 'export', previous: existing.segments['b'] }]);
  });

  it('reuses a result whose own parameters did not change', () => {
    // The file record belongs to another export (of another selection), but this result is
    // untouched by it.
    const result = plan({ existing: { ...record(), signature: 'other' }, signature: 'sig' });
    expect(result.decisions).toStrictEqual([{ index: 0, kind: 'reuse' }, { index: 1, kind: 'reuse' }]);
  });

  it('reuses a result of an older manifest when the file was exported as a whole', () => {
    // The file's signature is the signature of this export, so the result was cut with it.
    const result = plan({ existing: olderRecord() });
    expect(result.decisions).toStrictEqual([{ index: 0, kind: 'reuse' }, { index: 1, kind: 'reuse' }]);
  });

  it('reuses a result whose segment lost its identity', () => {
    // A reopened project carries another identity (an older project file has none at all): the
    // result is still the same file with the same times, so it is reused instead of cut again.
    const result = plan({
      segments: [{ ...segments[0]!, segId: 'new-a' }, { ...segments[1]!, segId: 'new-b' }],
    });
    expect(result.decisions).toStrictEqual([{ index: 0, kind: 'reuse' }, { index: 1, kind: 'reuse' }]);
    expect(result.exports).toStrictEqual([]);
    expect(result.previousKeys).toStrictEqual(['a', 'b']);
  });

  it('reuses a result whose times were quantized by the project file', () => {
    // A generated segment holds a full double (3600 / 7). The readable `.llc` format stores it with
    // nanosecond precision, so a reopened project parses a slightly different number. The times are
    // below FFmpeg's precision, so the result is still the same cut.
    const generated = { start: 3600 / 7, end: 7200 / 7 };
    const quantized = { start: 514.285714286, end: 1028.571428571 };
    const result = plan({
      existing: { ...record(), segments: { a: { ...record().segments['a']!, ...generated } } },
      segments: [{ ...segments[0]!, ...quantized }],
    });
    expect(result.decisions).toStrictEqual([{ index: 0, kind: 'reuse' }]);
    expect(result.exports).toStrictEqual([]);
  });

  it('adopts a quantized result when the segment lost its identity', () => {
    const generated = { start: 3600 / 7, end: 7200 / 7 };
    const quantized = { start: 514.285714286, end: 1028.571428571 };
    const result = plan({
      existing: { ...record(), segments: { a: { ...record().segments['a']!, ...generated } } },
      segments: [{ ...segments[0]!, ...quantized, segId: 'new-a' }],
    });
    expect(result.decisions).toStrictEqual([{ index: 0, kind: 'reuse' }]);
    expect(result.previousKeys).toStrictEqual(['a']);
  });

  it('still cuts when the times really changed', () => {
    const previous = { ...record().segments['a']!, start: 514.2857142857143, end: 1028.5714285714287 };
    const result = plan({
      existing: { ...record(), segments: { a: previous } },
      segments: [{ ...segments[0]!, start: 514.285715, end: 1028.571429 }],
    });
    expect(result.decisions).toStrictEqual([{ index: 0, kind: 'export', previous }]);
  });

  it('cuts again when the times changed, even without an identity', () => {
    const changed = [{ ...segments[0]!, segId: 'new-a', start: 1, end: 9, path: '/clips/a-new.mp4' }];
    const result = plan({ segments: changed, exists: (path) => path === '/clips/a.mp4' });
    expect(result.decisions).toStrictEqual([{ index: 0, kind: 'export', previous: undefined }]);
  });

  it('does not match another segment by path alone', () => {
    // The same path with other times is not the same result: without an identity the segment is
    // new, and its wanted name is taken by a file the app does not own (for this identity).
    const moved = [{ segId: 'new', start: 1, end: 9, path: '/clips/a.mp4' }];
    const result = plan({ segments: moved });
    expect(result.decisions).toStrictEqual([{ index: 0, kind: 'skipped' }]);
  });

  it('does not reuse a result of an older manifest when the file was exported with other parameters', () => {
    // The file's signature belongs to another export, so the result may have been cut with other
    // parameters: it cannot be trusted.
    const result = plan({ existing: olderRecord(), signature: 'other' });
    expect(result.decisions).toStrictEqual([
      { index: 0, kind: 'export', previous: olderRecord().segments['a'] },
      { index: 1, kind: 'export', previous: olderRecord().segments['b'] },
    ]);
  });

  it('renames a result of an older manifest instead of cutting it again', () => {
    const result = plan({
      existing: olderRecord(),
      segments: [{ ...segments[0]!, path: '/clips/a-renamed.mp4' }],
      exists: (path) => path !== '/clips/a-renamed.mp4',
    });
    expect(result.decisions).toStrictEqual([{ index: 0, kind: 'rename', from: '/clips/a.mp4' }]);
    expect(result.exports).toStrictEqual([]);
  });

  it('does not let a partial export make the results it did not cut look current', () => {
    // A partial export cut one result with other parameters. The signature of the file must not
    // claim those parameters for the result that was not cut again, or it would be reused with its
    // old content.
    const older = olderRecord();
    const partial = applyExportRecordPatch(older, {
      signature: 'new-sig',
      segments: {
        a: { ...older.segments['a']!, signature: 'new-sig' },
        b: { ...older.segments['b']! },
      },
      replacedSegIds: ['a'],
      removedSegIds: [],
    }, { caseInsensitive: false });

    expect(partial.signature).toBe('sig');

    const result = plan({ existing: partial, signature: 'new-sig' });
    expect(result.decisions[0]).toStrictEqual({ index: 0, kind: 'reuse' });
    expect(result.decisions[1]).toStrictEqual({ index: 1, kind: 'export', previous: partial.segments['b'] });
  });

  it('regenerates when the old file is gone', () => {
    expect(plan({ exists: () => false }).decisions.every((decision) => decision.kind === 'export')).toBe(true);
  });

  it('regenerates everything when forced but keeps the old files until it succeeded', () => {
    const result = plan({ force: true });
    expect(result.decisions.every((decision) => decision.kind === 'export')).toBe(true);
    expect(result.obsoletePaths).toStrictEqual([]);
  });

  it('keeps a result whose new name is taken by a foreign file (overwrite disabled)', () => {
    const moved = [{ ...segments[0]!, path: '/clips/taken.mp4' }];
    const result = plan({ segments: moved, exists: (path) => path === '/clips/a.mp4' || path === '/clips/taken.mp4' });
    expect(result.decisions).toStrictEqual([{ index: 0, kind: 'blocked', previous: record().segments['a'] }]);
    expect(result.exports).toStrictEqual([]);
  });

  it('overwrites the taken name when overwriting is allowed', () => {
    const moved = [{ ...segments[0]!, path: '/clips/taken.mp4' }];
    const result = plan({ segments: moved, exists: () => true, overwriteAllowed: true });
    expect(result.decisions).toStrictEqual([{ index: 0, kind: 'export', previous: record().segments['a'] }]);
    expect(result.obsoletePaths).toStrictEqual(['/clips/a.mp4']);
  });

  it('never deletes a path the export itself writes to', () => {
    // Two segments swap names: both targets are the other one's old path.
    const swapped = [
      { ...segments[0]!, path: '/clips/b.mp4' },
      { ...segments[1]!, path: '/clips/a.mp4' },
    ];
    const result = plan({ segments: swapped, exists: () => true, overwriteAllowed: true });
    expect(result.obsoletePaths).toStrictEqual([]);
  });

  it('renames the results that swap names instead of cutting them again', () => {
    const swapped = [
      { ...segments[0]!, path: '/clips/b.mp4' },
      { ...segments[1]!, path: '/clips/a.mp4' },
    ];
    // The temporary names are new files, so only the two results exist.
    const result = plan({ segments: swapped, exists: (path) => path === '/clips/a.mp4' || path === '/clips/b.mp4', overwriteAllowed: false });
    expect(result.decisions).toStrictEqual([
      { index: 0, kind: 'rename', from: '/clips/a.mp4' },
      { index: 1, kind: 'rename', from: '/clips/b.mp4' },
    ]);
    expect(result.exports).toStrictEqual([]);
    // Both results move to a temporary name first, so neither of them blocks the other.
    expect(result.renames).toStrictEqual([
      { from: '/clips/a.mp4', to: '/clips/a.mp4.llctmp' },
      { from: '/clips/b.mp4', to: '/clips/b.mp4.llctmp' },
      { from: '/clips/a.mp4.llctmp', to: '/clips/b.mp4' },
      { from: '/clips/b.mp4.llctmp', to: '/clips/a.mp4' },
    ]);
    expect(result.obsoletePaths).toStrictEqual([]);
  });

  it('renames the results that rotate names instead of cutting them again', () => {
    const rotated = [
      { ...segments[0]!, path: '/clips/b.mp4' },
      { ...segments[1]!, path: '/clips/c.mp4' },
      { segId: 'c', start: 20, end: 30, label: 'c', path: '/clips/a.mp4' },
    ];
    const result = plan({
      segments: rotated,
      existing: {
        signature: 'sig',
        segments: {
          ...record().segments,
          c: { start: 20, end: 30, label: 'c', path: '/clips/c.mp4', nameContext, signature: 'sig' },
        },
      },
      // The temporary names are new files, so only the three results exist.
      exists: (path) => path === '/clips/a.mp4' || path === '/clips/b.mp4' || path === '/clips/c.mp4',
      overwriteAllowed: false,
    });
    expect(result.decisions.every((decision) => decision.kind === 'rename')).toBe(true);
    expect(result.exports).toStrictEqual([]);
    expect(result.renames).toHaveLength(6);
    expect(result.obsoletePaths).toStrictEqual([]);
  });

  it('renames a result that takes the name of another result that moves away', () => {
    const moved = [
      { ...segments[0]!, path: '/clips/b.mp4' },
      { ...segments[1]!, path: '/clips/c.mp4' },
    ];
    const result = plan({
      segments: moved,
      existing: {
        signature: 'sig',
        segments: {
          a: { start: 0, end: 10, label: 'a', path: '/clips/a.mp4', nameContext, signature: 'sig' },
          b: { start: 10, end: 20, label: 'b', path: '/clips/b.mp4', nameContext, signature: 'sig' },
        },
      },
      // The temporary names are new files, so only the two results exist.
      exists: (path) => path === '/clips/a.mp4' || path === '/clips/b.mp4',
      overwriteAllowed: false,
    });
    // The first result takes the name of the second one, which moves to a free name.
    expect(result.decisions).toStrictEqual([
      { index: 0, kind: 'rename', from: '/clips/a.mp4' },
      { index: 1, kind: 'rename', from: '/clips/b.mp4' },
    ]);
    expect(result.exports).toStrictEqual([]);
  });

  it('keeps its own result when the name it wants is held by a result that stays', () => {
    const taken = [
      { ...segments[0]!, path: '/clips/b.mp4' },
      { ...segments[1]!, path: '/clips/b.mp4' },
    ];
    const result = plan({ segments: taken, exists: () => true, overwriteAllowed: true });
    // Overwriting is allowed, but the name belongs to a result this export keeps: the first
    // segment must keep its old file instead of replacing the second one.
    expect(result.decisions[0]).toStrictEqual({ index: 0, kind: 'blocked', previous: record().segments['a'] });
    expect(result.decisions[1]).toStrictEqual({ index: 1, kind: 'reuse' });
    expect(result.exports).toStrictEqual([]);
    expect(result.ownedPaths).toStrictEqual([]);
  });

  it('does not let one cut take the name of another cut', () => {
    const taken = [
      { ...segments[0]!, start: 1, end: 9, path: '/clips/shared.mp4' },
      { ...segments[1]!, start: 11, end: 19, path: '/clips/shared.mp4' },
    ];
    const result = plan({ segments: taken, exists: (path) => path === '/clips/a.mp4' || path === '/clips/b.mp4', overwriteAllowed: true });
    expect(result.decisions).toStrictEqual([
      { index: 0, kind: 'export', previous: record().segments['a'] },
      { index: 1, kind: 'blocked', previous: record().segments['b'] },
    ]);
    expect(result.exports).toStrictEqual([{ index: 0, previous: record().segments['a'] }]);
  });

  it('does not delete a new path that another segment reuses', () => {
    const result = plan({ segments: [segments[0]!], exists: (path) => path === '/clips/a.mp4' });
    expect(result.obsoletePaths).toStrictEqual([]);
    // Nothing is written, so the cutter gets nothing to overwrite.
    expect(result.ownedPaths).toStrictEqual([]);
  });

  it('only offers the cutter the results this export replaces', () => {
    // Segment a is cut again under its own name; b is reused. Only a's path may be overwritten.
    const changed = [{ ...segments[0]!, start: 1, end: 9 }, segments[1]!];
    const result = plan({ segments: changed, exists: (path) => path === '/clips/a.mp4' || path === '/clips/b.mp4' });
    expect(result.decisions).toStrictEqual([
      { index: 0, kind: 'export', previous: record().segments['a'] },
      { index: 1, kind: 'reuse' },
    ]);
    expect(result.ownedPaths).toStrictEqual(['/clips/a.mp4']);
  });

  it('reuses a result that is only spelled differently on a case-insensitive file system', () => {
    // The result was renamed to another case: it is the same file, so it is reused (and not
    // reported as a result that had to keep its old name).
    const existing: PatchExportFileRecord = {
      signature: 'sig',
      segments: { a: { ...record().segments['a']!, path: '/clips/A.mp4' } },
    };
    const result = plan({ existing, caseInsensitivePaths: true, segments: [segments[0]!] });
    expect(result.decisions).toStrictEqual([{ index: 0, kind: 'reuse' }]);
  });

  it('keeps a result whose name is only spelled differently apart', () => {
    // On a case-sensitive file system `A.mp4` and `a.mp4` are two files: the result may take the
    // name it wants.
    const existing: PatchExportFileRecord = {
      signature: 'sig',
      segments: { a: { ...record().segments['a']!, path: '/clips/A.mp4' } },
    };
    const result = plan({
      existing,
      segments: [segments[0]!],
      exists: (path) => path !== '/clips/a.mp4',
    });
    expect(result.decisions).toStrictEqual([{ index: 0, kind: 'rename', from: '/clips/A.mp4' }]);
  });

  it('does not let two results share a file on a case-insensitive file system', () => {
    const taken = [
      { ...segments[0]!, path: '/clips/A.mp4' },
      { ...segments[1]!, path: '/clips/a.mp4' },
    ];
    const result = plan({ segments: taken, caseInsensitivePaths: true, overwriteAllowed: true, exists: () => false });
    expect(result.decisions).toStrictEqual([
      { index: 0, kind: 'export', previous: record().segments['a'] },
      { index: 1, kind: 'blocked', previous: record().segments['b'] },
    ]);
    expect(result.exports).toStrictEqual([{ index: 0, previous: record().segments['a'] }]);
  });

  it('does not delete the file it just wrote when the old path is only spelled differently', () => {
    // The result was renamed to another case and its content changed: the new file is the old
    // file, so it must not be deleted afterwards.
    const existing: PatchExportFileRecord = {
      signature: 'sig',
      segments: { a: { ...record().segments['a']!, path: '/clips/A.mp4' } },
    };
    const result = plan({
      existing,
      caseInsensitivePaths: true,
      segments: [{ ...segments[0]!, start: 1, end: 9, path: '/clips/a.mp4' }],
      exists: () => true,
    });
    expect(result.decisions).toStrictEqual([{ index: 0, kind: 'export', previous: existing.segments['a'] }]);
    expect(result.obsoletePaths).toStrictEqual([]);
  });

  it('offers the cutter the path it writes to when the old result is spelled differently', () => {
    const existing: PatchExportFileRecord = {
      signature: 'sig',
      segments: { a: { ...record().segments['a']!, path: '/clips/A.mp4' } },
    };
    const result = plan({
      existing,
      caseInsensitivePaths: true,
      segments: [{ ...segments[0]!, start: 1, end: 9, path: '/clips/a.mp4' }],
      exists: () => true,
    });
    // The cutter asks about the path it writes to, so that spelling needs the permission.
    expect(result.ownedPaths).toContain('/clips/a.mp4');
  });

  it('reports the names the renames free up', () => {
    const moved = [{ ...segments[0]!, path: '/clips/a-renamed.mp4' }, segments[1]!];
    const result = plan({ segments: moved, exists: (path) => path !== '/clips/a-renamed.mp4' });
    expect(result.renames).toStrictEqual([{ from: '/clips/a.mp4', to: '/clips/a-renamed.mp4' }]);
    expect(result.vacatedPaths).toStrictEqual(['/clips/a.mp4']);
  });

  it('reports no free name when nothing is renamed', () => {
    expect(plan().vacatedPaths).toStrictEqual([]);
  });

  it('does not delete a file that another result keeps', () => {
    // Two segments recorded the same file (a result renamed in the results window while an export
    // was running writes the same path into the manifest): one of them keeps the file, the other
    // is cut again. The old file must not be deleted afterwards.
    const existing: PatchExportFileRecord = {
      signature: 'sig',
      segments: {
        a: { start: 0, end: 10, label: 'a', path: '/clips/shared.mp4', nameContext, signature: 'sig' },
        b: { start: 10, end: 20, label: 'b', path: '/clips/shared.mp4', nameContext, signature: 'sig' },
      },
    };
    const result = plan({
      existing,
      segments: [
        { ...segments[0]!, path: '/clips/shared.mp4' },
        { ...segments[1]!, start: 11, end: 19, path: '/clips/b-new.mp4' },
      ],
      exists: (path) => path === '/clips/shared.mp4',
    });
    expect(result.decisions).toStrictEqual([
      { index: 0, kind: 'reuse' },
      { index: 1, kind: 'export', previous: existing.segments['b'] },
    ]);
    expect(result.obsoletePaths).toStrictEqual([]);
  });

  it('resolves a chain of name clashes before it writes anything', () => {
    // Three results want each other's names: the chain only converges after three rounds, and no
    // cut may be written over a result that keeps its file.
    const existing: PatchExportFileRecord = {
      signature: 'sig',
      segments: {
        a: { start: 0, end: 10, label: 'a', path: '/clips/p0.mp4', nameContext, signature: 'sig' },
        b: { start: 10, end: 20, label: 'b', path: '/clips/p1.mp4', nameContext, signature: 'sig' },
        c: { start: 20, end: 30, label: 'c', path: '/clips/p2.mp4', nameContext, signature: 'sig' },
        d: { start: 30, end: 40, label: 'd', path: '/clips/keep.mp4', nameContext, signature: 'sig' },
      },
    };
    const result = plan({
      existing,
      segments: [
        { segId: 'a', start: 1, end: 9, label: 'a', path: '/clips/keep.mp4', nameContext },
        { segId: 'b', start: 11, end: 19, label: 'b', path: '/clips/p0.mp4', nameContext },
        { segId: 'c', start: 21, end: 29, label: 'c', path: '/clips/p1.mp4', nameContext },
        { segId: 'd', start: 30, end: 40, label: 'd', path: '/clips/keep.mp4', nameContext },
      ],
      exists: () => true,
      overwriteAllowed: true,
    });
    expect(result.decisions).toStrictEqual([
      { index: 0, kind: 'blocked', previous: existing.segments['a'] },
      { index: 1, kind: 'blocked', previous: existing.segments['b'] },
      { index: 2, kind: 'blocked', previous: existing.segments['c'] },
      { index: 3, kind: 'reuse' },
    ]);
    expect(result.exports).toStrictEqual([]);
    expect(result.obsoletePaths).toStrictEqual([]);
  });

  it('does not let a blocked result share a file with a result that keeps it', () => {
    // The old file of the cut result is the file another result keeps: it cannot keep it either,
    // so it is skipped instead of claiming the same file twice.
    const existing: PatchExportFileRecord = {
      signature: 'sig',
      segments: {
        a: { start: 0, end: 10, label: 'a', path: '/clips/shared.mp4', nameContext, signature: 'sig' },
        b: { start: 10, end: 20, label: 'b', path: '/clips/shared.mp4', nameContext, signature: 'sig' },
        c: { start: 20, end: 30, label: 'c', path: '/clips/taken.mp4', nameContext, signature: 'sig' },
      },
    };
    const result = plan({
      existing,
      segments: [
        { segId: 'a', start: 0, end: 10, label: 'a', path: '/clips/shared.mp4', nameContext },
        { segId: 'b', start: 11, end: 19, label: 'b', path: '/clips/taken.mp4', nameContext },
        { segId: 'c', start: 20, end: 30, label: 'c', path: '/clips/taken.mp4', nameContext },
      ],
      exists: () => true,
      overwriteAllowed: true,
    });
    expect(result.decisions).toStrictEqual([
      { index: 0, kind: 'reuse' },
      { index: 1, kind: 'skipped' },
      { index: 2, kind: 'reuse' },
    ]);
  });

  it('does not use a temporary name that is already taken', () => {
    const swapped = [
      { ...segments[0]!, path: '/clips/b.mp4' },
      { ...segments[1]!, path: '/clips/a.mp4' },
    ];
    // A crash left a temporary file behind: it must not be renamed over.
    const result = plan({
      segments: swapped,
      exists: (path) => path === '/clips/a.mp4' || path === '/clips/b.mp4' || path === '/clips/a.mp4.llctmp',
    });
    expect(result.renames).toStrictEqual([
      { from: '/clips/a.mp4', to: '/clips/a.mp4.llctmp1' },
      { from: '/clips/b.mp4', to: '/clips/b.mp4.llctmp' },
      { from: '/clips/a.mp4.llctmp1', to: '/clips/b.mp4' },
      { from: '/clips/b.mp4.llctmp', to: '/clips/a.mp4' },
    ]);
  });

  it('does not use a temporary name that another result of the batch wants', () => {
    // The second result wants the name the temporary name of the first one would be: the rename
    // would overwrite the file of the second result.
    const existing: PatchExportFileRecord = {
      signature: 'sig',
      segments: {
        a: { start: 0, end: 10, label: 'a', path: '/clips/x.mp4', nameContext, signature: 'sig' },
        b: { start: 10, end: 20, label: 'b', path: '/clips/y.mp4', nameContext, signature: 'sig' },
      },
    };
    const result = plan({
      existing,
      segments: [
        { ...segments[0]!, path: '/clips/y.mp4' },
        { ...segments[1]!, path: '/clips/x.mp4.llctmp' },
      ],
      exists: (path) => path === '/clips/x.mp4' || path === '/clips/y.mp4',
    });
    expect(result.renames).toStrictEqual([
      { from: '/clips/x.mp4', to: '/clips/x.mp4.llctmp1' },
      { from: '/clips/y.mp4', to: '/clips/y.mp4.llctmp' },
      { from: '/clips/x.mp4.llctmp1', to: '/clips/y.mp4' },
      { from: '/clips/y.mp4.llctmp', to: '/clips/x.mp4.llctmp' },
    ]);
  });

  it('does not use a temporary name that another result of the batch has', () => {
    // The second result *has* the name the temporary name of the first one would be (a template
    // that produces one): the rename would overwrite the file of the second result.
    const existing: PatchExportFileRecord = {
      signature: 'sig',
      segments: {
        a: { start: 0, end: 10, label: 'a', path: '/clips/x.mp4', nameContext, signature: 'sig' },
        b: { start: 10, end: 20, label: 'b', path: '/clips/x.mp4.llctmp', nameContext, signature: 'sig' },
      },
    };
    const result = plan({
      existing,
      segments: [
        { ...segments[0]!, path: '/clips/y.mp4' },
        { ...segments[1]!, path: '/clips/x.mp4' },
      ],
      exists: (path) => path === '/clips/x.mp4' || path === '/clips/x.mp4.llctmp',
    });
    expect(result.renames).toStrictEqual([
      { from: '/clips/x.mp4', to: '/clips/x.mp4.llctmp1' },
      { from: '/clips/x.mp4.llctmp', to: '/clips/x.mp4.llctmp.llctmp' },
      { from: '/clips/x.mp4.llctmp1', to: '/clips/y.mp4' },
      { from: '/clips/x.mp4.llctmp.llctmp', to: '/clips/x.mp4' },
    ]);
  });

  it('keeps the old names when no temporary name is free', () => {
    const swapped = [
      { ...segments[0]!, path: '/clips/b.mp4' },
      { ...segments[1]!, path: '/clips/a.mp4' },
    ];
    // Every temporary name is taken: the results keep their old names instead of being renamed
    // over a file that is already there.
    const result = plan({
      segments: swapped,
      exists: (path) => path === '/clips/a.mp4' || path === '/clips/b.mp4' || path.includes('.llctmp'),
    });
    expect(result.renames).toStrictEqual([]);
    expect(result.decisions).toStrictEqual([
      { index: 0, kind: 'blocked', previous: record().segments['a'] },
      { index: 1, kind: 'blocked', previous: record().segments['b'] },
    ]);
    expect(result.exports).toStrictEqual([]);
  });

  it('does not rename a result that shares its file with another result', () => {
    // Two segments recorded the same file: the file is one, so it cannot be renamed for one of
    // them (the other one would lose it).
    const existing: PatchExportFileRecord = {
      signature: 'sig',
      segments: {
        a: { start: 0, end: 10, label: 'a', path: '/clips/shared.mp4', nameContext, signature: 'sig' },
        b: { start: 10, end: 20, label: 'b', path: '/clips/shared.mp4', nameContext, signature: 'sig' },
      },
    };
    const result = plan({
      existing,
      segments: [
        { ...segments[0]!, path: '/clips/a-renamed.mp4' },
        { ...segments[1]!, path: '/clips/b-renamed.mp4' },
      ],
      exists: (path) => path === '/clips/shared.mp4',
    });
    expect(result.decisions).toStrictEqual([
      { index: 0, kind: 'blocked', previous: existing.segments['a'] },
      { index: 1, kind: 'blocked', previous: existing.segments['b'] },
    ]);
    expect(result.renames).toStrictEqual([]);
  });

  it('does not rename a result away from a file another result reuses', () => {
    // Two segments recorded the same file: one of them wants a new name, the other one keeps the
    // file. Renaming it would take the file away from the result that reuses it (the merge would
    // read a file that is not there any more).
    const existing: PatchExportFileRecord = {
      signature: 'sig',
      segments: {
        a: { start: 0, end: 10, label: 'a', path: '/clips/shared.mp4', nameContext, signature: 'sig' },
        b: { start: 10, end: 20, label: 'b', path: '/clips/shared.mp4', nameContext, signature: 'sig' },
      },
    };
    const result = plan({
      existing,
      segments: [
        { ...segments[0]!, path: '/clips/a-renamed.mp4' },
        { ...segments[1]!, path: '/clips/shared.mp4' },
      ],
      exists: (path) => path === '/clips/shared.mp4',
    });
    expect(result.decisions).toStrictEqual([
      { index: 0, kind: 'blocked', previous: existing.segments['a'] },
      { index: 1, kind: 'reuse' },
    ]);
    expect(result.renames).toStrictEqual([]);
    // The file is not freed, so the merge must not treat it as free either.
    expect(result.vacatedPaths).toStrictEqual([]);
  });

  it('cuts the result again when the file it shares is reused and overwriting is allowed', () => {
    const existing: PatchExportFileRecord = {
      signature: 'sig',
      segments: {
        a: { start: 0, end: 10, label: 'a', path: '/clips/shared.mp4', nameContext, signature: 'sig' },
        b: { start: 10, end: 20, label: 'b', path: '/clips/shared.mp4', nameContext, signature: 'sig' },
      },
    };
    const result = plan({
      existing,
      segments: [
        { ...segments[0]!, path: '/clips/a-renamed.mp4' },
        { ...segments[1]!, path: '/clips/shared.mp4' },
      ],
      exists: (path) => path === '/clips/shared.mp4',
      overwriteAllowed: true,
    });
    // The file cannot be moved, so the result is cut again under the name it wants.
    expect(result.decisions).toStrictEqual([
      { index: 0, kind: 'export', previous: existing.segments['a'] },
      { index: 1, kind: 'reuse' },
    ]);
    expect(result.renames).toStrictEqual([]);
    expect(result.vacatedPaths).toStrictEqual([]);
    // The file the other result keeps must not be deleted afterwards.
    expect(result.obsoletePaths).toStrictEqual([]);
  });

  it('does not let a result take the name of a file that two results share', () => {
    // The name the third result wants is the file the two other results share: the file stays
    // where it is, so the third result may not take it.
    const existing: PatchExportFileRecord = {
      signature: 'sig',
      segments: {
        a: { start: 0, end: 10, label: 'a', path: '/clips/shared.mp4', nameContext, signature: 'sig' },
        b: { start: 10, end: 20, label: 'b', path: '/clips/shared.mp4', nameContext, signature: 'sig' },
        c: { start: 20, end: 30, label: 'c', path: '/clips/c.mp4', nameContext, signature: 'sig' },
      },
    };
    const result = plan({
      existing,
      segments: [
        { ...segments[0]!, path: '/clips/a-renamed.mp4' },
        { ...segments[1]!, path: '/clips/b-renamed.mp4' },
        { segId: 'c', start: 20, end: 30, label: 'c', path: '/clips/shared.mp4' },
      ],
      exists: (path) => path === '/clips/shared.mp4' || path === '/clips/c.mp4',
    });
    expect(result.decisions).toStrictEqual([
      { index: 0, kind: 'blocked', previous: existing.segments['a'] },
      { index: 1, kind: 'blocked', previous: existing.segments['b'] },
      { index: 2, kind: 'blocked', previous: existing.segments['c'] },
    ]);
    expect(result.renames).toStrictEqual([]);
  });
});

describe('collectOwnedClipPaths', () => {
  it('owns the clips of a merged-only export', () => {
    // The merge is built from the clips, so they have to be the current ones.
    expect(collectOwnedClipPaths({ mergedOnly: true, incremental: true, segments })).toStrictEqual(['/clips/a.mp4', '/clips/b.mp4']);
  });

  it('owns no clip when the clips are the results themselves', () => {
    expect(collectOwnedClipPaths({ mergedOnly: false, incremental: true, segments })).toStrictEqual([]);
  });

  it('owns no clip in base mode', () => {
    // Without a work area the clips are ordinary output files: the user's setting decides.
    expect(collectOwnedClipPaths({ mergedOnly: true, incremental: false, segments })).toStrictEqual([]);
  });
});

describe('mayReplaceMergedFile', () => {
  it('writes the merged file when it does not exist yet', () => {
    expect(mayReplaceMergedFile({ exists: false, overwriteAllowed: false, owned: false })).toBe(true);
  });

  it('keeps an existing merged file when overwriting is disabled', () => {
    // Base mode: there is no ownership information, so the user's setting decides.
    expect(mayReplaceMergedFile({ exists: true, overwriteAllowed: false, owned: false })).toBe(false);
  });

  it('replaces an existing merged file when overwriting is allowed', () => {
    expect(mayReplaceMergedFile({ exists: true, overwriteAllowed: true, owned: false })).toBe(true);
  });

  it('replaces the merged file the app owns', () => {
    expect(mayReplaceMergedFile({ exists: true, overwriteAllowed: false, owned: true })).toBe(true);
  });
});

describe('planMergedExport', () => {
  const merged = { signature: 'merged', path: '/merged/all.mp4' };

  /** The merged planner compares paths the way the file system does. */
  function planMerged(options: Omit<Parameters<typeof planMergedExport>[0], 'caseInsensitivePaths'> & { caseInsensitivePaths?: boolean }) {
    return planMergedExport({ ...options, caseInsensitivePaths: options.caseInsensitivePaths ?? false });
  }

  it('reuses an unchanged merged file', () => {
    expect(planMerged({ path: '/merged/all.mp4', signature: 'merged', previous: merged, force: false, overwriteAllowed: false, exists: allExist }))
      .toStrictEqual({ action: 'reuse', path: '/merged/all.mp4' });
  });

  it('renames when only the merged name changed', () => {
    expect(planMerged({ path: '/merged/new.mp4', signature: 'merged', previous: merged, force: false, overwriteAllowed: false, exists: (path) => path === '/merged/all.mp4' }))
      .toStrictEqual({ action: 'rename', path: '/merged/new.mp4' });
  });

  it('rebuilds when the content or order changed', () => {
    expect(planMerged({ path: '/merged/all.mp4', signature: 'other', previous: merged, force: false, overwriteAllowed: false, exists: allExist }).action).toBe('regenerate');
    expect(planMerged({ path: '/merged/all.mp4', signature: 'merged', previous: merged, force: true, overwriteAllowed: false, exists: allExist }).action).toBe('regenerate');
  });

  it('rebuilds when the merged file is gone', () => {
    expect(planMerged({ path: '/merged/all.mp4', signature: 'merged', previous: merged, force: false, overwriteAllowed: false, exists: () => false }).action).toBe('regenerate');
  });

  it('keeps the old merged file when the new name is taken and overwriting is disabled', () => {
    expect(planMerged({ path: '/merged/taken.mp4', signature: 'merged', previous: merged, force: false, overwriteAllowed: false, exists: allExist }))
      .toStrictEqual({ action: 'blocked', path: '/merged/all.mp4' });
  });

  it('does not claim a foreign file for a first merge (overwrite disabled)', () => {
    expect(planMerged({ path: '/merged/taken.mp4', signature: 'merged', previous: undefined, force: false, overwriteAllowed: false, exists: allExist }))
      .toStrictEqual({ action: 'skipped', path: '/merged/taken.mp4' });
  });

  it('replaces the foreign file for a first merge when overwriting is allowed', () => {
    expect(planMerged({ path: '/merged/taken.mp4', signature: 'merged', previous: undefined, force: false, overwriteAllowed: true, exists: allExist }))
      .toMatchObject({ action: 'regenerate', path: '/merged/taken.mp4' });
  });

  it('keeps the old merged file when a rebuild would have to replace a foreign file', () => {
    // The merged name (and the content) changed, but the new name is taken by a file we do not own.
    expect(planMerged({ path: '/merged/taken.mp4', signature: 'other', previous: merged, force: false, overwriteAllowed: false, exists: allExist }))
      .toStrictEqual({ action: 'blocked', path: '/merged/all.mp4' });
  });

  it('does not claim a foreign file for a first merge when a rename frees the name', () => {
    // The name is taken now, but the rename of the cut results frees it before the merge is
    // written.
    expect(planMerged({ path: '/merged/all.mp4', signature: 'merged', previous: undefined, force: false, overwriteAllowed: false, exists: allExist, freePaths: ['/merged/all.mp4'] }))
      .toEqual({ action: 'regenerate', path: '/merged/all.mp4' });
  });

  it('keeps the old merged file when the name stays taken', () => {
    expect(planMerged({ path: '/merged/all.mp4', signature: 'merged', previous: undefined, force: false, overwriteAllowed: false, exists: allExist, freePaths: ['/merged/other.mp4'] }))
      .toStrictEqual({ action: 'skipped', path: '/merged/all.mp4' });
  });

  it('reuses a merged file that is only spelled differently on a case-insensitive file system', () => {
    expect(planMerged({ path: '/MERGED/ALL.mp4', signature: 'merged', previous: merged, force: false, overwriteAllowed: false, exists: allExist, caseInsensitivePaths: true }))
      .toStrictEqual({ action: 'reuse', path: '/MERGED/ALL.mp4' });
  });

  it('does not report a merged file that is only respelled as obsolete', () => {
    const result = planMerged({ path: '/MERGED/ALL.mp4', signature: 'other', previous: merged, force: false, overwriteAllowed: false, exists: allExist, caseInsensitivePaths: true });
    expect(result.obsoletePath).toBeUndefined();
  });
});

describe('pruneDeletedClipRecords', () => {
  it('drops the record of a clip that was deleted', () => {
    const result = pruneDeletedClipRecords({
      records: record().segments,
      segments,
      deletedPaths: ['/clips/a.mp4'],
      caseInsensitivePaths: false,
    });
    expect(result.removedSegIds).toStrictEqual(['a']);
    expect(result.records['a']).toBeUndefined();
    expect(result.records['b']).toStrictEqual({ start: 10, end: 20, label: 'b', path: '/clips/b.mp4', nameContext, signature: 'sig' });
  });

  it('keeps the record of a clip that is still there', () => {
    const result = pruneDeletedClipRecords({
      records: record().segments,
      segments,
      deletedPaths: [],
      caseInsensitivePaths: false,
    });
    expect(result.removedSegIds).toStrictEqual([]);
    expect(Object.keys(result.records)).toStrictEqual(['a', 'b']);
  });

  it('compares the paths the way the file system does', () => {
    const result = pruneDeletedClipRecords({
      records: record().segments,
      segments,
      deletedPaths: ['/CLIPS/A.MP4'],
      caseInsensitivePaths: true,
    });
    expect(result.removedSegIds).toStrictEqual(['a']);
  });

  it('keeps the records of the segments that are not part of this export', () => {
    const result = pruneDeletedClipRecords({
      records: { ...record().segments, old: { start: 30, end: 40, path: '/clips/old.mp4', signature: 'sig' } },
      segments,
      deletedPaths: ['/clips/old.mp4'],
      caseInsensitivePaths: false,
    });
    expect(result.removedSegIds).toStrictEqual([]);
    expect(result.records['old']).toStrictEqual({ start: 30, end: 40, path: '/clips/old.mp4', signature: 'sig' });
  });
});

describe('mergeExportRecords', () => {
  it('retains records that are not part of this export', () => {
    const { records } = mergeExportRecords({
      previousSegments: { ...record().segments, old: { start: 30, end: 40, path: '/clips/old.mp4', signature: 'sig' } },
      segments: [segments[0]!],
      decisions: [{ index: 0, kind: 'reuse' }],
      createdIndices: new Set(),
      signature: 'sig',
    });
    expect(records['old']).toStrictEqual({ start: 30, end: 40, path: '/clips/old.mp4', signature: 'sig' });
  });

  it('keeps the name context of a reused result and updates its label', () => {
    const { records } = mergeExportRecords({
      previousSegments: record().segments,
      segments: [{ ...segments[0]!, label: 'new label' }],
      decisions: [{ index: 0, kind: 'reuse' }],
      createdIndices: new Set(),
      signature: 'sig',
    });
    expect(records['a']).toStrictEqual({ start: 0, end: 10, label: 'new label', path: '/clips/a.mp4', nameContext, signature: 'sig' });
  });

  it('refreshes the name context of a reused result when the template changed', () => {
    // eslint-disable-next-line no-template-curly-in-string
    const changedContext: PatchNameContext = { ...nameContext, outputDir: '/other', template: '${FILENAME}-x${EXT}' };
    const { records } = mergeExportRecords({
      previousSegments: record().segments,
      segments: [{ ...segments[0]!, nameContext: changedContext }],
      decisions: [{ index: 0, kind: 'reuse' }],
      createdIndices: new Set(),
      signature: 'sig',
    });
    expect(records['a']?.nameContext).toStrictEqual(changedContext);
    expect(records['a']?.path).toBe('/clips/a.mp4');
  });

  it('records the tail rule of a renamed result', () => {
    const { records } = mergeExportRecords({
      previousSegments: record().segments,
      segments: [{ ...segments[0]!, path: '/clips/a2.mp4', tail: 'end' }],
      decisions: [{ index: 0, kind: 'rename', from: '/clips/a.mp4' }],
      createdIndices: new Set(),
      signature: 'sig',
    });
    expect(records['a']?.tail).toBe('end');
  });

  it('records the tail rule of a cut result', () => {
    const { records } = mergeExportRecords({
      previousSegments: record().segments,
      segments: [{ ...segments[1]!, tail: 'frame' }],
      decisions: [{ index: 0, kind: 'export', previous: record().segments['b'] }],
      createdIndices: new Set([0]),
      signature: 'sig',
    });
    expect(records['b']?.tail).toBe('frame');
  });

  it('records a renamed result under its new path', () => {
    const { records } = mergeExportRecords({
      previousSegments: record().segments,
      segments: [{ ...segments[0]!, path: '/clips/a2.mp4' }],
      decisions: [{ index: 0, kind: 'rename', from: '/clips/a.mp4' }],
      createdIndices: new Set(),
      signature: 'sig',
    });
    expect(records['a']).toStrictEqual({ start: 0, end: 10, label: 'a', path: '/clips/a2.mp4', nameContext, signature: 'sig' });
  });

  it('records a cut that was created', () => {
    const { records } = mergeExportRecords({
      previousSegments: {},
      segments: [segments[0]!],
      decisions: [{ index: 0, kind: 'export', previous: undefined }],
      createdIndices: new Set([0]),
      signature: 'new-sig',
    });
    expect(records['a']).toStrictEqual({ start: 0, end: 10, label: 'a', path: '/clips/a.mp4', nameContext, signature: 'new-sig' });
  });

  it('does not adopt a file the cutter skipped', () => {
    const { records } = mergeExportRecords({
      previousSegments: {},
      segments: [segments[0]!],
      decisions: [{ index: 0, kind: 'export', previous: undefined }],
      createdIndices: new Set(),
      signature: 'new-sig',
    });
    expect(records['a']).toBeUndefined();
  });

  it('keeps the previous record when a regeneration was skipped', () => {
    const previous = record().segments['a']!;
    const { records } = mergeExportRecords({
      previousSegments: record().segments,
      segments: [{ ...segments[0]!, start: 1, end: 9 }],
      decisions: [{ index: 0, kind: 'export', previous }],
      createdIndices: new Set(),
      signature: 'new-sig',
    });
    expect(records['a']).toStrictEqual(previous);
  });

  it('keeps the previous record when the rename was blocked', () => {
    const previous = record().segments['a']!;
    const { records } = mergeExportRecords({
      previousSegments: record().segments,
      segments: [{ ...segments[0]!, path: '/clips/taken.mp4' }],
      decisions: [{ index: 0, kind: 'blocked', previous }],
      createdIndices: new Set(),
      signature: 'new-sig',
    });
    expect(records['a']).toStrictEqual(previous);
  });

  it('does not record a skipped segment', () => {
    const { records } = mergeExportRecords({
      previousSegments: {},
      segments: [{ segId: 'c', start: 20, end: 30, path: '/clips/c.mp4' }],
      decisions: [{ index: 0, kind: 'skipped' }],
      createdIndices: new Set(),
      signature: 'sig',
    });
    expect(records).toStrictEqual({});
  });

  it('keeps the old signature of a result that was not cut again', () => {
    // A blocked result keeps its old content, so it must keep its old signature: otherwise the
    // next export would treat it as current.
    const previous = { ...record().segments['a']!, signature: 'old-sig' };
    const { records } = mergeExportRecords({
      previousSegments: { a: previous },
      segments: [segments[0]!],
      decisions: [{ index: 0, kind: 'blocked', previous }],
      createdIndices: new Set(),
      signature: 'new-sig',
    });
    expect(records['a']?.signature).toBe('old-sig');
  });

  it('stamps the signature of the export on a reused result of an older manifest', () => {
    // A reuse says "the content is the one of this export", so the result learns the signature and
    // does not need the fallback of the file's signature any more.
    const previous = { start: 0, end: 10, label: 'a', path: '/clips/a.mp4', nameContext };
    const { records } = mergeExportRecords({
      previousSegments: { a: previous },
      segments: [segments[0]!],
      decisions: [{ index: 0, kind: 'reuse' }],
      createdIndices: new Set(),
      signature: 'sig',
    });
    expect(records['a']?.signature).toBe('sig');
  });

  it('stamps the signature of the export on a renamed result of an older manifest', () => {
    const previous = { start: 0, end: 10, label: 'a', path: '/clips/a.mp4', nameContext };
    const { records } = mergeExportRecords({
      previousSegments: { a: previous },
      segments: [{ ...segments[0]!, path: '/clips/a2.mp4' }],
      decisions: [{ index: 0, kind: 'rename', from: '/clips/a.mp4' }],
      createdIndices: new Set(),
      signature: 'sig',
    });
    expect(records['a']?.signature).toBe('sig');
  });

  it('keeps a result of an older manifest that was not cut again without a signature', () => {
    // A blocked result keeps its old content, which cannot be proven to be the one of this export.
    const previous = { start: 0, end: 10, label: 'a', path: '/clips/a.mp4', nameContext };
    const { records } = mergeExportRecords({
      previousSegments: { a: previous },
      segments: [{ ...segments[0]!, path: '/clips/taken.mp4' }],
      decisions: [{ index: 0, kind: 'blocked', previous }],
      createdIndices: new Set(),
      signature: 'sig',
    });
    expect(records['a']?.signature).toBeUndefined();
  });

  it('drops the old identity a reopened segment was adopted from', () => {
    // The segment lost its identity, so its record moved to the new one: the old key must not stay
    // behind as a second record of the same file.
    const { records, removedSegIds } = mergeExportRecords({
      previousSegments: { 'old-a': { start: 0, end: 10, label: 'a', path: '/clips/a.mp4', nameContext, signature: 'sig' } },
      segments: [{ ...segments[0]!, segId: 'new-a' }],
      decisions: [{ index: 0, kind: 'reuse' }],
      createdIndices: new Set(),
      signature: 'sig',
      previousKeys: ['old-a'],
    });
    expect(records['new-a']).toMatchObject({ start: 0, end: 10, path: '/clips/a.mp4' });
    expect(records['old-a']).toBeUndefined();
    expect(removedSegIds).toStrictEqual(['old-a']);
  });

  it('drops the old identity when the project file quantized the times', () => {
    // The record is adopted under the new identity, but the new record holds the times the project
    // file parsed back (not the exact doubles of the original export). The old record is still the
    // same result, so it must not stay behind as a second record.
    const { records, removedSegIds } = mergeExportRecords({
      previousSegments: { 'old-a': { start: 3600 / 7, end: 7200 / 7, path: '/clips/a.mp4', signature: 'sig' } },
      segments: [{ segId: 'new-a', start: 514.285714286, end: 1028.571428571, path: '/clips/a.mp4' }],
      decisions: [{ index: 0, kind: 'export', previous: undefined }],
      createdIndices: new Set([0]),
      signature: 'sig',
      previousKeys: ['old-a'],
    });
    expect(records['new-a']).toMatchObject({ start: 514.285714286, end: 1028.571428571 });
    expect(records['old-a']).toBeUndefined();
    expect(removedSegIds).toStrictEqual(['old-a']);
  });

  it('keeps a retained record that only shares the path', () => {
    // A record that is not part of this export stays, even when its path matches: only an exact
    // duplicate (same path and times) of a record of this export is a stale identity.
    const { records } = mergeExportRecords({
      previousSegments: { ...record().segments, old: { start: 30, end: 40, path: '/clips/a.mp4', signature: 'sig' } },
      segments: [segments[0]!],
      decisions: [{ index: 0, kind: 'reuse' }],
      createdIndices: new Set(),
      signature: 'sig',
    });
    expect(records['old']).toStrictEqual({ start: 30, end: 40, path: '/clips/a.mp4', signature: 'sig' });
  });

  it('drops a stale identity however the path is spelled', () => {
    const { records, removedSegIds } = mergeExportRecords({
      previousSegments: { 'old-a': { start: 0, end: 10, path: '/clips/A.mp4', signature: 'sig' } },
      segments: [{ ...segments[0]!, segId: 'new-a' }],
      decisions: [{ index: 0, kind: 'reuse' }],
      createdIndices: new Set(),
      signature: 'sig',
      previousKeys: ['old-a'],
      caseInsensitivePaths: true,
    });
    expect(records['new-a']).toBeDefined();
    expect(records['old-a']).toBeUndefined();
    expect(removedSegIds).toStrictEqual(['old-a']);
  });

  it('carries the source color into a fresh record', () => {
    const { records } = mergeExportRecords({
      previousSegments: {},
      segments: [{ ...segments[0]!, segColorIndex: 2 }],
      decisions: [{ index: 0, kind: 'export', previous: undefined }],
      createdIndices: new Set([0]),
      signature: 'sig',
    });
    expect(records['a']?.segColorIndex).toBe(2);
  });

  it('refreshes the color of a reused record', () => {
    const { records } = mergeExportRecords({
      previousSegments: { a: { start: 0, end: 10, path: '/clips/a.mp4', signature: 'sig', segColorIndex: 1 } },
      segments: [{ ...segments[0]!, segColorIndex: 2 }],
      decisions: [{ index: 0, kind: 'reuse' }],
      createdIndices: new Set(),
      signature: 'sig',
    });
    expect(records['a']?.segColorIndex).toBe(2);
  });
});

describe('resolveInheritedSignature', () => {
  it('lets a result inherit the file signature when it is the signature of this export', () => {
    expect(resolveInheritedSignature({ record: record(), signature: 'sig' })).toBe('sig');
  });

  it('does not let it inherit the signature of another export', () => {
    expect(resolveInheritedSignature({ record: record(), signature: 'other' })).toBeUndefined();
  });

  it('has nothing to inherit without a record', () => {
    expect(resolveInheritedSignature({ record: undefined, signature: 'sig' })).toBeUndefined();
  });
});

describe('resolveResultNameContext', () => {
  it('uses the template that is in use now', () => {
    // eslint-disable-next-line no-template-curly-in-string
    const current: PatchNameContext = { ...nameContext, template: '${FILENAME}-now${EXT}' };
    expect(resolveResultNameContext({ current, previous: nameContext })).toBe(current);
  });

  it('falls back to the template the result was cut with', () => {
    expect(resolveResultNameContext({ current: undefined, previous: nameContext })).toBe(nameContext);
  });

  it('has no template when neither side has one', () => {
    expect(resolveResultNameContext({ current: undefined, previous: undefined })).toBeUndefined();
  });
});

describe('resolveResultSignatures', () => {
  it('gives every cut result the signature of this export', () => {
    const signatures = resolveResultSignatures({
      decisions: [{ index: 0, kind: 'export', previous: undefined }, { index: 1, kind: 'reuse' }],
      signature: 'new-sig',
    });
    expect(signatures).toStrictEqual(['new-sig', 'new-sig']);
  });

  it('keeps the old signature of a result that could not be cut', () => {
    const previous = { ...record().segments['a']!, signature: 'old-sig' };
    const signatures = resolveResultSignatures({
      decisions: [{ index: 0, kind: 'blocked', previous }],
      signature: 'new-sig',
    });
    expect(signatures).toStrictEqual(['old-sig']);
  });

  it('has no signature for a segment that produced no result', () => {
    const signatures = resolveResultSignatures({
      decisions: [{ index: 0, kind: 'skipped' }],
      signature: 'new-sig',
    });
    expect(signatures).toStrictEqual([undefined]);
  });

  it('gives a result that inherits the file signature the signature of this export', () => {
    // A blocked result of an older manifest: its content is the one of the export the file's
    // signature stands for, so the merged file does not have to be rebuilt for it.
    const previous = { start: 0, end: 10, label: 'a', path: '/clips/a.mp4' };
    const signatures = resolveResultSignatures({
      decisions: [{ index: 0, kind: 'blocked', previous }],
      signature: 'new-sig',
      inheritedSignature: 'new-sig',
    });
    expect(signatures).toStrictEqual(['new-sig']);
  });

  it('gives a blocked result of an older manifest no signature when nothing can be inherited', () => {
    const previous = { start: 0, end: 10, label: 'a', path: '/clips/a.mp4' };
    const signatures = resolveResultSignatures({
      decisions: [{ index: 0, kind: 'blocked', previous }],
      signature: 'new-sig',
    });
    expect(signatures).toStrictEqual([undefined]);
  });

  it('keeps the old signature of a cut that did not write the file', () => {
    // The cutter skipped the file (its name was taken by a file the app does not own): the old
    // content is still there, so the result must not claim the signature of this export.
    const previous = { ...record().segments['a']!, signature: 'old-sig' };
    const signatures = resolveResultSignatures({
      decisions: [{ index: 0, kind: 'export', previous }],
      signature: 'new-sig',
      createdIndices: new Set<number>(),
    });
    expect(signatures).toStrictEqual(['old-sig']);
  });

  it('gives the signature of this export to a cut that wrote the file', () => {
    const previous = { ...record().segments['a']!, signature: 'old-sig' };
    const signatures = resolveResultSignatures({
      decisions: [{ index: 0, kind: 'export', previous }],
      signature: 'new-sig',
      createdIndices: new Set([0]),
    });
    expect(signatures).toStrictEqual(['new-sig']);
  });
});

describe('parsePatchExportManifest', () => {
  it('round-trips a valid manifest', () => {
    const manifest = { version: 1 as const, files: { '/source.mp4': record() } };
    expect(parsePatchExportManifest(manifest)).toEqual(manifest);
  });

  it('falls back to an empty manifest for garbage', () => {
    expect(parsePatchExportManifest(undefined)).toStrictEqual(emptyPatchExportManifest());
    expect(parsePatchExportManifest({ version: 2, files: {} })).toStrictEqual(emptyPatchExportManifest());
    expect(parsePatchExportManifest('nope')).toStrictEqual(emptyPatchExportManifest());
  });

  it('drops malformed records but keeps the valid ones', () => {
    const parsed = parsePatchExportManifest({
      version: 1,
      files: {
        '/source.mp4': {
          signature: 'sig',
          segments: {
            good: { start: 0, end: 1, path: '/clips/good.mp4' },
            noPath: { start: 0, end: 1 },
            badTimes: { start: 'x', end: 1, path: '/clips/x.mp4' },
          },
        },
        '/broken.mp4': { signature: 'sig' },
      },
    });
    expect(Object.keys(parsed.files)).toStrictEqual(['/source.mp4']);
    expect(Object.keys(parsed.files['/source.mp4']!.segments)).toStrictEqual(['good']);
  });

  it('keeps the signature of a result and accepts an older record without one', () => {
    const parsed = parsePatchExportManifest({
      version: 1,
      files: {
        '/source.mp4': {
          signature: 'sig',
          segments: {
            current: { start: 0, end: 1, path: '/clips/current.mp4', signature: 'seg-sig' },
            older: { start: 1, end: 2, path: '/clips/older.mp4' },
          },
        },
      },
    });
    const { segments: parsedSegments } = parsed.files['/source.mp4']!;
    expect(parsedSegments['current']?.signature).toBe('seg-sig');
    expect(parsedSegments['older']?.signature).toBeUndefined();
  });
});
