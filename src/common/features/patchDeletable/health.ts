/**
The quick health of one file in the check panel (fork-owned, pure).

The fast status is what one `stat` and the container header answer: the file exists, it has a size,
and a duration can be read from it. That is a *shape* check, not a proof: a file with a readable
header can still fail to decode, which is what the deep check is for. The panel must not call the
fast status "playable" for that reason.

A zero-byte file has no duration either, and the panel reports it as empty (a failed export or a
broken copy is exactly that) instead of as "the duration is unreadable".
*/

export type PatchFileQuickHealth =
  /** A size and a readable duration. */
  | 'ok'
  /** The file could not be read at all (it is gone, or locked for reading). */
  | 'unreadable'
  /** A 0-byte file. */
  | 'empty'
  /** A size, but neither the header nor FFprobe could read a duration. */
  | 'duration-unreadable';

export function getPatchFileQuickHealth({ size, duration }: {
  size: number | undefined;
  duration: number | undefined;
}): PatchFileQuickHealth {
  if (size == null) return 'unreadable';
  if (size === 0) return 'empty';
  if (duration == null || !Number.isFinite(duration) || duration <= 0) return 'duration-unreadable';
  return 'ok';
}

/** What the panel shows for a row's optional full decode. */
export type PatchDeepCheckPhase = 'idle' | 'running' | 'ok' | 'failed' | 'canceled' | 'unavailable';

export interface PatchDeepCheckView {
  phase: PatchDeepCheckPhase;
  /** 0..1 while running (absent when the duration is unknown). */
  ratio?: number | undefined;
  /** The first FFmpeg error, for a failed run. */
  message?: string | undefined;
  /** Where the decode stopped, for a failed run. */
  atSeconds?: number | undefined;
}
