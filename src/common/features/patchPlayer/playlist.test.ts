// eslint-disable-next-line import-js/no-extraneous-dependencies
import { describe, expect, it } from 'vitest';

import type { PatchCutResultEntry } from './playerMode.js';
import { findStepResult, getCurrentResultIndex, getShownResultPaths, isResultStillInPlaylist, parsePatchCutResults, parsePlayerPlaylistMessage, planPlaylistUpdate, replaceResultPath } from './playlist.js';

const entries: PatchCutResultEntry[] = [
  { path: '/clips/a.mp4', label: 'a' },
  { path: '/clips/b.mp4', label: 'b' },
  { path: '/clips/c.mp4' },
];

describe('parsePatchCutResults', () => {
  it('drops entries that have no path', () => {
    expect(parsePatchCutResults([{ path: '/a.mp4', label: 'a' }, { label: 'b' }, null, 'x', { path: '' }])).toStrictEqual([{ path: '/a.mp4', label: 'a' }]);
  });

  it('returns an empty playlist for anything that is not an array', () => {
    expect(parsePatchCutResults(undefined)).toStrictEqual([]);
    expect(parsePatchCutResults({ path: '/a.mp4' })).toStrictEqual([]);
  });

  it('keeps the valid chapters of a merged entry', () => {
    expect(parsePatchCutResults([{
      path: '/merged/all.mp4',
      mergedChapters: [
        { segId: 'a', start: 0, end: 10, name: 'one', segColorIndex: 2 },
        { segId: '', start: 0, end: 1, segColorIndex: 0 },
      ],
    }])).toStrictEqual([{
      path: '/merged/all.mp4',
      mergedChapters: [{ segId: 'a', start: 0, end: 10, name: 'one', segColorIndex: 2 }],
    }]);
  });

  it('keeps an entry without chapters as it is', () => {
    expect(parsePatchCutResults([{ path: '/a.mp4', label: 'a' }])).toStrictEqual([{ path: '/a.mp4', label: 'a' }]);
  });

  it('keeps the marker of a result the export cut again', () => {
    expect(parsePatchCutResults([{ path: '/a.mp4', recut: true }, { path: '/b.mp4' }])).toStrictEqual([{ path: '/a.mp4', recut: true }, { path: '/b.mp4' }]);
  });
});

describe('parsePlayerPlaylistMessage', () => {
  it('accepts the legacy bare array', () => {
    expect(parsePlayerPlaylistMessage([{ path: '/a.mp4' }])).toStrictEqual({ entries: [{ path: '/a.mp4' }] });
  });

  it('keeps a focus path that is part of the playlist', () => {
    expect(parsePlayerPlaylistMessage({ entries: [{ path: '/a.mp4' }, { path: '/b.mp4' }], focusPath: '/b.mp4' })).toStrictEqual({
      entries: [{ path: '/a.mp4' }, { path: '/b.mp4' }],
      focusPath: '/b.mp4',
    });
  });

  it('drops a focus path that is missing or not in the playlist', () => {
    expect(parsePlayerPlaylistMessage({ entries: [{ path: '/a.mp4' }], focusPath: '/gone.mp4' })).toStrictEqual({ entries: [{ path: '/a.mp4' }] });
    expect(parsePlayerPlaylistMessage({ entries: [{ path: '/a.mp4' }], focusPath: 42 })).toStrictEqual({ entries: [{ path: '/a.mp4' }] });
  });

  it('validates the entries of an object message and survives anything else', () => {
    expect(parsePlayerPlaylistMessage({ entries: [{ path: '/a.mp4' }, { label: 'b' }] })).toStrictEqual({ entries: [{ path: '/a.mp4' }] });
    expect(parsePlayerPlaylistMessage({ entries: undefined })).toStrictEqual({ entries: [] });
    expect(parsePlayerPlaylistMessage(undefined)).toStrictEqual({ entries: [] });
  });
});

describe('getCurrentResultIndex', () => {
  it('finds the playing result', () => {
    expect(getCurrentResultIndex(entries, '/clips/b.mp4')).toBe(1);
  });

  it('returns -1 when nothing is playing or the result is gone', () => {
    expect(getCurrentResultIndex(entries, undefined)).toBe(-1);
    expect(getCurrentResultIndex(entries, '/clips/d.mp4')).toBe(-1);
  });
});

describe('isResultStillInPlaylist', () => {
  it('keeps a result that is still in the new playlist', () => {
    expect(isResultStillInPlaylist(entries, '/clips/b.mp4')).toBe(true);
    expect(isResultStillInPlaylist(entries, '/clips/d.mp4')).toBe(false);
  });
});

