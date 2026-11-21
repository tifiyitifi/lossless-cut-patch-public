// eslint-disable-next-line import-js/no-extraneous-dependencies
import { describe, expect, it } from 'vitest';

import { isNoOpExport } from './noop.js';
import type { PatchExportDecision, PatchExportPlan, PatchMergedPlan } from './plan.js';

function clips(decisions: PatchExportDecision[]): PatchExportPlan {
  return {
    decisions,
    exports: [],
    renames: [],
    previousKeys: decisions.map(() => undefined),
    obsoletePaths: [],
    vacatedPaths: [],
    ownedPaths: [],
  };
}

function merged(action: PatchMergedPlan['action']): PatchMergedPlan {
  return { action, path: 'C:/out/merged.mp4' };
}

describe('isNoOpExport', () => {
  it('is a no-op when every clip is reused', () => {
    expect(isNoOpExport({ clips: clips([{ index: 0, kind: 'reuse' }, { index: 1, kind: 'reuse' }]), merged: undefined })).toBe(true);
  });

  it('is a no-op when the merged result is reused or kept as it is', () => {
    expect(isNoOpExport({ clips: clips([{ index: 0, kind: 'reuse' }]), merged: merged('reuse') })).toBe(true);
    expect(isNoOpExport({ clips: clips([{ index: 0, kind: 'reuse' }]), merged: merged('blocked') })).toBe(true);
  });

  it('is a no-op in the merged-only mode, where no clip is planned', () => {
    expect(isNoOpExport({ clips: undefined, merged: merged('reuse') })).toBe(true);
  });

  it('is not a no-op when a clip is cut or renamed', () => {
    expect(isNoOpExport({ clips: clips([{ index: 0, kind: 'reuse' }, { index: 1, kind: 'export', previous: undefined }]), merged: undefined })).toBe(false);
    expect(isNoOpExport({ clips: clips([{ index: 0, kind: 'rename', from: 'C:/out/a.mp4' }]), merged: undefined })).toBe(false);
  });

  it('is not a no-op when a result is blocked or skipped: both are reported, not "nothing to do"', () => {
    const previous = { start: 0, end: 1, path: 'C:/out/a.mp4', signature: 'x' };
    expect(isNoOpExport({
      clips: clips([{ index: 0, kind: 'blocked', previous }, { index: 1, kind: 'reuse' }]),
      merged: undefined,
    })).toBe(false);
    expect(isNoOpExport({
      clips: clips([{ index: 0, kind: 'skipped' }, { index: 1, kind: 'reuse' }]),
      merged: undefined,
    })).toBe(false);
  });

  it('is not a no-op when the merged result is rebuilt, renamed or skipped', () => {
    for (const action of ['regenerate', 'rename', 'skipped'] as const) {
      expect(isNoOpExport({ clips: clips([{ index: 0, kind: 'reuse' }]), merged: merged(action) })).toBe(false);
    }
  });

  it('never calls an export without a plan a no-op', () => {
    expect(isNoOpExport({ clips: undefined, merged: undefined })).toBe(false);
  });

  it('is not a no-op when the cut queue order changed', () => {
    // Nothing is cut, but the manifest has to record the new order - otherwise the next merge would
    // join the clips in the old one while the key looked dead.
    expect(isNoOpExport({ clips: clips([{ index: 0, kind: 'reuse' }]), merged: merged('reuse'), orderChanged: true })).toBe(false);
    expect(isNoOpExport({ clips: clips([{ index: 0, kind: 'reuse' }]), merged: undefined, orderChanged: false })).toBe(true);
  });
});
