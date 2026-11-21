// eslint-disable-next-line import-js/no-extraneous-dependencies
import { describe, expect, it } from 'vitest';

import type { FinishManifestChange, PatchExportFileRecord, PatchExportManifest, PatchExportRecordPatch } from './manifest.js';
import { applyExportRecordPatch, applyFinishReportToManifest, emptyPatchExportManifest, findManifestFileKey, isSameOrder, parsePatchExportManifest, removeManifestFileRecord, updateManifestResultPath } from './manifest.js';

function record(): PatchExportFileRecord {
  return {
    signature: 'sig',
    segments: {
      a: { start: 0, end: 10, label: 'a', path: '/clips/a.mp4', signature: 'sig' },
      b: { start: 10, end: 20, label: 'b', path: '/clips/b.mp4', signature: 'sig' },
    },
  };
}

function manifest(): PatchExportManifest {
  return { version: 1, files: { '/source.mp4': record() } };
}

describe('updateManifestResultPath', () => {
  it('points a renamed segment at its new path', () => {
    const { manifest: updated, updated: didUpdate } = updateManifestResultPath(manifest(), { from: '/clips/a.mp4', to: '/clips/a-renamed.mp4' }, { caseInsensitive: false });

    expect(didUpdate).toBe(true);
    expect(updated.files['/source.mp4']?.segments['a']?.path).toBe('/clips/a-renamed.mp4');
    expect(updated.files['/source.mp4']?.segments['b']?.path).toBe('/clips/b.mp4');
  });

  it('only updates the record of the source the result belongs to', () => {
    // Two sources produced a result with the same name (their templates collided): renaming the
    // result of one source must not move the record of the other one.
    const other = { ...record(), segments: { a: { start: 0, end: 10, label: 'a', path: '/clips/a.mp4', signature: 'sig' } } };
    const withTwoSources: PatchExportManifest = { version: 1, files: { '/source.mp4': record(), '/other.mp4': other } };

    const { manifest: updated, updated: didUpdate } = updateManifestResultPath(withTwoSources, { from: '/clips/a.mp4', to: '/clips/a-renamed.mp4', sourcePath: '/source.mp4' }, { caseInsensitive: false });

    expect(didUpdate).toBe(true);
    expect(updated.files['/source.mp4']?.segments['a']?.path).toBe('/clips/a-renamed.mp4');
    expect(updated.files['/other.mp4']?.segments['a']?.path).toBe('/clips/a.mp4');
  });

  it('updates every record when the source is not known', () => {
    // The manifest does not know the source (an old work area): the result is looked up in every
    // record, as before.
    const other = { ...record(), segments: { a: { start: 0, end: 10, label: 'a', path: '/clips/a.mp4', signature: 'sig' } } };
    const withTwoSources: PatchExportManifest = { version: 1, files: { '/source.mp4': record(), '/other.mp4': other } };

    const { manifest: updated } = updateManifestResultPath(withTwoSources, { from: '/clips/a.mp4', to: '/clips/a-renamed.mp4', sourcePath: '/unknown.mp4' }, { caseInsensitive: false });

    expect(updated.files['/source.mp4']?.segments['a']?.path).toBe('/clips/a-renamed.mp4');
    expect(updated.files['/other.mp4']?.segments['a']?.path).toBe('/clips/a-renamed.mp4');
  });

  it('keeps the label when it is not given', () => {
    const { manifest: updated } = updateManifestResultPath(manifest(), { from: '/clips/a.mp4', to: '/clips/a-renamed.mp4' }, { caseInsensitive: false });

    expect(updated.files['/source.mp4']?.segments['a']?.label).toBe('a');
  });

  it('updates the label when it is given', () => {
    const { manifest: updated } = updateManifestResultPath(manifest(), { from: '/clips/a.mp4', to: '/clips/opening.mp4', label: 'opening' }, { caseInsensitive: false });

    expect(updated.files['/source.mp4']?.segments['a']?.label).toBe('opening');
  });

  it('points a renamed merged result at its new path', () => {
    const withMerged: PatchExportManifest = {
      version: 1,
      files: { '/source.mp4': { ...record(), merged: { signature: 'msig', path: '/merged/all.mp4' } } },
    };

    const { manifest: updated, updated: didUpdate } = updateManifestResultPath(withMerged, { from: '/merged/all.mp4', to: '/merged/all-renamed.mp4' }, { caseInsensitive: false });

    expect(didUpdate).toBe(true);
    expect(updated.files['/source.mp4']?.merged?.path).toBe('/merged/all-renamed.mp4');
    expect(updated.files['/source.mp4']?.merged?.signature).toBe('msig');
  });

  it('keeps the merged chapters when the merged result is renamed', () => {
    const chapters = [{ segId: 'a', start: 0, end: 5, name: 'one', segColorIndex: 1, startRank: 1, queueRank: 1 }];
    const withMerged: PatchExportManifest = {
      version: 1,
      files: { '/source.mp4': { ...record(), merged: { signature: 'msig', path: '/merged/all.mp4', chapters } } },
    };

    const { manifest: updated } = updateManifestResultPath(withMerged, { from: '/merged/all.mp4', to: '/merged/all-renamed.mp4' }, { caseInsensitive: false });

    expect(updated.files['/source.mp4']?.merged?.chapters).toStrictEqual(chapters);
  });

  it('does not change anything when the path is unknown', () => {
    const original = manifest();
    const { manifest: updated, updated: didUpdate } = updateManifestResultPath(original, { from: '/clips/unknown.mp4', to: '/clips/other.mp4' }, { caseInsensitive: false });

    expect(didUpdate).toBe(false);
    expect(updated).toBe(original);
  });

  it('does not mutate the manifest it is given', () => {
    const original = manifest();
    updateManifestResultPath(original, { from: '/clips/a.mp4', to: '/clips/a-renamed.mp4' }, { caseInsensitive: false });

    expect(original.files['/source.mp4']?.segments['a']?.path).toBe('/clips/a.mp4');
  });

  it('handles an empty manifest', () => {
    const { manifest: updated, updated: didUpdate } = updateManifestResultPath(emptyPatchExportManifest(), { from: '/clips/a.mp4', to: '/clips/b.mp4' }, { caseInsensitive: false });

    expect(didUpdate).toBe(false);
    expect(updated.files).toStrictEqual({});
  });

  it('finds a result that is spelled with other separators', () => {
    const { manifest: updated, updated: didUpdate } = updateManifestResultPath(manifest(), { from: String.raw`\clips\a.mp4`, to: '/clips/a-renamed.mp4' }, { caseInsensitive: false });

    expect(didUpdate).toBe(true);
    expect(updated.files['/source.mp4']?.segments['a']?.path).toBe('/clips/a-renamed.mp4');
  });

  it('finds a result that is spelled with another case on a case-insensitive file system', () => {
    const { manifest: updated, updated: didUpdate } = updateManifestResultPath(manifest(), { from: '/CLIPS/A.mp4', to: '/clips/a-renamed.mp4' }, { caseInsensitive: true });

    expect(didUpdate).toBe(true);
    expect(updated.files['/source.mp4']?.segments['a']?.path).toBe('/clips/a-renamed.mp4');
  });

  it('does not find a result that is spelled with another case on a case-sensitive file system', () => {
    const { manifest: updated, updated: didUpdate } = updateManifestResultPath(manifest(), { from: '/CLIPS/A.mp4', to: '/clips/a-renamed.mp4' }, { caseInsensitive: false });

    expect(didUpdate).toBe(false);
    expect(updated).toStrictEqual(manifest());
  });

  it('finds a merged result that is spelled with another case', () => {
    const withMerged: PatchExportManifest = {
      version: 1,
      files: { '/source.mp4': { ...record(), merged: { signature: 'msig', path: '/merged/all.mp4' } } },
    };

    const { manifest: updated, updated: didUpdate } = updateManifestResultPath(withMerged, { from: '/MERGED/ALL.mp4', to: '/merged/all-renamed.mp4' }, { caseInsensitive: true });

    expect(didUpdate).toBe(true);
    expect(updated.files['/source.mp4']?.merged?.path).toBe('/merged/all-renamed.mp4');
  });

  it('finds a result that is spelled with a dot segment', () => {
    const { manifest: updated, updated: didUpdate } = updateManifestResultPath(manifest(), { from: '/clips/./a.mp4', to: '/clips/a-renamed.mp4' }, { caseInsensitive: false });

    expect(didUpdate).toBe(true);
    expect(updated.files['/source.mp4']?.segments['a']?.path).toBe('/clips/a-renamed.mp4');
  });
});