describe('findStepResult', () => {
  it('walks the playlist without wrapping around', () => {
    expect(findStepResult(entries, '/clips/a.mp4', 'prev')).toBeUndefined();
    expect(findStepResult(entries, '/clips/a.mp4', 'next')?.path).toBe('/clips/b.mp4');
    expect(findStepResult(entries, '/clips/c.mp4', 'next')).toBeUndefined();
    expect(findStepResult(entries, '/clips/c.mp4', 'prev')?.path).toBe('/clips/b.mp4');
  });

  it('jumps to the ends', () => {
    expect(findStepResult(entries, '/clips/b.mp4', 'first')?.path).toBe('/clips/a.mp4');
    expect(findStepResult(entries, '/clips/b.mp4', 'last')?.path).toBe('/clips/c.mp4');
  });

  it('has nowhere to go from a result that is not in the playlist', () => {
    expect(findStepResult(entries, '/clips/d.mp4', 'next')).toBeUndefined();
    expect(findStepResult([], undefined, 'next')).toBeUndefined();
  });
});

describe('planPlaylistUpdate', () => {
  const playing = entries[1]!;
  const cutAgain = (paths: readonly string[]) => entries.map((entry) => (paths.includes(entry.path) ? { ...entry, recut: true } : entry));

  it('keeps the playing result when nothing was cut again', () => {
    expect(planPlaylistUpdate({ entries, current: playing, released: false })).toStrictEqual({ kind: 'keep' });
  });

  it('loads the playing result again when the export released it', () => {
    expect(planPlaylistUpdate({ entries, current: playing, released: true })).toStrictEqual({ kind: 'reload' });
  });

  it('starts from the first result when nothing is playing or the playing one is gone', () => {
    expect(planPlaylistUpdate({ entries, current: undefined, released: false })).toStrictEqual({ kind: 'open', entry: entries[0] });
    expect(planPlaylistUpdate({ entries, current: { path: '/clips/d.mp4' }, released: false })).toStrictEqual({ kind: 'open', entry: entries[0] });
  });

  it('jumps to the earliest result the export cut again, whatever is playing', () => {
    const newEntries = cutAgain(['/clips/a.mp4', '/clips/c.mp4']);
    expect(planPlaylistUpdate({ entries: newEntries, current: newEntries[2]!, released: true })).toStrictEqual({ kind: 'open', entry: newEntries[0] });
    expect(planPlaylistUpdate({ entries: newEntries, current: newEntries[2]!, released: false })).toStrictEqual({ kind: 'open', entry: newEntries[0] });
  });

  it('keeps (or reloads) the playing result when it is the earliest one cut again', () => {
    const newEntries = cutAgain(['/clips/b.mp4', '/clips/c.mp4']);
    expect(planPlaylistUpdate({ entries: newEntries, current: newEntries[1]!, released: false })).toStrictEqual({ kind: 'keep' });
    expect(planPlaylistUpdate({ entries: newEntries, current: newEntries[1]!, released: true })).toStrictEqual({ kind: 'reload' });
  });

  it('follows the playing result to the name the export gave it', () => {
    // The rename is already on disk: the path changed, the segment identity did not.
    const renamed = [{ path: '/clips/b2.mp4', label: 'b', segId: 'b' }, entries[0]!, entries[2]!];
    expect(planPlaylistUpdate({ entries: renamed, current: { path: '/clips/b.mp4', label: 'b', segId: 'b' }, released: true })).toStrictEqual({ kind: 'open', entry: renamed[0] });
  });

  it('has nothing to do for an empty playlist', () => {
    expect(planPlaylistUpdate({ entries: [], current: playing, released: true })).toStrictEqual({ kind: 'keep' });
  });
});

describe('replaceResultPath', () => {
  it('renames the path and optionally the label', () => {
    expect(replaceResultPath(entries, '/clips/a.mp4', '/clips/a2.mp4', 'a2')).toStrictEqual([
      { path: '/clips/a2.mp4', label: 'a2' },
      entries[1],
      entries[2],
    ]);
  });


  it('leaves the label alone when the rename was only a file rename', () => {
    expect(replaceResultPath(entries, '/clips/a.mp4', '/clips/a2.mp4', undefined)[0]).toStrictEqual({ path: '/clips/a2.mp4', label: 'a' });
  });

  it('does not touch the other results', () => {
    expect(replaceResultPath(entries, '/clips/x.mp4', '/clips/y.mp4', 'y')).toStrictEqual(entries);
  });
});

describe('getShownResultPaths', () => {
  it('lists the playlist and the other videos, in that order', () => {
    expect(getShownResultPaths({ entries, others: ['/clips/old.mp4'] })).toStrictEqual([
      '/clips/a.mp4', '/clips/b.mp4', '/clips/c.mp4', '/clips/old.mp4',
    ]);
  });

  it('keeps each path once (the other videos may repeat a result)', () => {
    expect(getShownResultPaths({ entries, others: ['/clips/b.mp4', '/clips/old.mp4'] })).toStrictEqual([
      '/clips/a.mp4', '/clips/b.mp4', '/clips/c.mp4', '/clips/old.mp4',
    ]);
  });

  it('works without the other videos', () => {
    expect(getShownResultPaths({ entries })).toStrictEqual(['/clips/a.mp4', '/clips/b.mp4', '/clips/c.mp4']);
    expect(getShownResultPaths({ entries: [], others: [] })).toStrictEqual([]);
  });
});
