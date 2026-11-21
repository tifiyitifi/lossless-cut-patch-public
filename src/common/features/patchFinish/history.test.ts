// eslint-disable-next-line import-js/no-extraneous-dependencies
import { describe, expect, it } from 'vitest';

import { addWorkRoot, emptyPatchWorkHistory, parsePatchWorkHistory, sortWorkRoots } from './history.js';

const caseInsensitive = { caseInsensitive: true };

describe('addWorkRoot', () => {
  it('adds a root and keeps the newest first', () => {
    let history = addWorkRoot(emptyPatchWorkHistory(), 'C:/a', 100, caseInsensitive);
    history = addWorkRoot(history, 'C:/b', 200, caseInsensitive);
    expect(history.roots.map((entry) => entry.root)).toStrictEqual(['C:/b', 'C:/a']);
  });

  it('updates an existing root instead of duplicating it (case-insensitively)', () => {
    let history = addWorkRoot(emptyPatchWorkHistory(), String.raw`C:\work\a`, 100, caseInsensitive);
    history = addWorkRoot(history, 'C:/WORK/A/', 200, caseInsensitive);
    expect(history.roots).toStrictEqual([{ root: 'C:/WORK/A', lastUsed: 200 }]);
  });

  it('keeps at most `max` roots, dropping the oldest', () => {
    let history = emptyPatchWorkHistory();
    for (let index = 0; index < 5; index += 1) history = addWorkRoot(history, `C:/r${index}`, index, { caseInsensitive: true, max: 3 });
    expect(history.roots.map((entry) => entry.root)).toStrictEqual(['C:/r4', 'C:/r3', 'C:/r2']);
  });

  it('ignores empty and filesystem-root entries', () => {
    const history = emptyPatchWorkHistory();
    expect(addWorkRoot(history, ' '.repeat(3), 1, caseInsensitive)).toBe(history);
    expect(addWorkRoot(history, '/', 1, caseInsensitive)).toBe(history);
    expect(addWorkRoot(history, '.', 1, caseInsensitive)).toBe(history);
  });
});

describe('parsePatchWorkHistory', () => {
  it('drops malformed entries', () => {
    const history = parsePatchWorkHistory({
      version: 1,
      roots: [
        { root: 'C:/a', lastUsed: 2 },
        { root: '', lastUsed: 2 },
        { root: 'C:/b' },
        { root: 'C:/c', lastUsed: 'x' },
        'nope',
      ],
    });
    expect(history.roots).toStrictEqual([{ root: 'C:/a', lastUsed: 2 }]);
  });

  it('returns an empty history for anything unreadable', () => {
    expect(parsePatchWorkHistory(undefined).roots).toStrictEqual([]);
    expect(parsePatchWorkHistory({ version: 2, roots: [] }).roots).toStrictEqual([]);
  });
});

describe('sortWorkRoots', () => {
  it('sorts newest first and breaks ties by path', () => {
    expect(sortWorkRoots([
      { root: 'C:/b', lastUsed: 1 },
      { root: 'C:/a', lastUsed: 1 },
      { root: 'C:/c', lastUsed: 2 },
    ]).map((entry) => entry.root)).toStrictEqual(['C:/c', 'C:/a', 'C:/b']);
  });
});