describe('findManifestFileKey', () => {
  const windowsKey = String.raw`C:\Videos\source.mp4`;
  const files: Record<string, unknown> = {
    [windowsKey]: {},
    '/data/a.mp4': {},
  };

  it('finds the exact key', () => {
    expect(findManifestFileKey(files, windowsKey, { caseInsensitive: true })).toBe(windowsKey);
  });

  it('matches another spelling on a case-insensitive file system', () => {
    expect(findManifestFileKey(files, 'c:/videos/SOURCE.mp4', { caseInsensitive: true })).toBe(windowsKey);
  });

  it('still matches separators on a case-sensitive file system', () => {
    expect(findManifestFileKey(files, 'C:/Videos/source.mp4', { caseInsensitive: false })).toBe(windowsKey);
  });

  it('does not match a different case on a case-sensitive file system', () => {
    expect(findManifestFileKey(files, 'c:/videos/source.mp4', { caseInsensitive: false })).toBeUndefined();
  });

  it('returns undefined when no record matches', () => {
    expect(findManifestFileKey(files, '/other.mp4', { caseInsensitive: true })).toBeUndefined();
  });
});

describe('applyExportRecordPatch', () => {
  /** The manifest compares the paths the way the file system does. */
  const applyPatch = (fresh: PatchExportFileRecord | undefined, patch: PatchExportRecordPatch, caseInsensitive = false) => applyExportRecordPatch(fresh, patch, { caseInsensitive });

  it('replaces the segments this export wrote', () => {
    const updated = applyPatch(record(), {
      signature: 'new-sig',
      segments: {
        a: { start: 1, end: 9, label: 'a2', path: '/clips/a2.mp4', signature: 'new-sig' },
        b: { ...record().segments['b']!, signature: 'new-sig' },
      },
      replacedSegIds: ['a', 'b'],
      removedSegIds: [],
    });

    expect(updated.signature).toBe('new-sig');
    expect(updated.segments['a']).toStrictEqual({ start: 1, end: 9, label: 'a2', path: '/clips/a2.mp4', signature: 'new-sig' });
    expect(updated.segments['b']?.path).toBe('/clips/b.mp4');
  });

  it('advances the signature of the file when the export covered every result', () => {
    const updated = applyPatch(record(), {
      signature: 'new-sig',
      segments: {
        a: { ...record().segments['a']!, signature: 'new-sig' },
        b: { ...record().segments['b']!, signature: 'new-sig' },
      },
      replacedSegIds: ['a', 'b'],
      removedSegIds: [],
    });

    expect(updated.signature).toBe('new-sig');
  });

  it('keeps the signature of the file when a result was not cut again', () => {
    // The signature of the file stands for the parameters of *every* tracked result, so it may not
    // be advanced while one of them still has the content of another export.
    const updated = applyPatch(record(), {
      signature: 'new-sig',
      segments: {
        a: { ...record().segments['a']!, signature: 'new-sig' },
        b: { ...record().segments['b']! },
      },
      replacedSegIds: ['a'],
      removedSegIds: [],
    });

    expect(updated.signature).toBe('sig');
  });

  it('keeps the signature of the file when a result of an older manifest was not cut again', () => {
    // A result without a signature of its own cannot be proven to be current, so the file's
    // signature must not claim that it is.
    const older = record();
    delete older.segments['b']!.signature;

    const updated = applyPatch(older, {
      signature: 'new-sig',
      segments: {
        a: { ...older.segments['a']!, signature: 'new-sig' },
        b: { ...older.segments['b']! },
      },
      replacedSegIds: ['a'],
      removedSegIds: [],
    });

    expect(updated.signature).toBe('sig');
  });

  it('takes the signature of the export when there is no record yet', () => {
    const updated = applyPatch(undefined, {
      signature: 'new-sig',
      segments: { a: { ...record().segments['a']!, signature: 'new-sig' } },
      replacedSegIds: ['a'],
      removedSegIds: [],
    });

    expect(updated.signature).toBe('new-sig');
  });

  it('keeps a path another window renamed while the export was running', () => {
    const renamedElsewhere = record();
    renamedElsewhere.segments['a'] = { ...renamedElsewhere.segments['a']!, path: '/clips/renamed.mp4', label: 'renamed' };

    const updated = applyPatch(renamedElsewhere, {
      signature: 'new-sig',
      // The export planned this segment as a reuse under its old path.
      segments: { a: { start: 0, end: 10, label: 'a', path: '/clips/a.mp4', signature: 'sig' } },
      replacedSegIds: [],
      removedSegIds: [],
    });

    expect(updated.segments['a']?.path).toBe('/clips/renamed.mp4');
    expect(updated.segments['a']?.label).toBe('renamed');
  });

  it('keeps the signature of a result another window renamed', () => {
    const renamedElsewhere = record();
    renamedElsewhere.segments['a'] = { ...renamedElsewhere.segments['a']!, path: '/clips/renamed.mp4', signature: 'other-sig' };

    const updated = applyPatch(renamedElsewhere, {
      signature: 'new-sig',
      segments: { a: { start: 0, end: 10, label: 'a', path: '/clips/a.mp4', signature: 'sig' } },
      replacedSegIds: [],
      removedSegIds: [],
    });

    expect(updated.segments['a']?.signature).toBe('other-sig');
  });

  it('refreshes a reused record when the path did not change', () => {
    const updated = applyPatch(record(), {
      signature: 'sig',
      segments: { a: { start: 0, end: 10, label: 'new label', path: '/clips/a.mp4' } },
      replacedSegIds: [],
      removedSegIds: [],
    });

    expect(updated.segments['a']?.label).toBe('new label');
  });

  it('refreshes a reused record when the path is only spelled differently', () => {
    // The manifest knows the result as `C:\clips\a.mp4`, this export renders it as `C:/clips/a.mp4`:
    // it is the same file, so the export has the fresher label (a later label rename must use the
    // template that is in use now).
    const stored = record();
    stored.segments['a'] = { ...stored.segments['a']!, path: String.raw`C:\clips\a.mp4` };

    const updated = applyPatch(stored, {
      signature: 'sig',
      segments: { a: { start: 0, end: 10, label: 'new label', path: 'C:/clips/a.mp4' } },
      replacedSegIds: [],
      removedSegIds: [],
    });

    expect(updated.segments['a']?.label).toBe('new label');
  });

  it('refreshes a reused record when the path only differs in case', () => {
    const stored = record();
    stored.segments['a'] = { ...stored.segments['a']!, path: '/clips/A.mp4' };

    const updated = applyPatch(stored, {
      signature: 'sig',
      segments: { a: { start: 0, end: 10, label: 'new label', path: '/clips/a.mp4' } },
      replacedSegIds: [],
      removedSegIds: [],
    }, true);

    expect(updated.segments['a']?.label).toBe('new label');
  });

  it('does not refresh a reused record when the path is a different file', () => {
    const stored = record();
    stored.segments['a'] = { ...stored.segments['a']!, path: '/clips/other.mp4', label: 'other' };

    const updated = applyPatch(stored, {
      signature: 'sig',
      segments: { a: { start: 0, end: 10, label: 'new label', path: '/clips/a.mp4' } },
      replacedSegIds: [],
      removedSegIds: [],
    });

    expect(updated.segments['a']?.label).toBe('other');
  });

  it('does not resurrect a record another window removed', () => {
    const updated = applyPatch({ signature: 'sig', segments: {} }, {
      signature: 'sig',
      segments: { a: { start: 0, end: 10, path: '/clips/a.mp4' } },
      replacedSegIds: [],
      removedSegIds: [],
    });

    expect(updated.segments['a']).toBeUndefined();
  });

  it('forgets the segments a merged-only export deleted', () => {
    const updated = applyPatch(record(), {
      signature: 'sig',
      segments: record().segments,
      replacedSegIds: [],
      removedSegIds: ['a'],
    });

    expect(updated.segments['a']).toBeUndefined();
    expect(updated.segments['b']?.path).toBe('/clips/b.mp4');
  });

  it('sets a new merged result and otherwise keeps the stored one', () => {
    const withMerged = { ...record(), merged: { signature: 'old', path: '/merged/old.mp4' } };

    expect(applyPatch(withMerged, {
      signature: 'sig',
      segments: {},
      replacedSegIds: [],
      removedSegIds: [],
      merged: { signature: 'new', path: '/merged/new.mp4' },
    }).merged).toStrictEqual({ signature: 'new', path: '/merged/new.mp4' });

    expect(applyPatch(withMerged, {
      signature: 'sig',
      segments: {},
      replacedSegIds: [],
      removedSegIds: [],
    }).merged).toStrictEqual({ signature: 'old', path: '/merged/old.mp4' });
  });
});

