import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { PatchCutResultEntry, PatchPlaylistStep } from '../../../../common/features/patchPlayer';
import {
  findStepResult,
  parsePlayerPlaylistMessage,
  patchPlayerPlaylistChannel,
  patchPlayerReadyChannel,
  planPlaylistUpdate,
  replaceResultPath,
} from '../../../../common/features/patchPlayer';

const { ipcRenderer } = window.require('electron');

/**
The cut-results playlist of the player window (fork-owned).

The playlist is *not* the upstream batch list: opening a result must be prompt-free and a
playlist update (a new export) does not restart the result that is still playing - except that a
result the export cut again becomes current, so the user reviews what changed (see
`planPlaylistUpdate`). Entries keep their label and name context so the result can be renamed
without guessing from the file name.
*/
export default function usePatchPlayerPlaylist({ playerMode, currentPath, openPath, reloadCurrentFile }: {
  playerMode: boolean;
  currentPath: string | undefined;
  openPath: (path: string) => Promise<void>;
  /** Re-open the current path (it is already `filePath`, so `openPath` would ignore it). */
  reloadCurrentFile: () => void;
}) {
  const [entries, setEntries] = useState<PatchCutResultEntry[]>([]);
  const readySentRef = useRef(false);
  /** Set while an export has released the video: the next playlist must load it again. */
  const releasedRef = useRef(false);

  const open = useCallback((entry: PatchCutResultEntry | undefined) => {
    if (entry == null) return;
    const wasReleased = releasedRef.current;
    releasedRef.current = false;
    if (wasReleased && entry.path === currentPath) {
      reloadCurrentFile();
      return;
    }
    openPath(entry.path).catch((err) => { console.error('Failed to open the cut result', err); });
  }, [currentPath, openPath, reloadCurrentFile]);

  /** The export is about to rename/delete results: the video must let go of its file. */
  const release = useCallback(() => { releasedRef.current = true; }, []);

  const currentIndex = useMemo(() => entries.findIndex((entry) => entry.path === currentPath), [currentPath, entries]);
  const currentEntry = currentIndex === -1 ? undefined : entries[currentIndex];

  const replace = useCallback((newEntries: PatchCutResultEntry[], focusPath?: string | undefined) => {
    // The check player names the file the user double-clicked: jump to that position instead of
    // guessing which entry is "current". The list is set first, so the sidebar scrolls to it.
    if (focusPath != null) {
      const target = newEntries.find((entry) => entry.path === focusPath);
      if (target != null) {
        releasedRef.current = false;
        open(target);
        setEntries(newEntries);
        return;
      }
    }
    // The export pushes a new playlist. A result it cut again wins (the user wants to review what
    // changed); otherwise the playing result stays, and it is loaded again when the export let go
    // of its file (see `planPlaylistUpdate`).
    const action = planPlaylistUpdate({ entries: newEntries, current: currentEntry, released: releasedRef.current });
    if (action.kind === 'open') {
      open(action.entry);
    } else if (action.kind === 'reload') {
      releasedRef.current = false;
      reloadCurrentFile();
    }
    setEntries(newEntries);
  }, [currentEntry, open, reloadCurrentFile]);

  // The IPC subscription must not be re-created whenever the current file changes (a re-subscribe
  // could drop a playlist pushed in between), so the handler is kept in a ref.
  const replaceRef = useRef(replace);
  useEffect(() => { replaceRef.current = replace; }, [replace]);

  useEffect(() => {
    if (!playerMode) return undefined;

    const onPlaylist = (_event: unknown, data: unknown) => {
      const message = parsePlayerPlaylistMessage(data);
      replaceRef.current(message.entries, message.focusPath);
    };

    ipcRenderer.on(patchPlayerPlaylistChannel, onPlaylist);
    // Announce once: a new export pushes a new playlist, so re-announcing would restart the player.
    if (!readySentRef.current) {
      readySentRef.current = true;
      ipcRenderer.send(patchPlayerReadyChannel);
    }

    return () => { ipcRenderer.off(patchPlayerPlaylistChannel, onPlaylist); };
  }, [playerMode]);

  const step = useCallback((target: PatchPlaylistStep) => {
    open(findStepResult(entries, currentPath, target));
  }, [currentPath, entries, open]);

  const renameEntry = useCallback((oldPath: string, newPath: string, label: string | undefined) => {
    setEntries((previous) => replaceResultPath(previous, oldPath, newPath, label));
  }, []);

  return {
    entries,
    currentIndex,
    currentEntry,
    renameEntry,
    open,
    release,
    step,
    prev: useCallback(() => step('prev'), [step]),
    next: useCallback(() => step('next'), [step]),
    first: useCallback(() => step('first'), [step]),
    last: useCallback(() => step('last'), [step]),
  };
}
