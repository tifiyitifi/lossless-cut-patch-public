import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type {
  PatchFinishCutOptions, PatchFinishDialogRequest, PatchFinishFlow, PatchFinishJobParams, PatchFinishMergeOptions, PatchFinishMode, PatchFinishModeRequest,
  PatchFinishNextChoice, PatchFinishPreview, PatchFinishReport, CutRenamePlanEntry,
} from '../../../../common/features/patchFinish';
import {
  countCutResultsLeftInWorkArea, defaultPatchFinishFlow, getDefaultFinishSource, getFinishOptionProblems, getFinishWorkDirClearView, getPermanentDeleteCount, getPermanentDeleteSize, isPatchFinishBusyError,
  isPatchFinishFilesInUseError, isSamePath, listPreviewResultPaths, listSummaryPaths, parsePatchFinishCutOptions, parsePatchFinishMergeOptions, patchFinishDialogRequestChannel,
  pickSummaryFolder, planFinishFailureOutcome, resolveFinishWindowKind, resolveFinishWindowMode, resolveReadOnlySourceArea, resolveSourceChoice, splitClipsByExportSelection, withFinishFlowSource, withProjectChoiceOnOpen,
} from '../../../../common/features/patchFinish';
import { isFileLockError } from '../../../../common/features/patchPlayer';
import { patchNoticeFinishSummary, shouldShowFinishSummaryNotice } from '../../../../common/features/patchNotice';

import getSwal, { errorToast } from '../../swal';
import { formatKeybinding } from '../../util';
import patchConfig from '../patchWork/patchConfigApi';
import { usePatchWork } from '../patchWork/PatchWorkProvider';
import { usePatchNotice } from '../patchNotice/PatchNoticeProvider';
import { showWorkDirTrashFailureDialog } from '../patchWork/trashFailureDialog';
import { doNotShowAgainBox, withConfirmKeys } from './swalDialogs';
import withNonDestructiveDeny from './swalButtons';
import formatMegabytes from './format';
import { resolveFinishCutRename } from './resolveCutRenamePlan';

const { ipcRenderer } = window.require('electron');
const { dirname } = window.require('node:path');

const sleep = (ms: number) => new Promise<void>((resolve) => { setTimeout(resolve, ms); });

/**
What the dialog says when the job could not even run (a refusal, a lock, an unreadable work area).

The refusals are markers rather than text (IPC keeps only the message), so they are translated
here; anything else is the message the main process gave and is shown as it is.
*/
function describeFinishJobError(err: unknown, t: (key: string) => string) {
  if (isPatchFinishBusyError(err)) return t('A finish job is already running. Try again when it is done.');
  if (isPatchFinishFilesInUseError(err)) return t('Some cut results are being played in another window. Stop them there first.');
  const message = err instanceof Error ? err.message.trim() : '';
  return message !== '' ? message : t('The files could not be moved.');
}


/** The dialog as `App` renders it. */
export interface PatchFinishDialogState {
  isShown: boolean;
  loading: boolean;
  busy: boolean;
  mode: PatchFinishMode;
  /**
  Which workflow opened the dialog: `finish` (`Shift+E`, ends a job) or `keepSource` (`Shift+F`,
  skips the video). It decides the remembered options slot, the presets and source destinations the
  dialog offers, and the title - the two workflows never edit each other's choices.
  */
  flow: PatchFinishFlow;
  preview: PatchFinishPreview | undefined;
  options: PatchFinishMergeOptions | PatchFinishCutOptions;
  problems: ReturnType<typeof getFinishOptionProblems>;
  /**
  The names the cut results are moved to (see `features/patchFinish/cutRename`), rendered once per
  attempt so a retry of a half-finished job keeps the names the first attempt used.
  */
  renamePlan: CutRenamePlanEntry[];
  /** The inputs `renamePlan` was rendered with. A change renders it again; a retry keeps it. */
  renamePlanKey: string;
  /** Why the rename rule cannot name the results (the dialog shows it next to the rule). */
  renameProblem: string | undefined;
  error: string | undefined;
  /** ISO time the dialog opened; the date folders in the summary and the job use it. */
  now: string;
  /**
  The last attempt stopped before it was done. The dialog stays open (the user fixes the cause and
  runs the job again), so the failures are shown inside it instead of in a summary that closes it.
  */
  failure: { failed: PatchFinishReport['failed'] } | undefined;
  /**
  Bumped after a stopped attempt. The preview is read again from disk: the attempt may have moved
  the source and some results, and the retry must show (and plan from) what is really there.
  */
  refreshVersion: number;
  /** The source path the refreshed preview belongs to (the video may have moved). */
  refreshSourcePath: string | undefined;
}