describe('parsePatchExportManifest', () => {
  it('keeps the source color of a result', () => {
    const parsed = parsePatchExportManifest({
      version: 1,
      files: { '/source.mp4': { signature: 'sig', segments: { a: { start: 0, end: 10, path: '/clips/a.mp4', segColorIndex: 2 } } } },
    });
    expect(parsed.files['/source.mp4']?.segments['a']?.segColorIndex).toBe(2);
  });

  it('drops a result with an invalid color and keeps the rest', () => {
    const parsed = parsePatchExportManifest({
      version: 1,
      files: {
        '/source.mp4': {
          signature: 'sig',
          segments: {
            a: { start: 0, end: 10, path: '/clips/a.mp4', segColorIndex: -1 },
            b: { start: 0, end: 10, path: '/clips/b.mp4' },
          },
        },
      },
    });
    expect(parsed.files['/source.mp4']?.segments['a']).toBeUndefined();
    expect(parsed.files['/source.mp4']?.segments['b']?.path).toBe('/clips/b.mp4');
  });

  it('keeps the tail rule of a result', () => {
    const parsed = parsePatchExportManifest({
      version: 1,
      files: { '/source.mp4': { signature: 'sig', segments: { a: { start: 0, end: 10, path: '/clips/a.mp4', tail: 'end' } } } },
    });
    expect(parsed.files['/source.mp4']?.segments['a']?.tail).toBe('end');
  });

  it('drops a result with an unknown tail rule and keeps the rest', () => {
    const parsed = parsePatchExportManifest({
      version: 1,
      files: {
        '/source.mp4': {
          signature: 'sig',
          segments: {
            a: { start: 0, end: 10, path: '/clips/a.mp4', tail: 'nope' },
            b: { start: 0, end: 10, path: '/clips/b.mp4' },
          },
        },
      },
    });
    expect(parsed.files['/source.mp4']?.segments['a']).toBeUndefined();
    expect(parsed.files['/source.mp4']?.segments['b']?.path).toBe('/clips/b.mp4');
  });

  it('keeps the tail rule in the inputs the merged file was built from', () => {
    const parsed = parsePatchExportManifest({
      version: 1,
      files: {
        '/source.mp4': {
          signature: 'sig',
          segments: {},
          merged: {
            signature: 'msig',
            path: '/merged/all.mp4',
            inputs: [{ segId: 'a', start: 0, end: 5, signature: 'sig-a', tail: 'frame' }],
          },
        },
      },
    });
    expect(parsed.files['/source.mp4']?.merged?.inputs).toStrictEqual([
      { segId: 'a', start: 0, end: 5, signature: 'sig-a', tail: 'frame' },
    ]);
  });

  it('keeps the merged file chapters and their cut-queue numbers', () => {
    const parsed = parsePatchExportManifest({
      version: 1,
      files: {
        '/source.mp4': {
          signature: 'sig',
          segments: {},
          merged: {
            signature: 'msig',
            path: '/merged/all.mp4',
            chapters: [{ segId: 'a', start: 0, end: 5, name: 'one', segColorIndex: 1, startRank: 2, queueRank: 1 }],
          },
        },
      },
    });
    expect(parsed.files['/source.mp4']?.merged?.chapters).toStrictEqual([
      { segId: 'a', start: 0, end: 5, name: 'one', segColorIndex: 1, startRank: 2, queueRank: 1 },
    ]);
  });

  it('keeps the inputs the merged file was built from', () => {
    const parsed = parsePatchExportManifest({
      version: 1,
      files: {
        '/source.mp4': {
          signature: 'sig',
          segments: {},
          merged: {
            signature: 'msig',
            path: '/merged/all.mp4',
            inputs: [
              { segId: 'a', start: 0, end: 5, signature: 'sig-a' },
              { segId: 'b', start: 10, end: 20 },
            ],
          },
        },
      },
    });
    expect(parsed.files['/source.mp4']?.merged?.inputs).toStrictEqual([
      { segId: 'a', start: 0, end: 5, signature: 'sig-a' },
      { segId: 'b', start: 10, end: 20 },
    ]);
  });

  it('drops a malformed inputs list instead of half of it', () => {
    const manifestWith = (inputs: unknown) => parsePatchExportManifest({
      version: 1,
      files: {
        '/source.mp4': {
          signature: 'sig',
          segments: {},
          merged: { signature: 'msig', path: '/merged/all.mp4', inputs },
        },
      },
    }).files['/source.mp4']?.merged;

    // A list with one unreadable entry proves nothing about the merge: it is not kept at all.
    expect(manifestWith([{ segId: 'a', start: 0, end: 5 }, { segId: 'b', start: 'nope', end: 10 }]))
      .toStrictEqual({ signature: 'msig', path: '/merged/all.mp4' });
    expect(manifestWith([])).toStrictEqual({ signature: 'msig', path: '/merged/all.mp4' });
    expect(manifestWith('nope')).toStrictEqual({ signature: 'msig', path: '/merged/all.mp4' });
  });

  it('drops malformed merged chapters instead of failing the record', () => {
    const parsed = parsePatchExportManifest({
      version: 1,
      files: {
        '/source.mp4': {
          signature: 'sig',
          segments: {},
          merged: { signature: 'msig', path: '/merged/all.mp4', chapters: [{ segId: '', start: 0, end: 1 }] },
        },
      },
    });
    expect(parsed.files['/source.mp4']?.merged).toStrictEqual({ signature: 'msig', path: '/merged/all.mp4' });
  });

  it('drops a result whose end is not after its start', () => {
    const parsed = parsePatchExportManifest({
      version: 1,
      files: {
        '/source.mp4': {
          signature: 'sig',
          segments: {
            backwards: { start: 9, end: 2, path: '/clips/a.mp4' },
            empty: { start: 5, end: 5, path: '/clips/b.mp4' },
            ok: { start: 0, end: 10, path: '/clips/c.mp4' },
          },
        },
      },
    });
    expect(Object.keys(parsed.files['/source.mp4']?.segments ?? {})).toStrictEqual(['ok']);
  });
});

