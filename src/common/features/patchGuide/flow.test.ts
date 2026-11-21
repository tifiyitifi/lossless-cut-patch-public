// eslint-disable-next-line import-js/no-extraneous-dependencies
import { describe, expect, it } from 'vitest';

import { inferPatchFlowStage } from './flow.js';
import type { PatchFlowInput } from './flow.js';
import { patchGuideByStage, patchGuideGroupOrder } from './guide.js';

const base: PatchFlowInput = {
  hasFile: false,
  hasSegments: false,
  hasCutClips: false,
  mergePreviewActive: false,
  hasMergedOutput: false,
  isFinished: false,
};

describe('inferPatchFlowStage', () => {
  it('is no-file without a file', () => {
    expect(inferPatchFlowStage(base)).toBe('no-file');
  });

  it('is marking with a file and no segments', () => {
    expect(inferPatchFlowStage({ ...base, hasFile: true })).toBe('marking');
  });

  it('is segment-preview once segments exist', () => {
    expect(inferPatchFlowStage({ ...base, hasFile: true, hasSegments: true })).toBe('segment-preview');
  });

  it('is cut once clips exist', () => {
    expect(inferPatchFlowStage({ ...base, hasFile: true, hasSegments: true, hasCutClips: true })).toBe('cut');
  });

  it('prioritizes merge / merged / finish over cut', () => {
    expect(inferPatchFlowStage({ ...base, hasFile: true, hasCutClips: true, mergePreviewActive: true })).toBe('merge-preview');
    expect(inferPatchFlowStage({ ...base, hasFile: true, hasCutClips: true, hasMergedOutput: true })).toBe('merged');
    expect(inferPatchFlowStage({ ...base, hasFile: true, hasCutClips: true, hasMergedOutput: true, isFinished: true })).toBe('finish');
  });
});

describe('patchGuideByStage', () => {
  it('has hints for every stage', () => {
    for (const hints of Object.values(patchGuideByStage)) {
      expect(hints.length).toBeGreaterThan(0);
    }
  });

  it('never lists the same action or command twice in one stage', () => {
    for (const hints of Object.values(patchGuideByStage)) {
      const keys = hints.map((hint) => hint.action ?? hint.command);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it('only uses known groups', () => {
    for (const hints of Object.values(patchGuideByStage)) {
      for (const hint of hints) expect(patchGuideGroupOrder).toContain(hint.group);
    }
  });

  it('always offers the console, palette and settings entries', () => {
    for (const hints of Object.values(patchGuideByStage)) {
      const commands = hints.map((hint) => hint.command);
      expect(commands).toContain('console');
      expect(commands).toContain('palette');
      expect(commands).toContain('settings');
    }
  });
});