export interface UsePatchFinishOptions {
  filePath: string | undefined;
  workRoot: string | undefined;
  /** The project file the cutting window saves (it knows the upstream output directory). */
  projectFilePath: string | undefined;
  patchMode: boolean;
  playerMode: boolean;
  mergedMode: boolean;
  /** The source of the results a results window is showing. */
  resultSourcePath: string | undefined;
  caseInsensitive: boolean;
  isWorking: () => boolean;
  /** Flush the debounced project autosave before the source (and its `.llc`) moves. */
  flushProjectSave: () => Promise<void>;
  /** Replace the source's path in the batch list (the file moved, the entry stays). */
  updateBatchSourcePath: (from: string, to: string) => void;
  /** Release the player's file without clearing the editor (the file is about to move). */
  releasePlayer: () => void;
  /** Attach the current source to the player again after a released operation failed. */
  reloadPlayer: () => void;
  /** Open the moved source again without clearing its segments (the export guard). */
  reloadSource: (path: string) => void;
  /**
  Unmount the ffmpeg-assisted preview (the repair player) for the duration of the job.

  Its ffmpeg streams the source for as long as the window shows it, so Windows keeps the file
  locked and the source can never be moved (see `main/ffmpegChildren.ts`). Unmounting aborts the
  process. Must take effect before the job starts.
  */
  suspendPreview: () => void;
  /** Mount the preview again once the job is over (success or stop). */
  resumePreview: () => void;
  /** Open the next source (or keep the last one open) once the job is over. */
  onJobFinished: (params: { previousSourcePath: string; report: PatchFinishReport; next: PatchFinishNextChoice; playerReleased: boolean }) => void;
  /** The naming inputs the finish rename renders with (the same the export dialog uses). */
  cutRenameNaming: { maxLabelLength: number; minZeroPadding: number; isWindows: boolean };
  /**
  The binding of `finishKeepSource` (`Shift+F` by default), used to say in the summary that the
  same key confirms it. Missing when the action has no binding.
  */
  skipConfirmKeys?: string | undefined;
  /**
  Called synchronously with `true` when `execute` starts, before its first `await`, and with
  `false` when it is over.

  `dialogProps.busy` only reaches the export guard after a render, so an export started in the gap
  (the permanent-delete confirmation, the project flush) would race the job that is already on its
  way. The export guard reads this signal together with `busy`.
  */
  onJobRunningChange?: ((running: boolean) => void) | undefined;
}

