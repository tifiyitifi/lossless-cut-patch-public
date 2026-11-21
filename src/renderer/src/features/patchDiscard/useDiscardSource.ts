import { useCallback, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  defaultPatchFinishDiscardOptions, getFinishOptionProblems, getParentPath, getPathFileName,
} from '../../../../common/features/patchFinish';
import type {
  PatchFinishDiscardOptions, PatchFinishDiscardResultsChoice, PatchFinishJobParams, PatchFinishOptionProblem, PatchFinishPreview, PatchFinishReport,
} from '../../../../common/features/patchFinish';
import { isFileLockError } from '../../../../common/features/patchPlayer';
import getSwal from '../../swal';
import { usePatchWork } from '../patchWork/PatchWorkProvider';

const sleep = async (ms: number) => {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
};

export interface PatchDiscardState {
  preview: PatchFinishPreview;
  results: PatchFinishDiscardResultsChoice;
  /** Show the radio buttons: the remembered setting is `ask`. */
  showResultsChoice: boolean;
  hasResults: boolean;
  /** The dialog's "remember this choice" box (writes `discardResultsAction`). */
  rememberResults: boolean;
  /** The dialog's "do not ask again before discarding" box (writes `confirmDiscardSource`). */
  dontAskAgain: boolean;
  busy: boolean;
  error: string | undefined;
}

