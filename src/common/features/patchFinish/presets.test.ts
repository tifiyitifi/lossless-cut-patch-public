// eslint-disable-next-line import-js/no-extraneous-dependencies
import { describe, expect, it } from 'vitest';

import type { PatchFinishCutOptions, PatchFinishMergeOptions } from './options.js';
import { defaultPatchFinishCutOptions, defaultPatchFinishMergeOptions } from './options.js';
import { resolveFinishPreset, resolvePresetOptions } from './presets.js';

const mergeOptions = (overrides: Partial<PatchFinishMergeOptions> = {}): PatchFinishMergeOptions => ({
  ...defaultPatchFinishMergeOptions,
  ...overrides,
});

const cutOptions = (overrides: Partial<PatchFinishCutOptions> = {}): PatchFinishCutOptions => ({
  ...defaultPatchFinishCutOptions,
  ...overrides,
});

describe('resolvePresetOptions', () => {
  it('moves on to the next video in the one-video preset', () => {
    expect(resolvePresetOptions({ preset: 'one-video', mode: 'merge', options: mergeOptions(), mergedCoversClips: true })).toStrictEqual({
      source: 'detached',
      projectFile: 'install-llc',
      projectDir: undefined,
      projectDateGrouping: 'ym',
      merged: 'finished',
      clips: 'delete',
      deleteStaleClips: true,
      next: 'next',
      workDir: 'keep',
    });
  });

  it('keeps the video, its project file and the cut results in the loop preset', () => {
    // The job ends, but the work area keeps everything the next pass builds on: only the merged
    // result leaves (it is the finished product).
    const resolved = resolvePresetOptions({ preset: 'loop-video', mode: 'merge', options: mergeOptions(), mergedCoversClips: true });
    expect(resolved).toMatchObject({ source: 'keep', projectFile: 'keep', merged: 'finished', clips: 'keep', next: 'none', workDir: 'keep' });
  });

  it('keeps the source in the finished folder in the archive preset', () => {
    expect(resolvePresetOptions({ preset: 'archive', mode: 'merge', options: mergeOptions(), mergedCoversClips: true })).toMatchObject({
      source: 'finished', projectFile: 'install-llc', merged: 'finished', clips: 'delete', next: 'next', workDir: 'keep',
    });
    expect(resolvePresetOptions({ preset: 'archive', mode: 'cut', options: cutOptions(), mergedCoversClips: true })).toMatchObject({
      source: 'finished', projectFile: 'install-llc', clips: 'finished', mergedResult: 'finished', next: 'next', workDir: 'keep',
    });
  });

  it('moves the source to the skipped-sources folder in the skip preset', () => {
    expect(resolvePresetOptions({ preset: 'skip', mode: 'merge', options: mergeOptions(), mergedCoversClips: true })).toMatchObject({
      source: 'skip', projectFile: 'install-llc', merged: 'finished', clips: 'delete', next: 'next', workDir: 'keep',
    });
    expect(resolvePresetOptions({ preset: 'skip', mode: 'cut', options: cutOptions(), mergedCoversClips: true })).toMatchObject({
      source: 'skip', projectFile: 'install-llc', clips: 'finished', mergedResult: 'finished', next: 'next', workDir: 'keep',
    });
  });

  it('sets the cut-mode fields too, so the same preset works without a merge', () => {
    expect(resolvePresetOptions({ preset: 'one-video', mode: 'cut', options: cutOptions(), mergedCoversClips: true })).toMatchObject({
      source: 'detached', projectFile: 'install-llc', clips: 'finished', mergedResult: 'finished', next: 'next', workDir: 'keep',
    });
    expect(resolvePresetOptions({ preset: 'loop-video', mode: 'cut', options: cutOptions(), mergedCoversClips: true })).toMatchObject({
      source: 'keep', projectFile: 'keep', clips: 'finished', mergedResult: 'finished', next: 'none', workDir: 'keep',
    });
  });

  it('keeps the cut results aside instead of deleting them when the merge does not cover them', () => {
    expect(resolvePresetOptions({ preset: 'one-video', mode: 'merge', options: mergeOptions(), mergedCoversClips: false })).toMatchObject({ clips: 'detached' });
    expect(resolvePresetOptions({ preset: 'archive', mode: 'merge', options: mergeOptions(), mergedCoversClips: false })).toMatchObject({ clips: 'detached' });
    // A preset that keeps them needs no downgrade: keeping is always safe.
    expect(resolvePresetOptions({ preset: 'loop-video', mode: 'merge', options: mergeOptions(), mergedCoversClips: false })).toMatchObject({ clips: 'keep' });
  });

  it('drops a folder picked for an earlier custom choice', () => {
    const resolved = resolvePresetOptions({
      preset: 'one-video', mode: 'merge', options: mergeOptions({ projectFile: 'custom', projectDir: 'D:/llc' }), mergedCoversClips: true,
    });
    expect(resolved.projectFile).toBe('install-llc');
    expect(resolved.projectDir).toBeUndefined();
  });

  it('keeps the date grouping the user set', () => {
    expect(resolvePresetOptions({ preset: 'one-video', mode: 'merge', options: mergeOptions({ projectDateGrouping: 'ymd' }), mergedCoversClips: true }).projectDateGrouping).toBe('ymd');
  });

  it('uses the app data folder when the installation folder cannot be written', () => {
    const mergeResolved = resolvePresetOptions({ preset: 'one-video', mode: 'merge', options: mergeOptions(), mergedCoversClips: true, installLlcWritable: false });
    expect(mergeResolved.projectFile).toBe('userdata-llc');
    // The same preset stays selected: the downgrade is part of what the preset means here.
    expect(resolveFinishPreset({ mode: 'merge', options: mergeResolved, mergedCoversClips: true, installLlcWritable: false })).toBe('one-video');

    const cutResolved = resolvePresetOptions({ preset: 'one-video', mode: 'cut', options: cutOptions(), mergedCoversClips: true, installLlcWritable: false });
    expect(cutResolved.projectFile).toBe('userdata-llc');
    expect(resolveFinishPreset({ mode: 'cut', options: cutResolved, mergedCoversClips: true, installLlcWritable: false })).toBe('one-video');
  });

  it('moves the merged result even when it is outside the work area, and stays on the preset', () => {
    const resolved = resolvePresetOptions({ preset: 'one-video', mode: 'cut', options: cutOptions(), mergedCoversClips: true, mergedInsideWorkArea: false });
    expect(resolved.mergedResult).toBe('finished');
    expect(resolveFinishPreset({ mode: 'cut', options: resolved, mergedCoversClips: true, mergedInsideWorkArea: false })).toBe('one-video');
  });

  it('clears the results of earlier passes when leaving the video, and keeps them when continuing', () => {
    // Ending the video: the work area must not carry a previous pass's results into the next video.
    for (const preset of ['one-video', 'archive', 'skip'] as const) {
      expect(resolvePresetOptions({ preset, mode: 'cut', options: cutOptions(), mergedCoversClips: true }).deleteStaleClips).toBe(true);
      expect(resolvePresetOptions({ preset, mode: 'merge', options: mergeOptions(), mergedCoversClips: true }).deleteStaleClips).toBe(true);
    }
    // Continuing the same video: keeping them avoids cutting them again.
    expect(resolvePresetOptions({ preset: 'loop-video', mode: 'cut', options: cutOptions(), mergedCoversClips: true }).deleteStaleClips).toBe(false);
    expect(resolvePresetOptions({ preset: 'loop-video', mode: 'merge', options: mergeOptions(), mergedCoversClips: true }).deleteStaleClips).toBe(false);
  });
});