describe('applyFinishReportToManifest', () => {
  const change = (overrides: Partial<FinishManifestChange> = {}): FinishManifestChange => ({
    sourcePath: '/source.mp4',
    moved: [],
    deleted: [],
    ...overrides,
  });

  /** A record whose merged result was built from both results. */
  function mergedRecord(): PatchExportFileRecord {
    return {
      ...record(),
      merged: {
        signature: 'msig',
        path: '/merged/all.mp4',
        inputs: [
          { segId: 'a', start: 0, end: 10, signature: 'sig' },
          { segId: 'b', start: 10, end: 20, signature: 'sig' },
        ],
        chapters: [
          { segId: 'a', start: 0, end: 10, name: 'a', segColorIndex: 1, startRank: 1, queueRank: 1 },
          { segId: 'b', start: 10, end: 20, name: 'b', segColorIndex: 2, startRank: 2, queueRank: 2 },
        ],
      },
    };
  }

  it('moves the record to the source path the job moved the video to', () => {
    // Without this the retry would look up the record under the old path and find nothing: no merged
    // result, no cut results, only "the source video can be moved".
    const { manifest: updated, updated: didUpdate } = applyFinishReportToManifest(
      manifest(),
      change({ newSourcePath: '/finished/a.mp4', moved: [{ from: '/source.mp4', to: '/finished/a.mp4' }] }),
      { caseInsensitive: false },
    );

    expect(didUpdate).toBe(true);
    expect(updated.files['/finished/a.mp4']).toBeDefined();
    expect(updated.files['/source.mp4']).toBeUndefined();
    expect(updated.files['/finished/a.mp4']?.segments['a']?.path).toBe('/clips/a.mp4');
  });

  it('forgets a cut result the job already deleted, and the merged input that proves it', () => {
    const withMerged: PatchExportManifest = { version: 1, files: { '/source.mp4': mergedRecord() } };

    const { manifest: updated } = applyFinishReportToManifest(
      withMerged,
      change({ deleted: ['/clips/a.mp4', '/clips/a-proj.llc'] }),
      { caseInsensitive: false },
    );

    expect(updated.files['/source.mp4']?.segments['a']).toBeUndefined();
    expect(updated.files['/source.mp4']?.segments['b']?.path).toBe('/clips/b.mp4');
    // The merged file really contains `b`, so the retry may still delete it.
    expect(updated.files['/source.mp4']?.merged?.inputs).toStrictEqual([{ segId: 'b', start: 10, end: 20, signature: 'sig' }]);
    expect(updated.files['/source.mp4']?.merged?.chapters?.map((chapter) => chapter.segId)).toStrictEqual(['b']);
  });

  it('forgets a cut result the job moved out of the work area', () => {
    // The preview only ever looks at results inside `clips/`. A moved one is tracked no more; keeping
    // it would make the retry report it as missing, which blocks the job.
    const withMerged: PatchExportManifest = { version: 1, files: { '/source.mp4': mergedRecord() } };

    const { manifest: updated } = applyFinishReportToManifest(
      withMerged,
      change({ moved: [{ from: '/clips/a.mp4', to: '/detached_clips/a.mp4' }] }),
      { caseInsensitive: false },
    );

    expect(updated.files['/source.mp4']?.segments['a']).toBeUndefined();
    expect(updated.files['/source.mp4']?.merged?.inputs?.map((input) => input.segId)).toStrictEqual(['b']);
  });

  it('follows a moved merged result instead of reporting it missing', () => {
    const withMerged: PatchExportManifest = { version: 1, files: { '/source.mp4': mergedRecord() } };

    const { manifest: updated } = applyFinishReportToManifest(
      withMerged,
      change({ moved: [{ from: '/merged/all.mp4', to: '/finished_merged/all.mp4' }] }),
      { caseInsensitive: false },
    );

    expect(updated.files['/source.mp4']?.merged?.path).toBe('/finished_merged/all.mp4');
    expect(updated.files['/source.mp4']?.merged?.inputs).toHaveLength(2);
  });

  it('forgets a merged result the job deleted', () => {
    const withMerged: PatchExportManifest = { version: 1, files: { '/source.mp4': mergedRecord() } };

    const { manifest: updated } = applyFinishReportToManifest(
      withMerged,
      change({ deleted: ['/merged/all.mp4'] }),
      { caseInsensitive: false },
    );

    expect(updated.files['/source.mp4']?.merged).toBeUndefined();
    expect(updated.files['/source.mp4']?.segments['a']?.path).toBe('/clips/a.mp4');
  });

  it('drops a merged result that left the work area when the job ended', () => {
    // The job archived the merged result and kept its cut results: the work area no longer holds
    // the merged file, so the record must not point into `finished_merged` - the next `auto` would
    // open the merge dialog for a file that is gone.
    const withMerged: PatchExportManifest = { version: 1, files: { '/source.mp4': mergedRecord() } };

    const { manifest: updated } = applyFinishReportToManifest(
      withMerged,
      change({ moved: [{ from: '/merged/all.mp4', to: '/finished_merged/all.mp4' }] }),
      { caseInsensitive: false, dropMovedMerged: true },
    );

    expect(updated.files['/source.mp4']?.merged).toBeUndefined();
    expect(Object.keys(updated.files['/source.mp4']?.segments ?? {})).toStrictEqual(['a', 'b']);
  });

  it('forgets the record of a job that ended and kept nothing', () => {
    const withMerged: PatchExportManifest = { version: 1, files: { '/source.mp4': mergedRecord() } };

    const { manifest: updated, updated: didUpdate } = applyFinishReportToManifest(
      withMerged,
      change({
        newSourcePath: '/finished_src/a.mp4',
        moved: [
          { from: '/source.mp4', to: '/finished_src/a.mp4' },
          { from: '/clips/a.mp4', to: '/finished_clips/a.mp4' },
          { from: '/clips/b.mp4', to: '/finished_clips/b.mp4' },
          { from: '/merged/all.mp4', to: '/finished_merged/all.mp4' },
        ],
      }),
      { caseInsensitive: false, dropMovedMerged: true },
    );

    expect(didUpdate).toBe(true);
    expect(updated.files).toStrictEqual({});
  });

  it('keeps every result the job did not reach', () => {
    const { manifest: updated } = applyFinishReportToManifest(manifest(), change(), { caseInsensitive: false });
    expect(updated.files['/source.mp4']?.segments).toStrictEqual(record().segments);
  });

  it('leaves the manifest alone when the source is not tracked', () => {
    const before = manifest();
    const { manifest: updated, updated: didUpdate } = applyFinishReportToManifest(before, change({ sourcePath: '/unknown.mp4' }), { caseInsensitive: false });
    expect(didUpdate).toBe(false);
    expect(updated).toBe(before);
  });

  it('matches the paths the way the file system does', () => {
    const { manifest: updated } = applyFinishReportToManifest(
      manifest(),
      change({
        newSourcePath: String.raw`C:\Videos\SOURCE.mp4`,
        moved: [{ from: String.raw`C:\videos\source.mp4`, to: String.raw`C:\Videos\SOURCE.mp4` }],
        deleted: [String.raw`\clips\a.mp4`],
      }),
      { caseInsensitive: true },
    );

    expect(updated.files[String.raw`C:\Videos\SOURCE.mp4`]).toBeDefined();
    expect(updated.files[String.raw`C:\Videos\SOURCE.mp4`]?.segments['a']).toBeUndefined();
  });

  it('does not mutate the manifest it is given', () => {
    const original: PatchExportManifest = { version: 1, files: { '/source.mp4': mergedRecord() } };
    applyFinishReportToManifest(original, change({ deleted: ['/clips/a.mp4'] }), { caseInsensitive: false });

    expect(Object.keys(original.files['/source.mp4']?.segments ?? {})).toStrictEqual(['a', 'b']);
    expect(original.files['/source.mp4']?.merged?.inputs).toHaveLength(2);
  });
});