/**
The finish flow (fork-owned).

`Shift+E` opens the dialog for the window the key was pressed in: the merged window ends with the
merge, and the cut-results window and the cutting window end with the cut results (a merge is its
own step, `zm`). The cutting window always runs the job - it owns the batch list and the player the
job ends - so the results windows forward their request through the main process.
*/
export function usePatchFinish({
  filePath, workRoot, projectFilePath, patchMode, playerMode, mergedMode, resultSourcePath, caseInsensitive,
  isWorking, flushProjectSave, updateBatchSourcePath, releasePlayer, reloadPlayer, reloadSource, suspendPreview, resumePreview, onJobFinished,
  cutRenameNaming, skipConfirmKeys, onJobRunningChange,
}: UsePatchFinishOptions) {
  const { t } = useTranslation();
  // The naming inputs are three primitives: the state helper below must not re-render the plan when
  // an unrelated parent render hands in a new object.
  const { maxLabelLength: cutRenameMaxLabelLength, minZeroPadding: cutRenameMinZeroPadding, isWindows: cutRenameIsWindows } = cutRenameNaming;
  // The two confirmation boxes are governed by patch settings: the delete confirmation can be
  // switched off (and back on) in the working-directory settings, the summary is a silencable notice.
  const patchWork = usePatchWork();
  const patchNotice = usePatchNotice();
  const [state, setState] = useState<PatchFinishDialogState | undefined>();
  const requestIdRef = useRef(0);
  /** Set while `execute` runs: a second trigger must not start the same job twice. */
  const executingRef = useRef(false);
  /** Did this job release the player? The window has to attach the video again afterwards. */
  const playerReleasedRef = useRef(false);
  /** Was the ffmpeg-assisted preview unmounted for this job? It has to be mounted again after. */
  const previewSuspendedRef = useRef(false);
  /** Is the "video inside the work directory" folder dialog open? Repeated keys must not stack it. */
  const sourceInWorkAreaDialogOpenRef = useRef(false);
  /**
  Monotonic counter behind `refreshVersion` (a dialog reopened after a failure starts again at 0,
  so the version has to come from the hook, not from the dialog state).
  */
  const refreshCounterRef = useRef(0);

  /**
  The settings key of one workflow's remembered options.

  `Shift+E` (`finish`) and `Shift+F` (`keepSource`) keep separate slots: sharing one is how a skip
  job (source → `finished_skip_src`) used to decide what the next `Shift+E` job did with a source
  that belonged in the waiting-for-deletion folder.
  */
  const storedOptionKey = useCallback((flow: PatchFinishFlow, mode: 'merge' | 'cut') => {
    if (flow === 'keepSource') return mode === 'merge' ? 'finishKeepSourceMergeOptions' : 'finishKeepSourceCutOptions';
    return mode === 'merge' ? 'finishMergeOptions' : 'finishCutOptions';
  }, []);

  /**
  The merged-job options the dialog opens with.

  Nothing stored for this workflow yet (a first `Shift+F`, or any build before the workflows were
  split) opens on the workflow's own source; a stored `skip` never reaches `Shift+E`
  (`withFinishFlowSource`).
  */
  const readStoredMergeOptions = useCallback((flow: PatchFinishFlow): PatchFinishMergeOptions => {
    const raw: unknown = patchConfig.getPatchSetting(storedOptionKey(flow, 'merge'));
    const parsed = parsePatchFinishMergeOptions(raw);
    return {
      ...(raw == null ? { ...parsed, source: getDefaultFinishSource(flow) } : withFinishFlowSource(flow, parsed)),
      // The work-directory cleanup is deliberately not remembered: every dialog starts with `keep`.
      workDir: 'keep' as const,
    };
  }, [storedOptionKey]);
  const readStoredCutOptions = useCallback((flow: PatchFinishFlow): PatchFinishCutOptions => {
    const raw: unknown = patchConfig.getPatchSetting(storedOptionKey(flow, 'cut'));
    const parsed = parsePatchFinishCutOptions(raw);
    return {
      ...(raw == null ? { ...parsed, source: getDefaultFinishSource(flow) } : withFinishFlowSource(flow, parsed)),
      workDir: 'keep' as const,
    };
  }, [storedOptionKey]);

  const close = useCallback(() => setState(undefined), []);

  /**
  The names this attempt moves the cut results to.

  Rendered from the results the job starts with, and then **kept** for as long as the attempt keeps
  the same inputs. A retry after a half-finished job reads a preview with fewer results (the moved
  ones are gone); rendering again would renumber the rest and give one source two name schemes.
  Only a change the user makes (the rule, the separator, the switch, the target) renders again.
  */
  const resolveCutRename = useCallback(({ previous, preview, options }: {
    previous: Pick<PatchFinishDialogState, 'now' | 'renamePlan' | 'renamePlanKey' | 'renameProblem'>;
    preview: PatchFinishPreview;
    options: PatchFinishMergeOptions | PatchFinishCutOptions;
  }) => {
    if (preview.mode !== 'cut') return { renamePlan: [] as CutRenamePlanEntry[], renamePlanKey: '', renameProblem: undefined };
    const cutOptions = options as PatchFinishCutOptions;
    const { cutRename } = cutOptions;
    // A result that stays in the work area is not moved, so it has no final name to render. The
    // plan is also empty then, so the dialog shows no list of names the job would never use.
    if (cutOptions.clips === 'keep') return { renamePlan: [] as CutRenamePlanEntry[], renamePlanKey: `${previous.now}\u0000keep`, renameProblem: undefined };
    // Only this export's results are moved (and renamed). The results of earlier passes are deleted
    // or kept, so they have no final name of this job.
    const { selected } = splitClipsByExportSelection(preview.clips, preview.selectedSegIds);
    const targetDir = cutOptions.clips === 'source' ? preview.source.dir : preview.dirs.finishedClipsDir;
    // Everything the plan is rendered from, except the results themselves.
    const baseKey = [previous.now, cutRename.enabled, cutRename.rule, cutRename.labelSeparator, targetDir].join('\u0000');
    // The results are part of the key too: a result added while the dialog is open (an export runs
    // next to it, and a retry re-reads the preview) has no name in the old plan, so it would keep the
    // name the export gave it. Only *added* results re-render, though - a retry after a job stopped
    // halfway reads fewer results (the moved ones are gone), and re-rendering would renumber the
    // rest to names the already-moved files may hold (see `planCutRename`).
    const key = `${baseKey}\u0000${selected.map((clip) => clip.path).join('\u0001')}`;
    if (previous.renamePlanKey === key) {
      return { renamePlan: previous.renamePlan, renamePlanKey: key, renameProblem: previous.renameProblem };
    }
    // Same inputs, fewer results: keep the plan as it is (the moved results are filtered out for the
    // display; the executor only renames the results that are still there).
    if (previous.renameProblem == null && previous.renamePlanKey.startsWith(`${baseKey}\u0000`)) {
      const covered = new Set(previous.renamePlan.map((entry) => entry.from));
      const planCovers = (path: string) => covered.has(path)
        || previous.renamePlan.some((entry) => isSamePath(entry.from, path, { caseInsensitive }));
      if (selected.every((clip) => planCovers(clip.path))) {
        return { renamePlan: previous.renamePlan, renamePlanKey: key, renameProblem: undefined };
      }
    }
    if (!cutRename.enabled || selected.length === 0) {
      return { renamePlan: [] as CutRenamePlanEntry[], renamePlanKey: key, renameProblem: undefined };
    }
    const parsed = Date.parse(previous.now);
    const resolved = resolveFinishCutRename({
      rule: cutRename.rule,
      clips: selected,
      sourcePath: preview.source.path,
      targetDir,
      epochMs: Number.isNaN(parsed) ? Date.now() : parsed,
      labelSeparator: cutRename.labelSeparator,
      maxLabelLength: cutRenameMaxLabelLength,
      minZeroPadding: cutRenameMinZeroPadding,
      isWindows: cutRenameIsWindows,
      caseInsensitive,
    });
    if ('problem' in resolved) return { renamePlan: [] as CutRenamePlanEntry[], renamePlanKey: key, renameProblem: resolved.problem };
    return { renamePlan: resolved.plan, renamePlanKey: key, renameProblem: undefined };
  }, [caseInsensitive, cutRenameIsWindows, cutRenameMaxLabelLength, cutRenameMinZeroPadding]);

  /** The state after a (re)read preview: the same dialog, showing what is on disk now. */
  const withPreview = useCallback((
    previous: PatchFinishDialogState,
    preview: PatchFinishPreview,
    options: PatchFinishMergeOptions | PatchFinishCutOptions,
  ): PatchFinishDialogState => {
    const workDirClear = getFinishWorkDirClearView({
      mode: preview.mode, options, preview, now: new Date(previous.now), caseInsensitive,
    });
    const rename = resolveCutRename({ previous, preview, options });
    return {
      ...previous,
      loading: false,
      error: undefined,
      mode: preview.mode,
      preview,
      options,
      ...rename,
      problems: getFinishOptionProblems({
        mode: preview.mode,
        options,
        preview,
        workDirClearable: workDirClear.clearable,
        cutRenameBlocked: rename.renameProblem != null,
      }),
    };
  }, [caseInsensitive, resolveCutRename]);

  const openInCuttingWindow = useCallback(async (requested: PatchFinishModeRequest, flow: PatchFinishFlow) => {
    if (!patchMode || playerMode || mergedMode) return;
    // This window ends the job with the cut results: the merge is a step of its own (`zm`), and a
    // request that still arrives as `auto` (an older results window, the HTTP API) must not bring a
    // merge up here just because the source has one.
    const mode = resolveFinishWindowMode(requested, { windowKind: 'cutting' });
    // A job is running in this window: its state owns the dialog, and re-reading the preview now
    // would show a half-finished job as if it were the starting point of the next one.
    if (executingRef.current) {
      getSwal().toast.fire({ icon: 'warning', text: t('Wait for the current job to finish.') });
      return;
    }
    if (isWorking()) {
      getSwal().toast.fire({ icon: 'warning', text: t('Wait for the current export to finish.') });
      return;
    }
    if (filePath == null || workRoot == null) {
      errorToast(t('Open a source video first.'));
      return;
    }

    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setState({
      isShown: true,
      loading: true,
      busy: false,
      mode,
      flow,
      preview: undefined,
      options: readStoredMergeOptions(flow),
      problems: [],
      renamePlan: [],
      renamePlanKey: '',
      renameProblem: undefined,
      error: undefined,
      now: new Date().toISOString(),
      failure: undefined,
      refreshVersion: 0,
      refreshSourcePath: undefined,
    });

    try {
      const preview = await window.electron.patchFinishPreview({
        sourcePath: filePath,
        workRoot,
        ...((projectFilePath != null) && { projectFilePath }),
        mode,
      });
      // The user may have closed the dialog (or started another job) while the preview was read.
      if (requestIdRef.current !== requestId) return;
      // A read-only installation folder cannot take the (default) project store: fall back to
      // the app data store instead of a default that blocks the job.
      const stored = preview.mode === 'merge' ? readStoredMergeOptions(flow) : readStoredCutOptions(flow);
      // `Shift+F` is its own workflow: it reads its own slot (`skip` unless the user changed it) and
      // never sees what `Shift+E` remembered, or the two keys would rewrite each other's job.
      const options = withProjectChoiceOnOpen(
        stored,
        { installLlcWritable: preview.projectStores.installLlcWritable },
      );
      setState((previous) => (previous == null ? undefined : withPreview(previous, preview, options)));
    } catch (err) {
      console.error('Failed to read the finish preview', err);
      if (requestIdRef.current !== requestId) return;
      // Keep the dialog: the user can read the error and press the finish key again (the dialog's
      // retry button re-reads the preview), instead of losing the step and wondering what happened.
      setState((previous) => (previous == null
        ? undefined
        : { ...previous, loading: false, error: t('Could not read the results of this video. Try again.') }));
    }
  }, [filePath, isWorking, mergedMode, patchMode, playerMode, projectFilePath, readStoredMergeOptions, readStoredCutOptions, t, withPreview, workRoot]);

  /**
  `Shift+E` / `Shift+F` / the console: open the matching dialog here, or forward it to the cutting
  window.

  The flow is the only difference between the two keys: `Shift+E` ends a job the user worked on,
  `Shift+F` skips the video (the cutting intention is dropped). Each flow has its own remembered
  options, source destinations and presets; see `features/patchFinish/flow`.
  */
  const openFinish = useCallback((requested: PatchFinishModeRequest, flow: PatchFinishFlow = defaultPatchFinishFlow) => {
    const windowKind = resolveFinishWindowKind({ playerMode, mergedMode });
    if (mergedMode || playerMode) {
      // The job ends the way this window shows it: `Shift+E` in the merged window ends with the
      // merge, in the cut-results window with the cut results even when a merged result already
      // exists. An explicit request is forwarded as pressed: `zc` (`finishCut`) in the merged window
      // still finishes the cuts, and `zm` (`finishMerge`) in the clips window still merges.
      const request: PatchFinishDialogRequest = {
        mode: resolveFinishWindowMode(requested, { windowKind }),
        flow,
        ...((resultSourcePath != null) && { sourcePath: resultSourcePath }),
      };
      window.electron.patchRequestFinishDialog(request).catch((err: unknown) => {
        console.error('Failed to ask the cutting window for the finish dialog', err);
      });
      return;
    }
    openInCuttingWindow(resolveFinishWindowMode(requested, { windowKind }), flow).catch((err: unknown) => { console.error('Failed to open the finish dialog', err); });
  }, [mergedMode, openInCuttingWindow, playerMode, resultSourcePath]);

  // The cutting window receives the requests the results windows forwarded.
  useEffect(() => {
    if (!patchMode || playerMode || mergedMode) return undefined;
    const onRequest = (_event: unknown, request: PatchFinishDialogRequest) => {
      if (request.sourcePath != null && filePath != null && !isSamePath(request.sourcePath, filePath, { caseInsensitive })) {
        getSwal().toast.fire({ icon: 'warning', text: t('That result belongs to another source video. Open that source before finishing.') });
        return;
      }
      openInCuttingWindow(request.mode, request.flow ?? defaultPatchFinishFlow).catch((err: unknown) => { console.error('Failed to open the finish dialog', err); });
    };
    ipcRenderer.on(patchFinishDialogRequestChannel, onRequest);
    return () => { ipcRenderer.off(patchFinishDialogRequestChannel, onRequest); };
  }, [caseInsensitive, filePath, mergedMode, openInCuttingWindow, patchMode, playerMode, t]);

  /**
  Re-read the preview after an attempt that stopped halfway.

  The attempt may have moved the source and some results before it failed, and the retry has to
  show (and plan from) what is really on disk: the old preview would still name the old paths and
  could even block the retry (`clips-missing`, `source-missing`). The user's choices are kept; only
  the preview, the mode and the problems are recomputed.
  */
  const lastRefreshVersionRef = useRef(0);
  useEffect(() => {
    if (state == null || state.refreshVersion === 0 || (lastRefreshVersionRef.current === state.refreshVersion)) return;
    // Wait until this window follows a moved source: the preview is read from the path the retry uses.
    if (state.refreshSourcePath != null && (filePath == null || !isSamePath(filePath, state.refreshSourcePath, { caseInsensitive }))) return;
    if (filePath == null || workRoot == null) return;

    lastRefreshVersionRef.current = state.refreshVersion;
    const { mode } = state;
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    const read = async () => {
      setState((previous) => (previous == null ? previous : { ...previous, loading: true, error: undefined }));
      try {
        const preview = await window.electron.patchFinishPreview({
          sourcePath: filePath,
          workRoot,
          ...((projectFilePath != null) && { projectFilePath }),
          mode,
        });
        if (requestIdRef.current !== requestId) return;
        setState((previous) => (previous == null ? previous : withPreview(previous, preview, previous.options)));
      } catch (err) {
        console.error('Failed to read the finish preview again', err);
        if (requestIdRef.current !== requestId) return;
        setState((previous) => (previous == null
          ? previous
          : { ...previous, loading: false, error: t('Could not read the results of this video. Try again.') }));
      }
    };
    read().catch((err: unknown) => { console.error('Failed to refresh the finish preview', err); });
  }, [caseInsensitive, filePath, projectFilePath, state, t, withPreview, workRoot]);

  const setOptions = useCallback((mode: PatchFinishMode, options: PatchFinishMergeOptions | PatchFinishCutOptions) => {
    setState((previous) => {
      if (previous?.preview == null) return previous;
      const workDirClear = getFinishWorkDirClearView({
        mode, options, preview: previous.preview, now: new Date(previous.now), caseInsensitive,
      });
      // The cleanup checkbox is disabled when the folder would not pass the whitelist. Uncheck it
      // in the same step, so a different choice never leaves the job blocked by a stale `clear`.
      const nextOptions = options.workDir === 'clear' && !workDirClear.clearable
        ? { ...options, workDir: 'keep' as const }
        : options;
      // The rename plan follows the rule the user edits here (and is kept while they do not).
      const rename = resolveCutRename({ previous, preview: previous.preview, options: nextOptions });
      return {
        ...previous,
        options: nextOptions,
        ...rename,
        problems: getFinishOptionProblems({
          mode,
          options: nextOptions,
          preview: previous.preview,
          workDirClearable: workDirClear.clearable,
          cutRenameBlocked: rename.renameProblem != null,
        }),
      };
    });
  }, [caseInsensitive, resolveCutRename]);

  /**
  The label the summary names for the key that confirms it, when the skip workflow's key opened the
  dialog (`Shift+F`). An empty layout map is enough: the message names a modifier plus a key, and
  the built-in table covers both.
  */
  const skipConfirmLabel = useMemo(() => (skipConfirmKeys == null ? undefined : formatKeybinding(skipConfirmKeys, new Map())), [skipConfirmKeys]);

  const showSummary = useCallback(async (report: PatchFinishReport, flow: PatchFinishFlow, keptClipCount = 0) => {
    const escapeHtml = (text: string) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
    const lines: string[] = [];
    if (report.moved.length > 0) lines.push(escapeHtml(t('Moved {{count}} file(s).', { count: report.moved.length })));
    if (keptClipCount > 0) lines.push(escapeHtml(t('{{count}} cut result(s) stay in the work area.', { count: keptClipCount })));
    if (report.deleted.length > 0) lines.push(escapeHtml(t('Deleted {{count}} file(s).', { count: report.deleted.length })));
    if (report.workDirTrashed != null) lines.push(escapeHtml(t('The empty work folder was moved to the recycle bin. No files were deleted.')));
    if (report.warnings.includes('work-dir-not-clearable')) {
      lines.push(escapeHtml(t('The work folder was left in place because it still contains files or folders that are not part of the work area.')));
    } else if (report.warnings.includes('work-dir-trash-failed')) {
      lines.push(escapeHtml(t('The empty work folder could not be moved to the recycle bin.')));
    }
    if (report.failed.length > 0) {
      lines.push(escapeHtml(t('{{count}} file(s) could not be moved.', { count: report.failed.length })));
      // The reason says what to fix (a locked file, no permission); a partial job that only reports
      // a count leaves the user guessing which file it was.
      for (const failure of report.failed.slice(0, 3)) {
        lines.push(`<code>${escapeHtml(failure.path)}</code> ${escapeHtml(failure.reason)}`);
      }
      // The list is capped: never let it look like the job only failed on the named files.
      if (report.failed.length > 3) {
        lines.push(escapeHtml(t('{{count}} more file(s) are not listed.', { count: report.failed.length - 3 })));
      }
    }

    // A clean job may be silenced (the box starts ticked); a partial job or one with a warning is
    // always reported, and offers no box.
    const summaryBox = report.ok && report.warnings.length === 0
      ? doNotShowAgainBox({ label: t('Do not show this again'), checked: true })
      : undefined;
    // `Shift+F` opened this step, so pressing it again on the summary means "yes" (the delete
    // confirmation accepts it too). The arrow keys and Enter keep moving between the buttons.
    const confirmHint = flow === 'keepSource' && skipConfirmLabel != null
      ? `<div style="margin-top:.7em;font-size:.85em;opacity:.75">${escapeHtml(t('Press {{keys}} to confirm directly; the arrow keys and Enter choose a button as usual.', { keys: skipConfirmLabel }))}</div>`
      : '';
    const showSummaryDialog = patchNotice == null
      || shouldShowFinishSummaryNotice({ suppressed: patchNotice.suppressedNotices, ok: report.ok, hasWarnings: report.warnings.length > 0 });

    // The real paths the job left behind: the report has the final names (a taken name already got
    // its ` (n)` suffix), so nothing here re-derives them from the preview. A click copies one, and
    // the button at the bottom of the dialog copies all of them (or opens their folder).
    const summaryPaths = listSummaryPaths({
      results: report.results,
      newSourcePath: report.newSourcePath,
      flow,
      caseInsensitive,
    });
    const copyPaths = (text: string, count: number) => {
      window.electron.writeClipboardText(text).catch((err: unknown) => { console.error('Failed to copy a path', err); });
      getSwal().toast.fire({ icon: 'info', text: t('Copied {{count}} path(s).', { count }) });
    };
    const pathCodeStyle = 'display:inline-block;max-width:100%;padding:.05em .35em;border-radius:3px;background:rgba(127,127,127,.18);font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:.85em;line-height:1.35;white-space:normal;word-break:break-all;user-select:text;cursor:pointer';
    const pathListHtml = summaryPaths.shown.length === 0
      ? ''
      : [
        '<div style="margin-top:.75em">',
        ...summaryPaths.shown.map((entry, index) => `<div style="margin-top:.25em;text-align:left"><code data-patch-summary-path="${index}" title="${escapeHtml(t('Click to copy the path'))}" style="${pathCodeStyle}">${escapeHtml(entry.path)}</code></div>`),
        summaryPaths.hidden > 0
          ? `<div style="margin-top:.35em;font-size:.85em;opacity:.75">${escapeHtml(t('{{count}} more path(s) are not listed.', { count: summaryPaths.hidden }))}</div>`
          : '',
        '</div>',
      ].join('');
    // Only the skip workflow copies from a button: there the paths are what the user keeps, while the
    // finish workflow's own button has always opened the kept folder.
    const copiesFromButton = flow === 'keepSource';

    const result = showSummaryDialog
      ? await getSwal().Swal.fire(withConfirmKeys(withNonDestructiveDeny({
        icon: report.ok ? 'success' : 'warning',
        title: t(report.ok ? 'The job is finished' : 'The job is only partly finished'),
        html: lines.map((line) => `<div>${line}</div>`).join('') + pathListHtml + (summaryBox?.html ?? '') + confirmHint,
        confirmButtonText: t('OK'),
        // "Open and select it" is the whole point of a path list; without a file that still exists
        // there is nothing to select, so the button is left out instead of going dead.
        ...(summaryPaths.revealTarget != null && { showDenyButton: true, denyButtonText: t('Open and select the file') }),
        ...(copiesFromButton
          ? { showCancelButton: true, cancelButtonText: t('Copy the paths') }
          : (report.touchedDirs.length > 0 ? { showCancelButton: true, cancelButtonText: t('Open the folder') } : {})),
        didOpen: (popup: HTMLElement) => {
          summaryBox?.bind(popup);
          popup.querySelectorAll<HTMLElement>('[data-patch-summary-path]').forEach((element) => {
            element.addEventListener('click', () => {
              const entry = summaryPaths.shown[Number(element.dataset['patchSummaryPath'])];
              if (entry != null) copyPaths(entry.path, 1);
            });
          });
        },
      }), { includeSkipKey: true }))
      : undefined;
    // The box only counts when the summary was acknowledged. Pressing it away (Esc) changes nothing.
    if (summaryBox != null && patchNotice != null && result?.isConfirmed === true) {
      if (summaryBox.isChecked()) patchNotice.suppress(patchNoticeFinishSummary);
      else patchNotice.unsuppress(patchNoticeFinishSummary);
    }
    // The job lists the folders it touched in move order, which starts with the source - on the
    // default choices that is `detached_src_media`, the folder of what is about to be deleted. Open
    // what was kept instead (see `pickSummaryFolder`).
    const openDir = pickSummaryFolder({ touchedDirs: report.touchedDirs, dirNames: patchWork?.dirNames });
    // Only the buttons act here: Esc and a click outside the dialog dismiss it as well, and they must
    // not start a file manager (or overwrite the clipboard).
    if (result?.isDenied) {
      const target = summaryPaths.revealTarget;
      if (target != null) {
        const outcome = await window.electron.patchRevealPath(target.path);
        // The file may be gone by now (the job deleted it, or the user moved it): the main process
        // then shows its folder, and only a real failure is reported.
        if (outcome === 'failed') getSwal().toast.fire({ icon: 'warning', text: t('The file could not be shown in the file manager.') });
      }
    } else if (result?.dismiss === 'cancel') {
      if (copiesFromButton) copyPaths(summaryPaths.shown.map((entry) => entry.path).join('\n'), summaryPaths.shown.length);
      else if (openDir != null) await window.electron.patchOpenWorkPath(openDir);
    }

    // A silenced summary stays silent: one line without a path, so the user still learns that the job
    // ran without being asked to acknowledge anything.
    if (!showSummaryDialog && report.moved.length > 0) {
      getSwal().toast.fire({ icon: 'info', text: t('Moved {{count}} file(s).', { count: report.moved.length }) });
    }

    // A refused recycle bin is reported on its own, with a shortcut to the folder's parent.
    if (report.workDirTrashFailed != null) {
      await showWorkDirTrashFailureDialog({ t, failures: [report.workDirTrashFailed] });
    }
  }, [caseInsensitive, patchNotice, patchWork?.dirNames, skipConfirmLabel, t]);

  const execute = useCallback(async () => {
    const current = state;
    if (current?.preview == null || current.busy || current.loading || filePath == null || workRoot == null) return;
    // Two triggers can arrive before React re-renders the disabled button (a double click, a
    // keyboard action and a console command in the same tick): one job at a time.
    if (executingRef.current) return;
    // The export writes into the same work area: moving or deleting its files would race it.
    if (isWorking()) {
      getSwal().toast.fire({ icon: 'warning', text: t('Wait for the current export to finish.') });
      return;
    }

    const { mode, preview, options, renamePlan, renameProblem } = current;
    const workDirClear = getFinishWorkDirClearView({
      mode, options, preview, now: new Date(current.now), caseInsensitive,
    });
    // The same check the dialog disables its button with, including the rename rule: this one runs
    // on the state the job would really use, so a second trigger (a key, a double click) cannot
    // start a job whose results the rule cannot name - it would move them under their old names.
    if (getFinishOptionProblems({
      mode, options, preview, workDirClearable: workDirClear.clearable, cutRenameBlocked: renameProblem != null,
    }).length > 0) return;

    executingRef.current = true;
    // Told synchronously, before the confirmations and the save below: an export started in that
    // gap would write the very files this job is about to move.
    onJobRunningChange?.(true);
    playerReleasedRef.current = false;
    try {
      const deleteCount = getPermanentDeleteCount({ mode, options, preview });
      // The confirmation can be switched off for good; its box starts *unchecked*, so silencing it
      // takes a deliberate tick (a permanent delete cannot be undone).
      // The count is the authoritative "how many files this job permanently deletes" (including the
      // stale results of earlier passes), so no separate delete-choice check is needed.
      if (deleteCount > 0 && (patchWork?.confirmFinishPermanentDelete ?? true)) {
        // Same rule as the count, so the size never includes a file the job leaves on disk (a merged
        // result outside the work area, or clips a stale merge cannot cover).
        const totalSize = getPermanentDeleteSize({ mode, options, preview });
        const box = doNotShowAgainBox({ label: t('Do not show this again'), checked: false });
        const confirmed = await getSwal().Swal.fire(withConfirmKeys({
          icon: 'warning',
          title: t('Permanently delete {{count}} file(s)?', { count: deleteCount }),
          html: t('This cannot be undone. About {{size}} becomes free. Moving a file to a folder on the same disk does not free space; permanently deleting the file does.', { size: formatMegabytes(totalSize) }) + box.html,
          showCancelButton: true,
          confirmButtonText: t('Delete permanently'),
          cancelButtonText: t('Cancel'),
          // patch: the finish key was pressed twice to get here, so Enter confirms the deletion
          // instead of silently cancelling it (a focused Cancel button made the whole job look like
          // it did nothing). Cancel is still one Tab or Esc away.
          focusConfirm: true,
          focusCancel: false,
          didOpen: (popup: HTMLElement) => box.bind(popup),
        }, { includeSkipKey: true }));
        if (!confirmed.isConfirmed) return;
        // A dismissed dialog (Esc, the backdrop) must not change the setting.
        if (box.isChecked()) patchWork?.setConfirmFinishPermanentDelete(false);
      }

      setState((previous) => (previous == null
        ? previous
        : { ...previous, busy: true, error: undefined, failure: undefined }));
      await flushProjectSave();

      // patch: the source is about to be renamed/moved, and Windows refuses that while this window
      // plays it. Let go of the file first (the video is attached again when the job is over): waiting
      // for the failure and retrying once left the first attempt failing on a lock this app held.
      // The repair preview locks the file on its own - its ffmpeg streams the source for as long as
      // the window shows it - so it is unmounted as well.
      if (resolveSourceChoice(mode, options) !== 'keep') {
        suspendPreview();
        previewSuspendedRef.current = true;
        releasePlayer();
        playerReleasedRef.current = true;
      }

      const params: PatchFinishJobParams = {
        sourcePath: filePath,
        workRoot,
        ...((projectFilePath != null) && { projectFilePath }),
        mode,
        options,
        // patch: the names rendered for this attempt (the retry must move the remaining results to
        // the names the first attempt planned, see `resolveCutRename`).
        ...((renamePlan.length > 0) && { renamePlan }),
        now: current.now,
      };
      let report = await window.electron.patchFinishJob(params);

      // The cutting window's player may still hold the source: release it and retry once.
      const [failure] = report.failed;
      if (!report.ok && report.moved.length === 0 && failure != null && isFileLockError({ code: failure.reason })) {
        releasePlayer();
        playerReleasedRef.current = true;
        await sleep(400);
        report = await window.electron.patchFinishJob(params);
      }

      // Remembered per workflow: `Shift+F` writes its own slot, so it can never decide what the next
      // `Shift+E` job does with a source (or the other way round).
      if (mode === 'merge' || mode === 'cut') patchConfig.setPatchSetting(storedOptionKey(current.flow, mode), { ...options, workDir: 'keep' });

      // The attempt may have moved the source before it stopped: the batch entry follows it either
      // way, or the next attempt (and every other patch flow) would point at a file that is gone.
      if (report.ok) {
        if (report.newSourcePath != null) updateBatchSourcePath(filePath, report.newSourcePath);
      } else {
        // A stopped job keeps the dialog: the user fixes the cause and presses the finish key again.
        // It never loads the next source - the current one is not finished.
        const outcome = planFinishFailureOutcome({
          previousSourcePath: filePath,
          newSourcePath: report.newSourcePath,
          playerReleased: playerReleasedRef.current,
        });
        if (outcome.batch != null) updateBatchSourcePath(outcome.batch.from, outcome.batch.to);
        if (outcome.moved) reloadSource(outcome.sourcePath);
        else if (outcome.reload) reloadPlayer();
        refreshCounterRef.current += 1;
        const refreshVersion = refreshCounterRef.current;
        setState((previous) => (previous == null ? previous : {
          ...previous,
          busy: false,
          failure: { failed: report.failed },
          refreshVersion,
          refreshSourcePath: outcome.sourcePath,
        }));
        return;
      }

      setState(undefined);

      await showSummary(report, current.flow, countCutResultsLeftInWorkArea({ mode, options, preview }));
      onJobFinished({ previousSourcePath: filePath, report, next: options.next, playerReleased: playerReleasedRef.current });
    } catch (err) {
      console.error('Failed to finish the job', err);
      // Keep the dialog as well: the job may not even have started (a full work area, a refusal), and
      // closing it would hide what happened.
      setState((previous) => (previous == null ? previous : { ...previous, busy: false, error: describeFinishJobError(err, t) }));
      // The player was released for a move that did not happen: attach the source again.
      if (playerReleasedRef.current) reloadPlayer();
    } finally {
      executingRef.current = false;
      onJobRunningChange?.(false);
      playerReleasedRef.current = false;
      // patch: mount the repair preview again - the job is over, stopped or not, so the source may be
      // read again (a stopped job needs it more than ever, the user keeps cutting).
      if (previewSuspendedRef.current) {
        previewSuspendedRef.current = false;
        resumePreview();
      }
    }
  }, [caseInsensitive, filePath, flushProjectSave, isWorking, onJobFinished, onJobRunningChange, patchWork, projectFilePath, reloadPlayer, reloadSource, releasePlayer, resumePreview, showSummary, state, storedOptionKey, suspendPreview, t, updateBatchSourcePath, workRoot]);

  const dialogProps = useMemo(() => (state == null ? undefined : {
    ...state,
    workDirClear: state.preview == null
      ? { clearable: false, blockers: [] as string[] }
      : getFinishWorkDirClearView({
        mode: state.mode, options: state.options, preview: state.preview, now: new Date(state.now), caseInsensitive,
      }),
    // The plan is per attempt, so a retry may plan more results than the preview still shows: the
    // dialog lists the ones the job is about to move.
    cutRenamePreview: (() => {
      if (state.renameProblem != null) return { lines: [] as string[], paths: [] as string[], error: state.renameProblem };
      const { preview } = state;
      // Only this export's results are moved and renamed; stale results are deleted or kept.
      const moved = preview == null ? [] : splitClipsByExportSelection(preview.clips, preview.selectedSegIds).selected;
      const present = new Set(moved.map((clip) => clip.path));
      const entries = state.renamePlan.filter((entry) => present.has(entry.from));
      // The folder the results go to, or `undefined` when the job deletes them instead of moving them
      // (a deleted result has no final path to show).
      let targetDir: string | undefined;
      if (preview != null) {
        if (state.mode === 'merge') {
          if ((state.options as PatchFinishMergeOptions).clips === 'detached') targetDir = preview.dirs.detachedClipsDir;
        } else {
          targetDir = (state.options as PatchFinishCutOptions).clips === 'source' ? preview.source.dir : preview.dirs.finishedClipsDir;
        }
      }
      const clips = moved.filter((clip) => present.has(clip.path));
      return {
        lines: entries.map((entry) => entry.fileName),
        paths: listPreviewResultPaths({ clips, dir: targetDir, plan: state.renamePlan, caseInsensitive }),
      };
    })(),
    onClose: close,
    onExecute: execute,
    onOptionsChange: setOptions,
    // The preview could not be read: read it again instead of making the user close and reopen the step.
    onRetry: () => { openInCuttingWindow(state.mode, state.flow).catch((err: unknown) => { console.error('Failed to reopen the finish dialog', err); }); },
  }), [caseInsensitive, close, execute, openInCuttingWindow, setOptions, state]);

  /**
  The export guard (fork-owned).

  A source video that sits inside a `.losslesscut_work` or `losslesscut_finished` directory is
  almost always a video whose finish job already ran: cutting it there would create a work area
  inside a work area (and without a working directory it would put the new results next to the old
  ones), and a finished result must not be cut again in place. The app must not move the file behind
  the user's back - the user may want to delete it, or the merged result, by hand. So the dialog only
  opens the two folders that matter and stops the export.

  No `withConfirmKeys`: E / Shift+E is what got the user here, and pressing it again must not count
  as a confirmation. Mouse, arrow keys, Tab and Enter are enough.
  */
  const ensureSourceOutsideWorkArea = useCallback(async (): Promise<boolean> => {
    if (!patchMode || playerMode || mergedMode || filePath == null || (resolveReadOnlySourceArea(filePath, patchWork?.dirNames) == null)) return true;
    if (sourceInWorkAreaDialogOpenRef.current) return false;
    sourceInWorkAreaDialogOpenRef.current = true;

    const openFolder = async (dir: string, missingText: string) => {
      try {
        if (await window.electron.patchOpenWorkPath(dir)) return;
      } catch (err) {
        console.error('Failed to open a folder', err);
      }
      getSwal().toast.fire({ icon: 'info', text: missingText });
    };

    try {
      const answer = await getSwal().Swal.fire(withNonDestructiveDeny({
        icon: 'warning',
        title: t('The video is inside the work directory or the finished folder'),
        text: t('It is probably a video whose cutting has already finished. Open one of these folders and handle the files there.'),
        showDenyButton: true,
        showCancelButton: true,
        confirmButtonText: t('Open the video\'s folder'),
        denyButtonText: t('Open the merged result folder'),
        cancelButtonText: t('Cancel'),
      }));
      if (answer.isConfirmed) {
        await openFolder(dirname(filePath), t('The folder could not be opened.'));
      } else if (answer.isDenied) {
        try {
          if (!await window.electron.patchOpenMergedResultFolder(filePath)) getSwal().toast.fire({ icon: 'info', text: t('No merged result folder was found.') });
        } catch (err) {
          console.error('Failed to open the merged result folder', err);
          getSwal().toast.fire({ icon: 'info', text: t('The folder could not be opened.') });
        }
      }
      return false;
    } finally {
      sourceInWorkAreaDialogOpenRef.current = false;
    }
  }, [filePath, mergedMode, patchMode, patchWork?.dirNames, playerMode, t]);

  return { openFinish, dialogProps, ensureSourceOutsideWorkArea };
}
