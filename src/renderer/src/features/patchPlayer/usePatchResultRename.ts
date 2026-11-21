import type { TFunction } from 'i18next';
import type { RefObject } from 'react';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { resolveTypedResultRename } from '../../../../common/features/patchPlayer';
import type { PatchCutResultEntry, ResultFileNameProblem } from '../../../../common/features/patchPlayer';
import { normalizeManifestPath } from '../../../../common/features/patchExport';
import { isMac, isWindows } from '../../util';

import renderResultPath from './renderResultName';

const { access } = window.require('node:fs/promises');
const { join, parse } = window.require('node:path');

/** How long to give Windows to release the playing file after the video is unloaded. */
const releaseDelayMs = 250;

export type PatchRenameKind = 'label' | 'full';

export type PatchRenameOutcome = { ok: true; notice?: string | undefined } | { ok: false; error: string };

function delay(ms: number) {
  return new Promise<void>((resolve) => { setTimeout(resolve, ms); });
}

async function pathExists(path: string) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/** The exact same spelling: there is nothing to rename. A case-only change is a real rename. */
function isSamePath(a: string, b: string) {
  return a === b;
}

/**
A rename that only changes the spelling of the path (`Clip.mp4` -> `clip.mp4`, or a different
separator). A case-insensitive file system resolves the target to the source itself, so
`pathExists` would report the file as taken and the rename would never happen.
*/
function isSpellingOnlyPathChange(a: string, b: string) {
  if (!isWindows && !isMac) return false;
  if (a === b) return false;
  return normalizeManifestPath(a, { caseInsensitive: true }) === normalizeManifestPath(b, { caseInsensitive: true });
}

function describeFileNameProblem(problem: ResultFileNameProblem, t: TFunction) {
  switch (problem.code) {
    case 'empty': {
      return t('At least one resulting file name has no length');
    }
    case 'invalidChars': {
      return t('At least one resulting file name contains invalid character(s): {{invalidChars}}', { invalidChars: `"${problem.invalidChars}"` });
    }
    case 'trailing': {
      return t('At least one resulting file name ends with a whitespace character or a dot, which is not allowed.');
    }
    case 'surroundingWhitespace': {
      return t('At least one resulting file name has leading or trailing whitespace.');
    }
    case 'reserved': {
      return t('That file name is reserved by the system.');
    }
    case 'tooLong': {
      return t('At least one resulting file name is too long');
    }
    default: {
      return t('Failed to rename the file');
    }
  }
}

/**
Rename a cut result on disk (fork-owned).

`label` re-renders the stored name template with the new label; `full` replaces the whole file
name. The playing result is unloaded first (Windows keeps a file locked while it is open) and
reloaded from the new path afterwards, so the player window itself stays open and usable.

The rename itself is done by the main process, which also updates the export manifest: a result
the manifest does not know about would be cut again on the next export and skipped by the merge.
*/
export function usePatchResultRename({ currentPath, videoRef, pause, reloadCurrentFile, openPath, onRenamed }: {
  currentPath: string | undefined;
  videoRef: RefObject<HTMLVideoElement | null>;
  pause: () => void;
  /** Re-run the app's media load for the current path (used when a rename failed after unloading). */
  reloadCurrentFile: () => void;
  openPath: (path: string) => Promise<void>;
  onRenamed: (entry: PatchCutResultEntry, newPath: string, label: string | undefined) => void;
}) {
  const { t } = useTranslation();

  const releaseCurrentFile = useCallback(async () => {
    pause();
    const video = videoRef.current;
    if (video != null) {
      // The same unload the app uses when it switches files: this is what releases the handle.
      video.removeAttribute('src');
      video.load();
    }
    await delay(releaseDelayMs);
  }, [pause, videoRef]);

  const renameResult = useCallback(async ({ entry, kind, value }: {
    entry: PatchCutResultEntry;
    kind: PatchRenameKind;
    value: string;
  }): Promise<PatchRenameOutcome> => {
    let newPath: string;
    let nextLabel: string | undefined;

    if (kind === 'label') {
      if (entry.nameContext == null) {
        return { ok: false, error: t('Merged results have no segment label to rename. Use Shift+N to rename the file.') };
      }
      if (value === (entry.label ?? '')) return { ok: true };
      nextLabel = value;
      try {
        newPath = await renderResultPath(entry.nameContext, value);
      } catch (err) {
        console.error('Failed to render the name template', err);
        return { ok: false, error: t('Failed to rename the file') };
      }
    } else {
      const parsed = parse(entry.path);
      // The dialog asks for the name without the extension, but the user may type it anyway: the
      // extension of the file is stripped, so `clip.mp4` does not become `clip.mp4.mp4`.
      const resolution = resolveTypedResultRename({
        value,
        currentName: parsed.name,
        extension: parsed.ext,
        isWindows,
        isMac,
      });
      if (resolution.kind === 'invalid') return { ok: false, error: describeFileNameProblem(resolution.problem, t) };
      if (resolution.kind === 'unchanged') return { ok: true };
      newPath = join(parsed.dir, `${resolution.baseName}${parsed.ext}`);
    }

    if (isSamePath(newPath, entry.path)) {
      return { ok: true, notice: t('The name template does not use the label, so the file name did not change.') };
    }

    if (!isSpellingOnlyPathChange(newPath, entry.path) && await pathExists(newPath)) {
      return { ok: false, error: t('A file with that name already exists') };
    }

    const isCurrent = currentPath === entry.path;
    if (isCurrent) await releaseCurrentFile();

    let outcome: { ok: boolean; reason?: string | undefined; manifestUpdated: boolean };
    try {
      outcome = await window.electron.patchRenameResult({
        from: entry.path,
        to: newPath,
        sourcePath: entry.sourcePath,
        label: nextLabel,
      });
    } catch (err) {
      console.error('Failed to rename the file', err);
      if (isCurrent) reloadCurrentFile();
      return { ok: false, error: t('Failed to rename the file') };
    }

    if (!outcome.ok) {
      if (isCurrent) reloadCurrentFile();
      if (outcome.reason === 'busy') {
        return { ok: false, error: t('Another window is using this work folder. Wait for its export to finish.') };
      }
      if (outcome.reason === 'in-use') {
        return { ok: false, error: t('This file is being played in another window. Stop it there first.') };
      }
      if (outcome.reason === 'locked') {
        return { ok: false, error: t('The file is still in use. Close it in the other window and try again.') };
      }
      if (outcome.reason === 'manifest') {
        return { ok: false, error: t('The export manifest could not be updated, so the rename was undone.') };
      }
      if (outcome.reason === 'exists') {
        return { ok: false, error: t('A file with that name already exists') };
      }
      return { ok: false, error: t('Failed to rename the file') };
    }

    onRenamed(entry, newPath, nextLabel);

    if (isCurrent) {
      // The rename itself succeeded. Reopening is best effort: a failure here must not report the
      // rename as failed (a retry would try to rename a file that is already at the new path).
      try {
        await openPath(newPath);
      } catch (err) {
        console.error('Failed to reopen the renamed result', err);
      }
    }

    return { ok: true };
  }, [currentPath, onRenamed, openPath, releaseCurrentFile, reloadCurrentFile, t]);

  return renameResult;
}
