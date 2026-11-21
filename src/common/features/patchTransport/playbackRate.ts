/**
The "Z" playback-rate toggle (fork-owned, pure).

PotPlayer-style: `X` slows down, `C` speeds up, and `Z` switches between 1x and the last
speed the user chose. The remembered speed is the last non-1x rate the rate keys produced;
it is kept in `patch-config.json` (see `PatchSettings.rememberedPlaybackRate`) so it
survives a restart, and it is not cleared when a file is closed (closing a file only puts
the current rate back to 1x).

The pure plan lives here so the toggle itself is unit-testable: the renderer hook only
applies the plan, remembers the result and persists it.
*/

export const minPlaybackRate = 0.1;
export const maxPlaybackRate = 16;

/** The fixed step of the PotPlayer-style speed keys, in playback-rate units. */
export const fixedPlaybackRateStep = 0.1;

/** How the patch speed keys (X / C) change the rate. */
export type PatchPlaybackRateStepMode = 'base' | 'fixed';

/**
A stored step mode: `base` keeps the upstream multiplier (three presses double the rate),
`fixed` steps by `fixedPlaybackRateStep` per press. Anything a hand edit could have left there
falls back to the patch default (`fixed`).
*/
export function parsePlaybackRateStepMode(value: unknown): PatchPlaybackRateStepMode {
  return value === 'base' ? 'base' : 'fixed';
}

/**
One press of a patch speed key in `fixed` mode.

Adds or subtracts `fixedPlaybackRateStep` (times the multiplier of the "more" keys), rounded to
one decimal so repeated presses stay on the grid, and clamped to the player's rate range.
`direction` 0 slows down, matching the base rate calculator (the patch bindings only pass ±1).
*/
export function stepPlaybackRate({ currentRate, direction, multiplier }: { currentRate: number, direction: number, multiplier?: number | undefined }): number {
  const step = fixedPlaybackRateStep * (multiplier ?? 1);
  const next = currentRate + (direction > 0 ? step : -step);
  return Math.min(maxPlaybackRate, Math.max(minPlaybackRate, Math.round(next * 10) / 10));
}

/** A stored rate is usable when it is a finite number inside the player's rate range. */
export function parseRememberedPlaybackRate(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= minPlaybackRate && value <= maxPlaybackRate
    ? value
    : 1;
}

export interface PlaybackRateTogglePlan {
  /** The rate to apply now. */
  rate: number;
  /** The rate to remember for the next toggle (unchanged when restoring a remembered rate). */
  rememberedRate: number;
}

/**
Toggle between the current rate and 1x, remembering the way back.

- Not at 1x: remember the current rate and go to 1x.
- At 1x with a remembered non-1x rate: go to that rate, keeping it remembered so the
  next press goes back to 1x.
- At 1x with nothing remembered (or with 1x remembered): stay at 1x.
*/
export function planPlaybackRateToggle({ currentRate, rememberedRate }: { currentRate: number, rememberedRate: number }): PlaybackRateTogglePlan {
  const remembered = parseRememberedPlaybackRate(rememberedRate);
  if (currentRate !== 1) {
    return { rate: 1, rememberedRate: parseRememberedPlaybackRate(currentRate) };
  }
  if (remembered !== 1) {
    return { rate: remembered, rememberedRate: remembered };
  }
  return { rate: 1, rememberedRate: 1 };
}