/**
The discard flow (`Ctrl+Delete`, fork-owned).

The source video moves to `detached_src_media` and the results it already has are deleted or moved to
`detached_clips` / `detached_merged`. The job itself is the finish executor in `discard` mode, so the
lock, the file-in-use guard, the result windows and the manifest follow the same rules as `Shift+E`.

Two settings decide how much is asked:

- `confirmDiscardSource`: ask before the move at all (its box in the dialog switches it off);
- `discardResultsAction`: `ask` shows the radio buttons, `delete` / `detached` remember the choice.

With both switched off the job runs from the key without a dialog; its summary still goes through the
toast (the file names are reported by the finish report, and the result notice is not silenced).
*/
export function useDiscardSource({
  filePath, workRoot, projectFilePath, enabled, isWorking, flushProjectSave, releasePlayer, reloadPlayer, suspendPreview, resumePreview, discardKey, updateBatchSourcePath, reloadSource, onDiscarded,
}: {
  filePath: string | undefined;
  workRoot: string | undefined;
  projectFilePath: string | undefined;
  enabled: boolean;
  isWorking: () => boolean;
  flushProjectSave: () => Promise<void>;
  releasePlayer: () => void;
  reloadPlayer: () => void;
  suspendPreview: () => void;
  resumePreview: () => void;
  /** The keys bound to `discardSource` (shown in the dialog only to close it again). */
  discardKey: string | undefined;
  updateBatchSourcePath: (from: string, to: string) => void;
  reloadSource: (path: string) => void;
  onDiscarded: (params: { previousSourcePath: string, report: PatchFinishReport }) => void;
}) {
  const { t } = useTranslation();
  const patchWork = usePatchWork();
  const [state, setState] = useState<PatchDiscardState | undefined>();
  const openingRef = useRef(false);
  const runningRef = useRef(false);

  const problemText = useCallback((problem: PatchFinishOptionProblem): string => {
    switch (problem) {
      case 'source-missing': {
        return t('The source video is no longer on disk.');
      }
      case 'source-unreadable': {
        return t('The source video could not be read. Check that it is not locked by another app.');
      }
      case 'files-in-use': {
        return t('A result this job would move is still playing in another window. Stop it there first.');
      }
      case 'source-inside-work-area': {
        return t('The video is inside the work directory or the finished folder');
      }
      default: {
        return t('The video could not be discarded.');
      }
    }
  }, [t]);

  const failureText = useCallback((report: PatchFinishReport): string => {
    const [failure] = report.failed;
    if (failure == null) return t('The video could not be discarded.');
    return `${t('The video could not be discarded.')}\n${failure.path}: ${failure.reason}`;
  }, [t]);

  const openFolder = useCallback(async (dir: string) => {
    try {
      if (await window.electron.patchOpenWorkPath(dir)) return;
    } catch (err) {
      console.error('Failed to open a folder', err);
    }
    getSwal().toast.fire({ icon: 'info', text: t('The folder could not be opened.') });
  }, [t]);

  const runJob = useCallback(async ({ preview, results, dontAskAgain, rememberResults }: {
    preview: PatchFinishPreview;
    results: PatchFinishDiscardResultsChoice;
    dontAskAgain: boolean;
    rememberResults: boolean;
  }) => {
    const sourcePath = filePath;
    if (sourcePath == null || workRoot == null || runningRef.current) return;

    const options: PatchFinishDiscardOptions = {
      ...defaultPatchFinishDiscardOptions,
      results,
      workDir: 'keep',
    };
    const problems = getFinishOptionProblems({ mode: 'discard', options, preview });
    const showError = (message: string) => {
      if (state != null) setState((previous) => (previous == null ? previous : { ...previous, busy: false, error: message }));
      else getSwal().toast.fire({ icon: 'warning', text: message });
    };
    if (problems.length > 0) {
      showError(problems.map((problem) => problemText(problem)).join('\n'));
      return;
    }

    runningRef.current = true;
    // The settings are written only when the job really starts: cancelling the dialog changes nothing.
    if (dontAskAgain) patchWork?.setConfirmDiscardSource(false);
    if (rememberResults) patchWork?.setDiscardResultsAction(results);

    setState((previous) => (previous == null ? previous : { ...previous, busy: true, error: undefined }));
    let playerReleased = false;
    let previewSuspended = false;
    try {
      await flushProjectSave();
      suspendPreview();
      previewSuspended = true;
      releasePlayer();
      playerReleased = true;

      const params: PatchFinishJobParams = {
        sourcePath,
        workRoot,
        ...((projectFilePath != null) && { projectFilePath }),
        mode: 'discard',
        options,
      };
      let report = await window.electron.patchFinishJob(params);

      // The cutting window's player may still hold the source: release it and retry once, like the
      // finish flow does.
      const [failure] = report.failed;
      if (!report.ok && report.moved.length === 0 && failure != null && isFileLockError({ code: failure.reason })) {
        releasePlayer();
        await sleep(400);
        report = await window.electron.patchFinishJob(params);
      }

      if (!report.ok) {
        // The attempt may have moved the source before it stopped: the batch entry and the cutting
        // window follow it, or the retry would point at a file that is gone.
        if (report.newSourcePath != null) {
          updateBatchSourcePath(sourcePath, report.newSourcePath);
          reloadSource(report.newSourcePath);
        } else if (playerReleased) {
          reloadPlayer();
        }
        showError(failureText(report));
        return;
      }

      setState(undefined);
      getSwal().toast.fire({ icon: 'success', text: t('Discarded {{name}}.', { name: getPathFileName(sourcePath) }) });
      onDiscarded({ previousSourcePath: sourcePath, report });
    } catch (err) {
      console.error('Failed to discard the video', err);
      if (playerReleased) reloadPlayer();
      const message = err instanceof Error ? err.message : String(err);
      showError(message);
    } finally {
      runningRef.current = false;
      if (previewSuspended) resumePreview();
    }
  }, [failureText, filePath, flushProjectSave, onDiscarded, patchWork, problemText, projectFilePath, reloadPlayer, reloadSource, releasePlayer, resumePreview, state, suspendPreview, t, updateBatchSourcePath, workRoot]);

  const open = useCallback(async () => {
    if (!enabled || filePath == null || workRoot == null || openingRef.current || runningRef.current) return;
    openingRef.current = true;
    try {
      if (isWorking()) {
        getSwal().toast.fire({ icon: 'warning', text: t('Wait for the current export to finish.') });
        return;
      }

      const preview = await window.electron.patchFinishPreview({
        sourcePath: filePath,
        workRoot,
        ...((projectFilePath != null) && { projectFilePath }),
        mode: 'discard',
      });

      const hasResults = preview.clips.length > 0 || preview.merged != null;
      const remembered = patchWork?.discardResultsAction ?? 'ask';
      const results = remembered === 'ask' ? 'delete' : remembered;
      const showResultsChoice = hasResults && remembered === 'ask';
      const mustAsk = (patchWork?.confirmDiscardSource ?? true) || showResultsChoice;

      // Nothing to ask: the box that would ask was switched off, and either there are no results or
      // the result choice is remembered. The job still reports what it did.
      if (!mustAsk) {
        await runJob({ preview, results, dontAskAgain: false, rememberResults: false });
        return;
      }

      setState({
        preview,
        results,
        showResultsChoice,
        hasResults,
        rememberResults: false,
        dontAskAgain: false,
        busy: false,
        error: undefined,
      });
    } catch (err) {
      console.error('Failed to read the discard preview', err);
      getSwal().toast.fire({ icon: 'warning', text: err instanceof Error ? err.message : String(err) });
    } finally {
      openingRef.current = false;
    }
  }, [enabled, filePath, isWorking, patchWork, projectFilePath, runJob, t, workRoot]);

  const confirm = useCallback(() => {
    if (state == null || state.busy) return;
    runJob({
      preview: state.preview,
      results: state.results,
      dontAskAgain: state.dontAskAgain,
      rememberResults: state.showResultsChoice && state.rememberResults,
    }).catch((err: unknown) => { console.error('Failed to discard the video', err); });
  }, [runJob, state]);

  const dialog = useMemo(() => (state == null ? undefined : {
    ...state,
    discardKey,
    onResultsChange: (results: PatchFinishDiscardResultsChoice) => {
      setState((previous) => (previous == null ? previous : { ...previous, results }));
    },
    onRememberResultsChange: (value: boolean) => {
      setState((previous) => (previous == null ? previous : { ...previous, rememberResults: value }));
    },
    onConfirmSourceChange: (value: boolean) => {
      setState((previous) => (previous == null ? previous : { ...previous, dontAskAgain: value }));
    },
    onConfirm: confirm,
    onCancel: () => {
      if (state.busy) return;
      setState(undefined);
    },
    onOpenCutResultsFolder: () => { openFolder(state.preview.dirs.clipsDir).catch((err: unknown) => { console.error('Failed to open the cut results folder', err); }); },
    onOpenMergedFolder: () => {
      const dir = state.preview.merged != null ? getParentPath(state.preview.merged.path) : state.preview.dirs.mergedDir;
      openFolder(dir).catch((err: unknown) => { console.error('Failed to open the merged result folder', err); });
    },
  }), [confirm, discardKey, openFolder, state]);

  return { open, dialog };
}
