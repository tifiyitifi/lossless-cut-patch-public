/**
Per-session memory of the "this file is damaged" question (fork-owned, main process).

The dialog is shown once per file per app run: the user already decided, and asking again every
time the same file is opened (or opened in another window) is noise. Nothing here is written to
disk, so a restart asks again - by design, the answer is a "for now" answer, not a preference.

The override lives in the main process rather than in a window so that every window sees the same
answer: the cutting window, the results windows and the merged window all play the same source.
*/

/** Windows and macOS resolve paths case-insensitively, so the memory has to as well. */
const isCaseInsensitive = process.platform === 'win32' || process.platform === 'darwin';

const keyFor = (path: string) => (isCaseInsensitive ? path.toLowerCase() : path);

const askedThisRun = new Set<string>();
const playbackOverrides = new Map<string, boolean>();

/**
Has this file been asked about in this run? Marks it as asked.

Returns the stored answer too, so a second window opening the same file does not have to ask
again but still plays it the way the user chose.
*/
export function claimSourceDamageAsk(path: string): { firstTime: boolean, playbackOverride: boolean | undefined } {
  const key = keyFor(path);
  const firstTime = !askedThisRun.has(key);
  askedThisRun.add(key);
  return { firstTime, playbackOverride: playbackOverrides.get(key) };
}

/** Remember the answer for the rest of the run. `undefined` clears it. */
export function setSourceDamagePlaybackOverride(path: string, repair: boolean | undefined) {
  const key = keyFor(path);
  if (repair == null) playbackOverrides.delete(key);
  else playbackOverrides.set(key, repair);
}

/** The answer given earlier in this run, or `undefined` when there is none. */
export function getSourceDamagePlaybackOverride(path: string): boolean | undefined {
  return playbackOverrides.get(keyFor(path));
}

/** Drop everything. Only used by the tests (a run starts with nothing). */
export function resetSourceDamageAskStateForTests() {
  askedThisRun.clear();
  playbackOverrides.clear();
}