describe('removeManifestFileRecord', () => {
  it('forgets the record of the finished source, matching the path like the file system does', () => {
    const withTwoSources: PatchExportManifest = { version: 1, files: { '/source.mp4': record(), '/other.mp4': record() } };
    const { manifest: updated, removed } = removeManifestFileRecord(withTwoSources, '/SOURCE.mp4', { caseInsensitive: true });
    expect(removed).toBe(true);
    expect(Object.keys(updated.files)).toStrictEqual(['/other.mp4']);
  });

  it('leaves the manifest alone when the source is not tracked', () => {
    const before = manifest();
    expect(removeManifestFileRecord(before, '/unknown.mp4', { caseInsensitive: true })).toStrictEqual({ manifest: before, removed: false });
  });
});

describe('cut-queue order', () => {
  const parse = (order: unknown) => parsePatchExportManifest({
    version: 1,
    files: { '/source.mp4': { signature: 'sig', segments: record().segments, order } },
  });

  it('keeps the order the export recorded', () => {
    // The order is the user's cut queue, so it is not sorted again: b came before a.
    expect(parse(['b', 'a']).files['/source.mp4']?.order).toStrictEqual(['b', 'a']);
  });

  it('drops identities the record does not hold, and a repeated identity', () => {
    expect(parse(['b', 'gone', 'b', 'a']).files['/source.mp4']?.order).toStrictEqual(['b', 'a']);
  });

  it('treats an order with a malformed entry as not recorded', () => {
    // A partially readable order would silently reorder the merge: fall back to timeline order.
    expect(parse(['a', 3]).files['/source.mp4']?.order).toBeUndefined();
    expect(parse('a').files['/source.mp4']?.order).toBeUndefined();
  });

  it('leaves the order out when every identity is unknown', () => {
    expect(parse(['gone']).files['/source.mp4']?.order).toBeUndefined();
  });

  it('writes the order of this export and drops a result it no longer tracks', () => {
    const updated = applyExportRecordPatch(record(), {
      signature: 'sig',
      segments: { a: record().segments['a']! },
      replacedSegIds: [],
      removedSegIds: ['b'],
      order: ['a', 'b'],
    }, { caseInsensitive: false });

    expect(updated.order).toStrictEqual(['a']);
  });

  it('keeps the stored order when the writer does not touch it (a merge)', () => {
    const withOrder: PatchExportFileRecord = { ...record(), order: ['b', 'a'] };
    const updated = applyExportRecordPatch(withOrder, {
      signature: 'sig',
      segments: withOrder.segments,
      replacedSegIds: [],
      removedSegIds: [],
    }, { caseInsensitive: false });

    expect(updated.order).toStrictEqual(['b', 'a']);
  });

  it('clears the order when an export selected nothing', () => {
    const withOrder: PatchExportFileRecord = { ...record(), order: ['b', 'a'] };
    const updated = applyExportRecordPatch(withOrder, {
      signature: 'sig',
      segments: {},
      replacedSegIds: [],
      removedSegIds: ['a', 'b'],
      order: [],
    }, { caseInsensitive: false });

    expect(updated.order).toBeUndefined();
  });

  it('drops a result a finish job moved away from the order', () => {
    const withOrder: PatchExportFileRecord = { ...record(), order: ['b', 'a'] };
    const { manifest: updated } = applyFinishReportToManifest(
      { version: 1, files: { '/source.mp4': withOrder } },
      { sourcePath: '/source.mp4', moved: [{ from: '/clips/b.mp4', to: '/finished/b.mp4' }], deleted: [] },
      { caseInsensitive: false },
    );

    expect(updated.files['/source.mp4']?.order).toStrictEqual(['a']);
  });

  it('knows whether an export would change the order', () => {
    expect(isSameOrder(['a', 'b'], ['a', 'b'])).toBe(true);
    expect(isSameOrder(['b', 'a'], ['a', 'b'])).toBe(false);
    expect(isSameOrder(undefined, [])).toBe(true);
    // Not recorded and one identity: the export would record it, so it is a change.
    expect(isSameOrder(undefined, ['a'])).toBe(false);
  });
});
