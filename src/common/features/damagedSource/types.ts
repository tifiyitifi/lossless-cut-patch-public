/**
Damaged source media (pure types).

Some files are stored in a way that cannot be played or cut correctly: the damage is in the file
itself, not in this app. The detector classifies a file into one or more `SourceDamageKind`s, and
every kind declares what repairing it costs (see `getDamageRepairPlan`).

Only the kinds in `sourceDamageKinds` are implemented. A future defect adds one member here, one
branch in `detectSourceDamage`, and one plan in `getDamageRepairPlan`; the settings panel, the
dialog and the playback/export wiring keep working because they only read a `DamagePolicy`.
*/

/**
Every damage this app can detect, in the order the dialog lists them.

The ids are stable strings, so a documented file or a log stays readable when the code around it
is renamed.
*/
export const sourceDamageKinds = ['missingCompositionOffsets'] as const;

/** The id of one kind of source damage. */
export type SourceDamageKind = (typeof sourceDamageKinds)[number];

/**
The composition time offsets (`ctts`) are missing or all zero, so the frame order is not stored.

The video is stored as `I, P, B, B, …` (decode order) but the file carries no composition time
offsets, so every sample's presentation time equals its decode time. A player that trusts the
container presents the frames in storage order and the picture jumps back a frame all the time.
FFmpeg-based players (VLC, mpv, PotPlayer) rebuild the order from the bitstream and look fine,
which is why the same file plays correctly there and stutters here.

The id names the missing data, not the symptom: "broken frame timing" would also fit other
defects (a damaged head GOP shifts the whole timeline), and every id in this union ends up in the
repair menu next to the others.
*/
export const sourceDamageMissingCompositionOffsets = 'missingCompositionOffsets' satisfies SourceDamageKind;

/**
What the main process learned about the file.

`undefined` means "not known", which is different from `false`: a box scan that failed must not
turn into a "this file is fine" verdict.
*/
export interface SourceProbeFacts {
  hasVideo: boolean;
  /** The video track needs reordering at all (ffprobe `has_b_frames` > 0). */
  hasBFrames: boolean;
  /** The video track carries composition time offsets (`ctts`). `undefined` = could not be read. */
  hasCtts: boolean | undefined;
  /** Every composition offset in the video track is zero, i.e. the box exists but says nothing. */
  cttsAllZero?: boolean | undefined;
  /** Every packet of the first GOP has `pts === dts` (fallback when the box scan failed). */
  firstGopPtsEqualsDts?: boolean | undefined;
}

/** One detected defect, with the probe facts that led to it. */
export interface SourceDamage {
  kind: SourceDamageKind;
  /** The facts the decision was made from, kept for the log, the tests and the dialog. */
  evidence: SourceProbeFacts;
}

/** `smooth` = downscaled but cheap, `original` = full resolution but more CPU. */
export type DamagePlaybackQuality = 'smooth' | 'original';

/** How much the app is willing to spend repairing a damaged source. */
export interface DamageSettings {
  /** Repair the picture while playing (real-time transcode instead of the built-in player). */
  playbackRepair: boolean;
  /** Repair playback quality: `smooth` favours frame rate, `original` keeps the resolution. */
  playbackRepairQuality: DamagePlaybackQuality;
  /** Repair the video track of exported clips by re-encoding it. */
  exportRepair: boolean;
}

/** What repairing one kind of damage costs. */
export interface DamageRepairPlan {
  /** The built-in player cannot show it correctly, so playback has to go through ffmpeg. */
  playbackNeedsTranscode: boolean;
  /** A lossless copy keeps the damage, so the exported video track has to be re-encoded. */
  exportNeedsVideoEncode: boolean;
  /** The re-encode must not downscale: the export is the real result, not a preview. */
  exportKeepResolution: boolean;
  /**
  Encoding only the joins (smart cut) is not enough: the copied middle keeps the damage.
  This is the dangerous case, because the clip then looks correct except in the middle.
  */
  forbidsPartialEncode: boolean;
}

/** The answers the app actually needs, already resolved from settings and the session. */
export interface DamagePolicy {
  playbackNeedsTranscode: boolean;
  playbackQuality: DamagePlaybackQuality;
  exportNeedsVideoEncode: boolean;
  exportKeepResolution: boolean;
  forbidsPartialEncode: boolean;
}
