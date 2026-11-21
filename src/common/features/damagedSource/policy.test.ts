// eslint-disable-next-line import-js/no-extraneous-dependencies
import { describe, expect, it } from 'vitest';

import { resolveDamagePolicy } from './policy.js';
import type { DamageSettings, SourceDamage } from './types.js';
import { sourceDamageMissingCompositionOffsets } from './types.js';

const damaged: SourceDamage[] = [{ kind: sourceDamageMissingCompositionOffsets, evidence: { hasVideo: true, hasBFrames: true, hasCtts: false } }];
const clean: SourceDamage[] = [];

const settings = (overrides: Partial<DamageSettings> = {}): DamageSettings => ({
  playbackRepair: true,
  playbackRepairQuality: 'smooth',
  exportRepair: true,
  ...overrides,
});

describe('resolveDamagePolicy', () => {
  it('costs nothing for a clean file', () => {
    expect(resolveDamagePolicy({ damages: clean, settings: settings() })).toStrictEqual({
      playbackNeedsTranscode: false,
      playbackQuality: 'smooth',
      exportNeedsVideoEncode: false,
      exportKeepResolution: false,
      forbidsPartialEncode: false,
    });
  });

  it('repairs both sides for a damaged file by default', () => {
    const policy = resolveDamagePolicy({ damages: damaged, settings: settings() });
    expect(policy.playbackNeedsTranscode).toBe(true);
    expect(policy.exportNeedsVideoEncode).toBe(true);
    expect(policy.exportKeepResolution).toBe(true);
    expect(policy.forbidsPartialEncode).toBe(true);
  });

  it('leaves playback alone when playback repair is off', () => {
    const policy = resolveDamagePolicy({ damages: damaged, settings: settings({ playbackRepair: false }) });
    expect(policy.playbackNeedsTranscode).toBe(false);
  });

  it('keeps repairing the export when playback repair is off', () => {
    // The user only asked to see the file as it really is; silently writing broken clips would not
    // be what they asked for.
    const policy = resolveDamagePolicy({ damages: damaged, settings: settings({ playbackRepair: false }) });
    expect(policy.exportNeedsVideoEncode).toBe(true);
  });

  it('stops exporting re-encoded when export repair is off, and drops the partial-encode ban with it', () => {
    const policy = resolveDamagePolicy({ damages: damaged, settings: settings({ exportRepair: false }) });
    expect(policy.exportNeedsVideoEncode).toBe(false);
    expect(policy.exportKeepResolution).toBe(false);
    expect(policy.forbidsPartialEncode).toBe(false);
  });

  it('does not touch the export when export repair is off, but still repairs playback', () => {
    const policy = resolveDamagePolicy({ damages: damaged, settings: settings({ exportRepair: false }) });
    expect(policy.playbackNeedsTranscode).toBe(true);
  });

  it('carries the playback quality through', () => {
    expect(resolveDamagePolicy({ damages: damaged, settings: settings({ playbackRepairQuality: 'original' }) }).playbackQuality).toBe('original');
  });

  it('falls back to the small preview when the frame rate is unknown', () => {
    // The repaired preview renumbers frames at the source rate; without one the main process would
    // use 30, and the audio (which is not retimed) would drift away from the picture.
    const policy = resolveDamagePolicy({ damages: damaged, settings: settings({ playbackRepairQuality: 'original' }), frameRateKnown: false });
    expect(policy.playbackQuality).toBe('smooth');
    expect(policy.playbackNeedsTranscode).toBe(true);
  });

  it('keeps the chosen quality when playback repair is off, whatever the frame rate', () => {
    const policy = resolveDamagePolicy({ damages: damaged, settings: settings({ playbackRepair: false, playbackRepairQuality: 'original' }), frameRateKnown: false });
    expect(policy.playbackQuality).toBe('original');
  });

  it('lets the session choice turn playback repair off for one file', () => {
    const policy = resolveDamagePolicy({ damages: damaged, settings: settings(), sessionOverride: false });
    expect(policy.playbackNeedsTranscode).toBe(false);
  });

  it('lets the session choice turn playback repair on even when the setting is off', () => {
    const policy = resolveDamagePolicy({ damages: damaged, settings: settings({ playbackRepair: false }), sessionOverride: true });
    expect(policy.playbackNeedsTranscode).toBe(true);
  });

  it('never lets the session playback choice make the export wrong', () => {
    const policy = resolveDamagePolicy({ damages: damaged, settings: settings(), sessionOverride: false });
    expect(policy.exportNeedsVideoEncode).toBe(true);
  });

  it('ignores the session choice for a clean file', () => {
    const policy = resolveDamagePolicy({ damages: clean, settings: settings(), sessionOverride: true });
    expect(policy.playbackNeedsTranscode).toBe(false);
  });
});
