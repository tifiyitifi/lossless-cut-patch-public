// eslint-disable-next-line import-js/no-extraneous-dependencies
import { describe, expect, it } from 'vitest';

import { buildPatchDetachAnalysisTargets, patchDetachAnalyzeScopeForKind } from './analysisScope.js';
import type { PatchDetachGridItemKind } from './grid.js';

/** Two sources with one result each, plus a result that exists in the ledger only. */
const items: { key: string; path: string; kind: PatchDetachGridItemKind; selectable: boolean }[] = [
  { key: 'source:a.mp4', path: 'a.mp4', kind: 'source', selectable: true },
  { key: 'result:a-1.mp4', path: 'a-1.mp4', kind: 'result', selectable: true },
  { key: 'source:b.mp4', path: 'b.mp4', kind: 'source', selectable: true },
  { key: 'result:b-1.mp4', path: 'b-1.mp4', kind: 'result', selectable: true },
  { key: 'result:gone.mp4', path: 'gone.mp4', kind: 'result', selectable: false },
];

const selectionOf = (keys: string[]) => ({ selected: new Set(keys) });

describe('patchDetachAnalyzeScopeForKind', () => {
  it('opens on the column whose button was clicked', () => {
    expect(patchDetachAnalyzeScopeForKind('source')).toBe('sources');
    expect(patchDetachAnalyzeScopeForKind('result')).toBe('results');
  });
});

describe('buildPatchDetachAnalysisTargets', () => {
  it('runs on the selected items of the clicked column, in visual order', () => {
    const selection = selectionOf(['result:b-1.mp4', 'source:a.mp4', 'source:b.mp4']);
    expect(buildPatchDetachAnalysisTargets({ items, selection, kind: 'source', scope: 'everything' })).toStrictEqual(['a.mp4', 'b.mp4']);
    expect(buildPatchDetachAnalysisTargets({ items, selection, kind: 'result', scope: 'everything' })).toStrictEqual(['b-1.mp4']);
  });

  it('ignores a selection in the other column and uses the scope', () => {
    const selection = selectionOf(['result:a-1.mp4']);
    expect(buildPatchDetachAnalysisTargets({ items, selection, kind: 'source', scope: 'sources' })).toStrictEqual(['a.mp4', 'b.mp4']);
    expect(buildPatchDetachAnalysisTargets({ items, selection, kind: 'source', scope: 'everything' })).toStrictEqual(['a.mp4', 'a-1.mp4', 'b.mp4', 'b-1.mp4']);
  });

  it('runs on all results when that is the scope', () => {
    expect(buildPatchDetachAnalysisTargets({ items, selection: selectionOf([]), kind: 'result', scope: 'results' })).toStrictEqual(['a-1.mp4', 'b-1.mp4']);
  });

  it('skips items that are not selectable, whatever the scope', () => {
    const paths = buildPatchDetachAnalysisTargets({ items, selection: selectionOf([]), kind: 'result', scope: 'everything' });
    expect(paths).not.toContain('gone.mp4');
  });

  it('keeps a path once when a source and a result share it', () => {
    const samePath = [
      { key: 'source:a.mp4', path: 'a.mp4', kind: 'source' as const, selectable: true },
      { key: 'result:a.mp4', path: 'a.mp4', kind: 'result' as const, selectable: true },
    ];
    expect(buildPatchDetachAnalysisTargets({ items: samePath, selection: selectionOf(['source:a.mp4', 'result:a.mp4']), kind: 'source', scope: 'everything' })).toStrictEqual(['a.mp4']);
    expect(buildPatchDetachAnalysisTargets({ items: samePath, selection: selectionOf([]), kind: 'source', scope: 'everything' })).toStrictEqual(['a.mp4']);
  });
});
