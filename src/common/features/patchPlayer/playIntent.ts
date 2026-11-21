/**
What the play key does (fork-owned, pure).

`playingRef` mirrors the `<video>` element, but it can fall out of sync: a finish job releases the
player (`src` removed, `load()`), a natural end, or an `abort` leaves the element paused while the
ref still says "playing". The decision then has to come from the element - with the ref alone the
play key kept calling `pause()` on a paused element, which is a silent no-op, so the key looked
dead until something else resynced the ref.

The element always wins when it is there; the ref only decides when there is no element (a released
or not yet attached player).
*/

export type PlayKeyAction = 'play' | 'pause';

export interface PlayKeyIntent {
  /** The corrected `playingRef` value the caller has to store. */
  playing: boolean;
  action: PlayKeyAction;
}

export function resolvePlayKeyIntent({ playing, videoPaused }: {
  /** The current `playingRef` value. */
  playing: boolean;
  /** `HTMLMediaElement.paused`, or `undefined` when there is no element. */
  videoPaused: boolean | undefined;
}): PlayKeyIntent {
  if (videoPaused == null) return { playing, action: playing ? 'pause' : 'play' };
  const playingNow = !videoPaused;
  return { playing: playingNow, action: playingNow ? 'pause' : 'play' };
}
