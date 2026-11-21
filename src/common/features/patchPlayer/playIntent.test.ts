// eslint-disable-next-line import-js/no-extraneous-dependencies
import { describe, expect, it } from 'vitest';

import { resolvePlayKeyIntent } from './playIntent.js';

describe('resolvePlayKeyIntent', () => {
  it('pauses when the element is playing', () => {
    expect(resolvePlayKeyIntent({ playing: true, videoPaused: false })).toStrictEqual({ playing: true, action: 'pause' });
  });

  it('plays when the element is paused', () => {
    expect(resolvePlayKeyIntent({ playing: false, videoPaused: true })).toStrictEqual({ playing: false, action: 'play' });
  });

  it('plays when the ref says "playing" but the element is paused', () => {
    // A finish job released the player, or the file ended: the old code called pause() here and the
    // key looked dead. The element decides.
    expect(resolvePlayKeyIntent({ playing: true, videoPaused: true })).toStrictEqual({ playing: false, action: 'play' });
  });

  it('pauses when the element plays though the ref says otherwise', () => {
    expect(resolvePlayKeyIntent({ playing: false, videoPaused: false })).toStrictEqual({ playing: true, action: 'pause' });
  });

  it('falls back to the ref without an element', () => {
    expect(resolvePlayKeyIntent({ playing: true, videoPaused: undefined })).toStrictEqual({ playing: true, action: 'pause' });
    expect(resolvePlayKeyIntent({ playing: false, videoPaused: undefined })).toStrictEqual({ playing: false, action: 'play' });
  });
});
