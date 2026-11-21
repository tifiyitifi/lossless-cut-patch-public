import { parsePatchMergedChapters } from '../patchMerged/mergedChapters.js';
import type { PatchCutResultEntry } from './playerMode.js';

export type PatchPlaylistStep = 'prev' | 'next' | 'first' | 'last';

function isResultEntry(value: unknown): value is PatchCutResultEntry {
  if (typeof value !== 'object' || value == null) return false;
  const candidate = value as { path?: unknown };
  return typeof candidate.path === 'string' && candidate.path.length > 0;
}

/**
Validate a playlist received over IPC.

The main process is typed, but this is a process boundary: an entry without a path would make the
player try to open nothing. A merged entry keeps its chapters only when they are valid.
*/
export function parsePatchCutResults(value: unknown): PatchCutResultEntry[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!isResultEntry(entry)) return [];
    const { mergedChapters } = entry as { mergedChapters?: unknown };
    if (mergedChapters === undefined) return [entry];
    const chapters = parsePatchMergedChapters(mergedChapters);
    return [{ ...entry, mergedChapters: chapters }];
  });
}

/**
The playlist message a results window receives.

The cut-results and merged windows send the entries only; the check player also says which file to
show (the one the user double-clicked), so the player jumps to that playlist position instead of
guessing. Whether the file is in the list is decided here: a focus path that is not part of the
playlist would only make the player open something the list does not show.
*/
export interface PatchPlayerPlaylistMessage {
  entries: PatchCutResultEntry[];
  focusPath?: string | undefined;
}

/** Validate a playlist message; the legacy bare array (entries only) is still accepted. */
export function parsePlayerPlaylistMessage(value: unknown): PatchPlayerPlaylistMessage {
  if (Array.isArray(value)) return { entries: parsePatchCutResults(value) };
  if (typeof value !== 'object' || value == null) return { entries: [] };
  const { entries, focusPath } = value as { entries?: unknown, focusPath?: unknown };
  const parsed = parsePatchCutResults(entries);
  if (typeof focusPath !== 'string') return { entries: parsed };
  return parsed.some((entry) => entry.path === focusPath)
    ? { entries: parsed, focusPath }
    : { entries: parsed };
}

/** Index of the result that is playing, or -1. */export function getCurrentResultIndex(entries: readonly PatchCutResultEntry[], currentPath: string | undefined) {
  if (currentPath == null) return -1;
  return entries.findIndex((entry) => entry.path === currentPath);
}

/**
Is the playing result still in the new playlist?

A playlist update (a new export) must not restart a result that is still part of it.
*/
export function isResultStillInPlaylist(entries: readonly PatchCutResultEntry[], currentPath: string | undefined) {
  return getCurrentResultIndex(entries, currentPath) !== -1;
}

/** What the player has to do when a new playlist replaces the one it is holding. */
export type PlaylistUpdateAction =
  /** Nothing: the playing result is still part of the playlist and its content did not change. */
  | { kind: 'keep' }
  /** The video was unloaded for an export: load the playing result again. */
  | { kind: 'reload' }
  /** Open this result; it becomes the current one. */
  | { kind: 'open', entry: PatchCutResultEntry };

/**
What the results window does with a playlist update (a new export pushes one).

- A result the export cut again is what the user wants to review, so the player jumps to the
  earliest one (the smallest playlist position), even when the result that was playing is still
  part of the new playlist.
- Otherwise the playing result stays current. It is found by path, and by its segment identity
  when the export renamed it (`segId` survives a rename).
*/
export function planPlaylistUpdate({ entries, current, released }: {
  entries: readonly PatchCutResultEntry[];
  /** The entry that is playing now, from the playlist that is being replaced. */
  current: PatchCutResultEntry | undefined;
  /** Was the video unloaded for an export? It then has to be loaded again. */
  released: boolean;
}): PlaylistUpdateAction {
  if (entries.length === 0) return { kind: 'keep' };

  // The result that keeps playing is found by path, and by segment identity when the export
  // renamed its file (the playlist already carries the new name).
  const claimed = entries.find((entry) => entry.path === current?.path)
    ?? (current?.segId != null ? entries.find((entry) => entry.segId === current.segId) : undefined);

  const [first] = entries;
  const target = entries.find((entry) => entry.recut === true) ?? claimed ?? first;
  if (target == null) return { kind: 'keep' };
  if (target.path === current?.path) return ({ kind: released ? 'reload' : 'keep' });
  return { kind: 'open', entry: target };
}

/** The entry a step leads to, or `undefined` at either end (the player does not wrap around). */
export function findStepResult(entries: readonly PatchCutResultEntry[], currentPath: string | undefined, step: PatchPlaylistStep) {
  if (entries.length === 0) return undefined;
  if (step === 'first') return entries[0];
  if (step === 'last') return entries.at(-1);
  const index = getCurrentResultIndex(entries, currentPath);
  if (index === -1) return undefined;
  return entries[step === 'prev' ? index - 1 : index + 1];
}

/** Apply a rename that already happened on disk to the playlist. */
export function replaceResultPath(entries: readonly PatchCutResultEntry[], oldPath: string, newPath: string, label: string | undefined) {
  return entries.map((entry) => (
    entry.path === oldPath
      ? { ...entry, path: newPath, ...((label !== undefined) && { label }) }
      : entry
  ));
}

/**
Every file the results list shows, playlist first and the "other videos" section after it.

The list greys out the rows whose file is gone, and both sections are rows: checking only the
playlist would leave an "other" row clickable while its file is gone (`useResultFilesExist`).
Each path is checked once - the other section can repeat a result of the playlist.
*/
export function getShownResultPaths({ entries, others }: {
  entries: readonly PatchCutResultEntry[];
  /** The collapsible "other videos / other clips" section (paths only). */
  others?: readonly string[] | undefined;
}): string[] {
  const paths = [...entries.map((entry) => entry.path), ...(others ?? [])];
  const seen = new Set<string>();
  return paths.filter((path) => {
    if (seen.has(path)) return false;
    seen.add(path);
    return true;
  });
}
