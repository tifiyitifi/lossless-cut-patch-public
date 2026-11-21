// eslint-disable-next-line import-js/no-extraneous-dependencies
import { beforeEach, describe, expect, it } from 'vitest';

import {
  claimSourceDamageAsk, getSourceDamagePlaybackOverride, resetSourceDamageAskStateForTests, setSourceDamagePlaybackOverride,
} from './askState.js';

beforeEach(() => {
  resetSourceDamageAskStateForTests();
});

describe('claimSourceDamageAsk', () => {
  it('is the first time for a file that was never asked about', () => {
    expect(claimSourceDamageAsk('c:/v/a.mp4').firstTime).toBe(true);
  });

  it('is not the first time the second time', () => {
    claimSourceDamageAsk('c:/v/a.mp4');
    expect(claimSourceDamageAsk('c:/v/a.mp4').firstTime).toBe(false);
  });

  it('keeps two files apart', () => {
    claimSourceDamageAsk('c:/v/a.mp4');
    expect(claimSourceDamageAsk('c:/v/b.mp4').firstTime).toBe(true);
  });

  it('answers per file, so a second window can reuse the stored choice', () => {
    claimSourceDamageAsk('c:/v/a.mp4');
    setSourceDamagePlaybackOverride('c:/v/a.mp4', false);
    expect(claimSourceDamageAsk('c:/v/a.mp4')).toStrictEqual({ firstTime: false, playbackOverride: false });
  });

  it('ignores the path case on Windows and macOS', () => {
    claimSourceDamageAsk('C:/Videos/A.mp4');
    const caseInsensitive = process.platform === 'win32' || process.platform === 'darwin';
    expect(claimSourceDamageAsk('c:/videos/a.mp4').firstTime).toBe(!caseInsensitive);
  });
});

describe('the playback override', () => {
  it('is unset for a new file', () => {
    expect(getSourceDamagePlaybackOverride('c:/v/a.mp4')).toBeUndefined();
  });

  it('remembers that the user turned repair off', () => {
    setSourceDamagePlaybackOverride('c:/v/a.mp4', false);
    expect(getSourceDamagePlaybackOverride('c:/v/a.mp4')).toBe(false);
  });

  it('remembers that the user turned repair on', () => {
    setSourceDamagePlaybackOverride('c:/v/a.mp4', true);
    expect(getSourceDamagePlaybackOverride('c:/v/a.mp4')).toBe(true);
  });

  it('can be cleared', () => {
    setSourceDamagePlaybackOverride('c:/v/a.mp4', false);
    setSourceDamagePlaybackOverride('c:/v/a.mp4', undefined);
    expect(getSourceDamagePlaybackOverride('c:/v/a.mp4')).toBeUndefined();
  });

  it('does not leak between files', () => {
    setSourceDamagePlaybackOverride('c:/v/a.mp4', false);
    expect(getSourceDamagePlaybackOverride('c:/v/b.mp4')).toBeUndefined();
  });
});