describe('resolveFinishPreset', () => {
  it('recognizes each preset from its own options', () => {
    for (const preset of ['one-video', 'archive', 'loop-video'] as const) {
      const merged = resolvePresetOptions({ preset, mode: 'merge', options: mergeOptions(), mergedCoversClips: true });
      expect(resolveFinishPreset({ mode: 'merge', options: merged, mergedCoversClips: true })).toBe(preset);

      const cut = resolvePresetOptions({ preset, mode: 'cut', options: cutOptions(), mergedCoversClips: true });
      expect(resolveFinishPreset({ mode: 'cut', options: cut, mergedCoversClips: true })).toBe(preset);
    }
  });

  it('stays on the preset when the safe downgrade applies', () => {
    const merged = resolvePresetOptions({ preset: 'one-video', mode: 'merge', options: mergeOptions(), mergedCoversClips: false });
    expect(merged.clips).toBe('detached');
    expect(resolveFinishPreset({ mode: 'merge', options: merged, mergedCoversClips: false })).toBe('one-video');

    // The loop preset keeps the results anyway, so a stale merge cannot downgrade it.
    const loop = resolvePresetOptions({ preset: 'loop-video', mode: 'merge', options: mergeOptions(), mergedCoversClips: false });
    expect(loop.clips).toBe('keep');
    expect(resolveFinishPreset({ mode: 'merge', options: loop, mergedCoversClips: false })).toBe('loop-video');
  });

  it('never derives the skip preset in the Shift+E workflow', () => {
    const merged = resolvePresetOptions({ preset: 'skip', mode: 'merge', options: mergeOptions(), mergedCoversClips: true });
    expect(resolveFinishPreset({ mode: 'merge', options: merged, mergedCoversClips: true })).toBe('custom');
    const cut = resolvePresetOptions({ preset: 'skip', mode: 'cut', options: cutOptions(), mergedCoversClips: true });
    expect(resolveFinishPreset({ mode: 'cut', options: cut, mergedCoversClips: true })).toBe('custom');
  });

  it('derives the skip preset in the Shift+F workflow', () => {
    const merged = resolvePresetOptions({ preset: 'skip', mode: 'merge', options: mergeOptions(), mergedCoversClips: true });
    expect(resolveFinishPreset({ mode: 'merge', options: merged, mergedCoversClips: true, flow: 'keepSource' })).toBe('skip');
    const cut = resolvePresetOptions({ preset: 'skip', mode: 'cut', options: cutOptions(), mergedCoversClips: true });
    expect(resolveFinishPreset({ mode: 'cut', options: cut, mergedCoversClips: true, flow: 'keepSource' })).toBe('skip');
  });

  it('falls back to custom as soon as anything a preset sets is changed', () => {
    const base = resolvePresetOptions({ preset: 'one-video', mode: 'merge', options: mergeOptions(), mergedCoversClips: true });
    const changes: Partial<PatchFinishMergeOptions>[] = [
      { source: 'keep' },
      { projectFile: 'keep' },
      { merged: 'source' },
      { clips: 'detached' },
      { deleteStaleClips: false },
      { next: 'none' },
      { workDir: 'clear' },
    ];
    for (const change of changes) {
      expect(resolveFinishPreset({ mode: 'merge', options: { ...base, ...change }, mergedCoversClips: true })).toBe('custom');
    }
  });

  it('ignores the choices the presets do not express', () => {
    const base = resolvePresetOptions({ preset: 'one-video', mode: 'merge', options: mergeOptions(), mergedCoversClips: true });
    expect(resolveFinishPreset({ mode: 'merge', options: { ...base, projectDateGrouping: 'ymd' }, mergedCoversClips: true })).toBe('one-video');
  });

  it('opens on the one-video preset, which is what the shipped defaults describe', () => {
    expect(resolveFinishPreset({ mode: 'merge', options: defaultPatchFinishMergeOptions, mergedCoversClips: true })).toBe('one-video');
    expect(resolveFinishPreset({ mode: 'cut', options: defaultPatchFinishCutOptions, mergedCoversClips: true })).toBe('one-video');
  });

  it('opens on the skip preset in the Shift+F workflow, where only the source choice differs', () => {
    // The skip key opens its own dialog on its own remembered options, whose source is `skip`.
    expect(resolveFinishPreset({ mode: 'merge', options: { ...defaultPatchFinishMergeOptions, source: 'skip' }, mergedCoversClips: true, flow: 'keepSource' })).toBe('skip');
    expect(resolveFinishPreset({ mode: 'cut', options: { ...defaultPatchFinishCutOptions, source: 'skip' }, mergedCoversClips: true, flow: 'keepSource' })).toBe('skip');
  });

  it('still recognizes the archive preset, which keeps the source in the finished folder', () => {
    expect(resolveFinishPreset({ mode: 'merge', options: { ...defaultPatchFinishMergeOptions, source: 'finished' }, mergedCoversClips: true })).toBe('archive');
    expect(resolveFinishPreset({ mode: 'cut', options: { ...defaultPatchFinishCutOptions, source: 'finished' }, mergedCoversClips: true })).toBe('archive');
  });
});
