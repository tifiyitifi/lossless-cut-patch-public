/* eslint-disable import/prefer-default-export */
import { getDamageRepairPlan } from './plan.js';
import type { DamagePolicy, DamageSettings, SourceDamage } from './types.js';

/**
Turn what was detected plus what the user wants into the answers the app runs on.

The two switches are independent: playback repair only changes what you see while watching, and
export repair only changes what gets written. Turning playback repair off must never make an
export silently wrong, so `sessionOverride` - the choice made in the dialog when a damaged file
is opened - applies to playback only.

A file with no damage costs nothing: every answer is false.
*/
export function resolveDamagePolicy({ damages, settings, sessionOverride, frameRateKnown = true }: {
  damages: readonly SourceDamage[];
  settings: DamageSettings;
  /** The per-file, per-session choice from the opening dialog. `undefined` = follow the setting. */
  sessionOverride?: boolean | undefined;
  /**
  Is the source's frame rate known? The repaired preview renumbers the frames at that rate, and
  the main process falls back to 30 without one while the audio is not retimed: the two would
  drift apart. The small copy is resampled to a known rate, so it does not depend on this.
  */
  frameRateKnown?: boolean | undefined;
}): DamagePolicy {
  const plans = damages.map((damage) => getDamageRepairPlan(damage.kind));

  const wantsPlaybackRepair = sessionOverride ?? settings.playbackRepair;
  const playbackNeedsTranscode = wantsPlaybackRepair && plans.some((plan) => plan.playbackNeedsTranscode);
  const playbackQuality = playbackNeedsTranscode && !frameRateKnown ? 'smooth' : settings.playbackRepairQuality;

  const exportNeedsVideoEncode = settings.exportRepair && plans.some((plan) => plan.exportNeedsVideoEncode);

  return {
    playbackNeedsTranscode,
    playbackQuality,
    exportNeedsVideoEncode,
    exportKeepResolution: exportNeedsVideoEncode && plans.some((plan) => plan.exportKeepResolution),
    forbidsPartialEncode: exportNeedsVideoEncode && plans.some((plan) => plan.forbidsPartialEncode),
  };
}
