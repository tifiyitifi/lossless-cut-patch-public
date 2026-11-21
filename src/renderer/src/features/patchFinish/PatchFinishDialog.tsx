import type { ReactNode } from 'react';
import { useEffect } from 'react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';

import type {
  PatchFinishCutOptions, PatchFinishFlow, PatchFinishMergedChoice, PatchFinishMergeOptions, PatchFinishMode, PatchFinishPreview, PatchFinishReport,
  PatchFinishSourceChoice, PatchFinishWarning, PatchFinishWorkDirClearView, PatchFinishFailureKind,
} from '../../../../common/features/patchFinish';
import {
  classifyFinishFailureReason, defaultSummaryPathLimit, getFinishDialogTitleVariant, getFinishPresetChoices, getFinishSourceChoices, getMergedTargetPath, getPathFileName,
  getProjectDateSubdir, isMergedRebuildableFromClips, resolveProjectTargetDir, splitClipsByExportSelection,
} from '../../../../common/features/patchFinish';
import { resolveFinishPreset, resolvePresetOptions } from '../../../../common/features/patchFinish/presets';
import type { PatchFinishDialogTitleVariant } from '../../../../common/features/patchFinish/dialogTitle';
import type { PatchFinishPresetChoice } from '../../../../common/features/patchFinish/presets';
import type { PatchFinishOptionProblem } from '../../../../common/features/patchFinish/plan';
import { defaultPatchWorkDirName } from '../../../../common/features/patchWork';
import { cutRuleSeparatesClips, defaultFinishCutRenameRule, finishCutRenamePresets } from '../../../../common/features/patchData/cutName';

import * as Dialog from '../../components/Dialog';
import { showOpenDialog } from '../../dialogs';
import getSwal from '../../swal';
import { isModifierOnlyEvent, matchesKeyBinding } from '../patch/keyMatch';
import { usePatchWork } from '../patchWork/PatchWorkProvider';
import NameRuleEditor from '../patchNameRule/NameRuleEditor';
import formatMegabytes from './format';

/**
The finish dialog (fork-owned).

Two variants share one component: the merge job moves the merged result, and the cut-only job moves
a merged result it found to `finished_merged` by default (it can also delete it or keep it). Every
choice has a safe default and the summary at the bottom says exactly which files will move and
which will be deleted permanently.

The same component serves the two workflows (`flow`): `Shift+E` ends a job the user worked on, and
`Shift+F` skips the video. They differ in their presets, their source destinations (only the skip
workflow offers `finished_skip_src`) and the title - never in layout.
*/

type FinishOptions = PatchFinishMergeOptions | PatchFinishCutOptions;

export interface PatchFinishDialogProps {
  isShown: boolean;
  loading: boolean;
  busy: boolean;
  mode: PatchFinishMode;
  /** `finish` (`Shift+E`) or `keepSource` (`Shift+F`); see `features/patchFinish/flow`. */
  flow: PatchFinishFlow;
  preview: PatchFinishPreview | undefined;
  options: FinishOptions;
  problems: PatchFinishOptionProblem[];
  /** Predicted result of the empty-work-directory cleanup (shared with the executor's check). */
  workDirClear: PatchFinishWorkDirClearView;
  /**
  patch: the names the cut results are moved to (see `features/patchFinish/cutRename`), and why the
  rename rule cannot render them. Only the results still on disk are listed.
  */
  cutRenamePreview: { lines: readonly string[]; paths: readonly string[]; error?: string | undefined };
  /** ISO time the dialog was opened: the date folders stay put even when the dialog stays open. */
  now: string;
  /** The last attempt stopped before it was done: the job did not continue and nothing else runs. */
  failure: { failed: PatchFinishReport['failed'] } | undefined;
  /** The preview could not be read (or the job could not start): show why, and offer a retry. */
  error: string | undefined;
  /**
  The keys that open this dialog (`finish`, `finishMerge`, `finishCut`, `finishKeepSource`).

  The same key starts the job while the dialog is open: it opened the dialog, so pressing it
  again means "go ahead". The upstream keyboard hook ignores keys typed into a dialog, so the
  dialog listens for them itself.
  */
  executeKeys: readonly string[];
  onClose: () => void;
  onExecute: () => void;
  onOptionsChange: (mode: PatchFinishMode, options: FinishOptions) => void;
  /** Read the preview again after an error (the disk may have changed: another window, a lock). */
  onRetry: () => void;
}

function Section({ title, children }: { title: string, children: ReactNode }) {
  return (
    <section style={{ marginTop: '1em', paddingTop: '.7em', borderTop: '1px solid var(--gray-6)' }}>
      <div style={{ fontWeight: 'bold', marginBottom: '.4em' }}>{title}</div>
      {children}
    </section>
  );
}

function Option({ id, name, checked, disabled, onSelect, children }: {
  id: string;
  name: string;
  checked: boolean;
  disabled?: boolean | undefined;
  onSelect: () => void;
  children: ReactNode;
}) {
  return (
    <div style={{ display: 'flex', gap: '.45em', alignItems: 'flex-start', margin: '.25em 0' }}>
      <input id={id} type="radio" name={name} checked={checked} disabled={disabled} onChange={onSelect} style={{ marginTop: '.25em' }} />
      <label htmlFor={id} style={{ cursor: disabled === true ? 'default' : 'pointer', opacity: disabled === true ? 0.55 : 1 }}>{children}</label>
    </div>
  );
}

function PathLine({ path, size }: { path: string, size: number | undefined }) {
  return (
    <div style={{ fontSize: '.9em', color: 'var(--gray-11)', wordBreak: 'break-all' }}>
      <code>{path}</code>
      {size != null && <span>{` (${formatMegabytes(size)})`}</span>}
    </div>
  );
}

function useWarningText(warning: PatchFinishWarning) {
  const { t } = useTranslation();
  switch (warning) {
    case 'no-record': {
      return t('The app does not track the results of this video, so only the source video can be moved.');
    }
    case 'source-missing': {
      return t('The source video is no longer on disk.');
    }
    case 'source-unreadable': {
      return t('The source video could not be read. Check that it is not locked by another app.');
    }
    case 'source-inside-work-area': {
      return t('The source video is inside a work directory, so it is probably already finished. Open the folder and handle the files there.');
    }
    case 'merged-missing': {
      return t('The merged result is no longer on disk.');
    }
    case 'merged-unreadable': {
      return t('The merged result could not be read. Check that it is not locked by another app.');
    }
    case 'merged-stale': {
      return t('The merged result does not contain the current cut results, so the cut results cannot be deleted.');
    }
    case 'clips-outside-work-area': {
      return t('Some results are outside this work area. They are not touched.');
    }
    case 'clips-unreadable': {
      return t('Some cut results could not be read, so they are left out of this job.');
    }
    case 'clips-missing': {
      return t('Some cut results tracked by the export manifest are no longer at their recorded path, so they are left out of this job.');
    }
    case 'merged-outside-work-area': {
      return t('The merged result is outside this work area, so it cannot be deleted here.');
    }
    case 'project-move-failed': {
      return t('The project file could not be moved.');
    }
    case 'project-unreadable': {
      return t('The project file exists but could not be read, so it is left where it is.');
    }
    case 'work-dir-unreadable': {
      return t('The work directory could not be read, so it cannot be cleaned automatically.');
    }
    case 'work-dir-not-clearable': {
      return t('The work folder was left in place because it still contains files or folders that are not part of the work area.');
    }
    case 'work-dir-trash-failed': {
      return t('The empty work folder could not be moved to the recycle bin, so it was left in place.');
    }
    default: {
      return warning;
    }
  }
}

function WarningLine({ warning }: { warning: PatchFinishWarning }) {
  const text = useWarningText(warning);
  return <div style={{ marginTop: '.25em' }}>{text}</div>;
}

function useProblemText(problem: PatchFinishOptionProblem) {
  const { t } = useTranslation();
  switch (problem) {
    case 'source-missing': {
      return t('The source video is no longer on disk.');
    }
    case 'source-unreadable': {
      return t('The source video could not be read. Check that it is not locked by another app.');
    }
    case 'source-inside-work-area': {
      return t('The source video is already inside a work directory. Open the folder and handle the files there instead of finishing it again.');
    }
    case 'project-dir-missing': {
      return t('Choose a folder for the project file.');
    }
    case 'project-dir-unwritable': {
      return t('The installation folder cannot be written to. Choose another folder for the project file.');
    }
    case 'merged-required': {
      return t('There is no merged result to move.');
    }
    case 'clips-delete-unsafe': {
      return t('The cut results cannot be deleted until the merged result is up to date.');
    }
    case 'clips-missing': {
      return t('Some cut results are missing from where the export manifest recorded them. Restore them, or clear the export manifest, before finishing.');
    }
    case 'files-in-use': {
      return t('Some cut results are being played in another window. Stop them there first.');
    }
    case 'work-dir-not-clearable': {
      return t('The work directory still contains files or folders that are not part of the work area. It cannot be cleaned automatically.');
    }
    case 'cut-rename-invalid': {
      return t('The cut results cannot be renamed with this rule. Fix the rule, or turn the rename off, to continue.');
    }
    case 'nothing-to-do': {
      return t('Choose at least one thing to do.');
    }
    default: {
      return problem;
    }
  }
}

function ProblemLine({ problem }: { problem: PatchFinishOptionProblem }) {
  const text = useProblemText(problem);
  return <div>{text}</div>;
}

/**
What the user can do about one file the job could not handle.

A stopped job is only useful if it says how to make the next attempt work: an error code alone
("EPERM") leaves the user guessing. An unknown reason is shown as it is - it is the only hint left.
*/
function useFailureAdvice(kind: PatchFinishFailureKind) {
  const { t } = useTranslation();
  switch (kind) {
    case 'locked': {
      return t('This file is in use: another program, or this app\'s own preview (the repaired playback, the waveform or the thumbnails). Stop it and try again.');
    }
    case 'permission': {
      return t('This file or folder cannot be changed from here. Check the permissions, or choose another folder.');
    }
    case 'missing': {
      return t('The file is no longer at this path. It may already have been moved.');
    }
    case 'no-space': {
      return t('The target drive is full. Free some space and try again.');
    }
    case 'other-volume': {
      return t('The target is on another drive, so the file has to be copied first.');
    }
    default: {
      return undefined;
    }
  }
}

function FailureLine({ failure }: { failure: PatchFinishReport['failed'][number] }) {
  const advice = useFailureAdvice(classifyFinishFailureReason(failure.reason));
  return (
    <div style={{ marginTop: '.35em' }}>
      <code style={{ wordBreak: 'break-all' }}>{failure.path}</code>
      <div>{advice ?? failure.reason}</div>
      {/* The raw code is the only hint left when the advice is generic; keep it for bug reports. */}
      {advice != null && <div style={{ opacity: 0.7 }}><code>{failure.reason}</code></div>}
    </div>
  );
}

/** A red panel for something the user has to act on before the job can finish. */
const errorPanelStyle = {
  marginTop: '.8em',
  padding: '.6em .7em',
  border: '1px solid var(--red-7)',
  borderRadius: '.3em',
  background: 'var(--red-2)',
  color: 'var(--red-11)',
  fontSize: '.9em',
};

/** The job stopped halfway: it did not continue, and the dialog stays open for the next attempt. */
function FailureBlock({ failure }: { failure: { failed: PatchFinishReport['failed'] } }) {
  const { t } = useTranslation();
  return (
    <div style={errorPanelStyle}>
      <div style={{ fontWeight: 'bold' }}>{t('The job stopped before it was done.')}</div>
      <div>{t('Fix the cause and press the finish key again: the job continues with what is left. Nothing was sent to the next video.')}</div>
      {failure.failed.map((entry) => <FailureLine key={`${entry.path}:${entry.reason}`} failure={entry} />)}
    </div>
  );
}

function mergedTargetText({ t, preview, choice }: { t: TFunction, preview: PatchFinishPreview, choice: PatchFinishMergedChoice }) {
  const target = getMergedTargetPath({
    mergedPath: preview.merged?.path ?? '',
    sourcePath: preview.source.path,
    sourceDir: preview.source.dir,
    finishedMergedDir: preview.dirs.finishedMergedDir,
    choice,
  });
  // The executor adds a ` (n)` suffix when the name is taken, so say so instead of promising a path.
  return t('The merged result becomes {{path}} (a number is added if that name is taken).', { path: target });
}

function clipsTargetText({ t, mode, preview, mergeOptions, cutOptions }: {
  t: TFunction,
  mode: PatchFinishMode,
  preview: PatchFinishPreview,
  mergeOptions: PatchFinishMergeOptions | undefined,
  cutOptions: PatchFinishCutOptions | undefined,
}) {
  // Only this export's results are moved or deleted by the clip choice; the results of earlier passes
  // are reported separately below.
  const { selected } = splitClipsByExportSelection(preview.clips, preview.selectedSegIds);
  const count = selected.length;
  const size = selected.reduce((total, clip) => total + clip.size, 0);
  if (mode === 'merge') {
    // Ask what the executor will really do: a stale merged result moves the cut results aside
    // instead of deleting them (the Execute button stays disabled in that case).
    if (mergeOptions?.clips === 'keep') return t('{{count}} cut result(s) stay in the work area.', { count });
    return mergeOptions?.clips === 'delete' && preview.mergedCoversClips
      ? t('{{count}} cut result(s) are permanently deleted ({{size}}).', { count, size: formatMegabytes(size) })
      : t('{{count}} cut result(s) move to {{dir}}.', { count, dir: preview.dirs.detachedClipsDir });
  }
  if (cutOptions?.clips === 'keep') return t('{{count}} cut result(s) stay in the work area.', { count });
  return cutOptions?.clips === 'finished'
    ? t('{{count}} cut result(s) move to {{dir}}.', { count, dir: preview.dirs.finishedClipsDir })
    : t('{{count}} cut result(s) move back to the source folder.', { count });
}

/**
What happens to this export's cut clips, as one line (fork-owned).

The count and the action read together, so "how many move" is answered without matching the count
to a control further down. The noun follows the action: only a clip the job moves out of the work
area is a "cut result"; one that stays (or is deleted) is a cut clip, and in a merge the clips are
the merge's inputs. The target is the one the executor will really use: a merge that cannot prove it
covers the clips moves them aside instead of deleting them.
*/
function thisExportClipsLine({ t, mode, preview, mergeOptions, cutOptions }: {
  t: TFunction,
  mode: PatchFinishMode,
  preview: PatchFinishPreview,
  mergeOptions: PatchFinishMergeOptions | undefined,
  cutOptions: PatchFinishCutOptions | undefined,
}) {
  const { selected } = splitClipsByExportSelection(preview.clips, preview.selectedSegIds);
  const count = selected.length;
  if (mode === 'merge') {
    if (mergeOptions?.clips === 'keep') return t('This export: {{count}} cut clip(s) → stay in the work area', { count });
    return mergeOptions?.clips === 'delete' && preview.mergedCoversClips
      ? t('This export: {{count}} cut clip(s) → permanently deleted', { count })
      : t('This export: {{count}} cut clip(s) → move to detached_clips', { count });
  }
  if (cutOptions?.clips === 'keep') return t('This export: {{count}} cut clip(s) → stay in the work area', { count });
  return cutOptions?.clips === 'source'
    ? t('This export: {{count}} cut result(s) → move back to the source folder', { count })
    : t('This export: {{count}} cut result(s) → move to finished_clips', { count });
}

/**
What happens to the temporary clips earlier passes left in the work area (fork-owned).

They are not this export's results: the job either deletes them (the video is done) or leaves them
for the next pass. The line states the current choice next to the count.
*/
function earlierPassesClipsLine({ t, preview, deletesThem }: {
  t: TFunction,
  preview: PatchFinishPreview,
  deletesThem: boolean,
}) {
  const { stale } = splitClipsByExportSelection(preview.clips, preview.selectedSegIds);
  return deletesThem
    ? t('Earlier passes: {{count}} temporary clip(s) → permanently deleted', { count: stale.length })
    : t('Earlier passes: {{count}} temporary clip(s) → stay in the work area', { count: stale.length });
}

/**
The final paths of the kept results, under the summary (fork-owned).

The completion summary shows the same list after the job; this one is before it, so the user can see
where the results will land (and copy a path they will need later). Clicking a path copies it, the
row is selectable text too, and the list is capped the same way: a job with forty clips must not push
the buttons off the screen.
*/
function FinalPaths({ paths }: { paths: readonly string[] }) {
  const { t } = useTranslation();
  const shown = paths.slice(0, defaultSummaryPathLimit);
  const hidden = paths.length - shown.length;

  return (
    <div style={{ marginTop: '.8em', fontSize: '.9em', color: 'var(--gray-11)' }}>
      <div style={{ fontWeight: 'bold' }}>{t('Final paths')}</div>
      {shown.map((path) => (
        <div key={path} style={{ marginTop: '.25em', textAlign: 'left' }}>
          <button
            type="button"
            title={t('Click to copy the path')}
            onClick={() => {
              window.electron.writeClipboardText(path).catch((err: unknown) => { console.error('Failed to copy a path', err); });
              getSwal().toast.fire({ icon: 'info', text: t('Copied {{count}} path(s).', { count: 1 }) });
            }}
            style={{
              display: 'inline-block',
              maxWidth: '100%',
              margin: 0,
              padding: '.05em .35em',
              border: 'none',
              borderRadius: 3,
              background: 'rgba(127,127,127,.18)',
              color: 'inherit',
              fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace',
              fontSize: '.85em',
              lineHeight: 1.35,
              textAlign: 'left',
              whiteSpace: 'normal',
              wordBreak: 'break-all',
              userSelect: 'text',
              cursor: 'pointer',
            }}
          >
            {path}
          </button>
        </div>
      ))}
      {hidden > 0 && (
        <div style={{ marginTop: '.35em', fontSize: '.85em' }}>
          {t('{{count}} more path(s) are not listed.', { count: hidden })}
        </div>
      )}
    </div>
  );
}

export default function PatchFinishDialog({
  isShown, loading, busy, mode, flow, preview, options, problems, workDirClear, cutRenamePreview, now, failure, error, executeKeys, onClose, onExecute, onOptionsChange, onRetry,
}: PatchFinishDialogProps) {
  const { t } = useTranslation();
  const patchWork = usePatchWork();
  const workDirName = patchWork?.dirNames.workDir ?? defaultPatchWorkDirName;
  const disabled = busy || loading || preview == null;
  const nowDate = new Date(now);

  // patch: the key that opened the dialog starts the job when it is pressed again, so the workflow
  // stays on one key (`Shift+E` twice) instead of switching to the mouse for the last step. Capture
  // phase: the upstream keyboard hook only dispatches while the page has focus, and the dialog
  // takes it. The guards mirror the "Move the files" button; a disabled button stays disabled.
  useEffect(() => {
    if (!isShown) return undefined;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat || isModifierOnlyEvent(e.code)) return;
      if (executeKeys.every((keys) => !matchesKeyBinding(e, keys))) return;
      // Stop the event before the keyboard hook sees it, so the key cannot reopen the dialog (or
      // cancel it) instead of starting the job.
      e.preventDefault();
      e.stopPropagation();
      if (problems.length > 0) {
        // A disabled "Move the files" button must not look like a dead key: say why nothing started.
        getSwal().toast.fire({ icon: 'warning', text: t('Fix the problems listed in the dialog before finishing.') });
        return;
      }
      if (disabled) return;
      onExecute();
    };
    document.addEventListener('keydown', onKeyDown, { capture: true });
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [disabled, executeKeys, isShown, onExecute, problems.length, t]);

  const mergeOptions = mode === 'merge' ? options as PatchFinishMergeOptions : undefined;
  const cutOptions = mode === 'cut' ? options as PatchFinishCutOptions : undefined;

  // The cut-only job offers to delete the merged result because its clips are kept below. Only claim
  // that while those clips are really there: a merge that took its clips with it is the only copy of
  // that material (see `isMergedRebuildableFromClips`).
  const mergedRebuildable = preview == null
    || isMergedRebuildableFromClips({ mergedSegIds: preview.mergedSegIds, clips: preview.clips });

  // "Rename the merged result to the source name" needs the source name free, so the source always
  // moves to finished_src_media in that case (the radio says so but cannot be changed).
  const sourceForced = mode === 'merge' && mergeOptions?.merged === 'source-rename';
  const sourceChoice = sourceForced ? 'finished' : options.source;

  const setSource = (source: FinishOptions['source']) => {
    onOptionsChange(mode, { ...options, source });
  };

  const projectUsesDateFolders = options.projectFile === 'userdata-llc'
    || options.projectFile === 'install-llc'
    || options.projectFile === 'custom';

  const setProjectFile = (projectFile: FinishOptions['projectFile']) => {
    onOptionsChange(mode, { ...options, projectFile });
  };

  // The preset is derived from the options, never stored: editing anything below turns it into
  // "custom" by itself, so the row can never claim a workflow the options no longer describe.
  // The same two constraints the preset downgrades are passed here, or the downgraded options would
  // read as "custom" while the preset is what produced them.
  const presetConstraints = {
    mergedCoversClips: preview?.mergedCoversClips ?? true,
    installLlcWritable: preview?.projectStores.installLlcWritable ?? true,
    mergedInsideWorkArea: preview?.mergedInsideWorkArea ?? true,
  };

  const activePreset = preview == null
    ? undefined
    : resolveFinishPreset({ mode, options, flow, ...presetConstraints });

  const applyPreset = (preset: PatchFinishPresetChoice) => {
    if (mode === 'merge') {
      onOptionsChange('merge', resolvePresetOptions({ preset, mode: 'merge', options: options as PatchFinishMergeOptions, ...presetConstraints }));
      return;
    }
    onOptionsChange('cut', resolvePresetOptions({ preset, mode: 'cut', options: options as PatchFinishCutOptions, ...presetConstraints }));
  };

  const setProjectDateGrouping = (projectDateGrouping: FinishOptions['projectDateGrouping']) => {
    onOptionsChange(mode, { ...options, projectDateGrouping });
  };

  const chooseProjectDir = async () => {
    const picked = await showOpenDialog({
      properties: ['openDirectory', 'createDirectory'],
      ...((options.projectDir != null) && { defaultPath: options.projectDir }),
      title: t('Choose a folder for the project file'),
    });
    const [chosen] = picked.filePaths;
    if (picked.canceled || chosen == null) return;
    onOptionsChange(mode, { ...options, projectFile: 'custom', projectDir: chosen });
  };

  // The labels of the choices the current workflow offers. Only the entries in
  // `getFinishPresetChoices` / `getFinishSourceChoices` are ever rendered, so `Shift+E` cannot show
  // (or hand-write) a destination that belongs to `Shift+F`.
  const presetLabels: Record<PatchFinishPresetChoice, string> = {
    'one-video': t('Process this video, then the next one'),
    archive: t('Process this video, keep the source, then the next one'),
    skip: t('Skip and move this video, then the next one'),
    'loop-video': t('Keep working on the same video, reusing its cut list'),
  };
  const sourceLabels: Record<PatchFinishSourceChoice, string> = {
    finished: t('Move it to finished_src_media'),
    skip: t('Move it to finished_skip_src'),
    detached: t('Move it to detached_src_media (to delete later)'),
    keep: t('Leave it where it is'),
  };
  // The three titles as literal `t()` calls, so the extractor keeps them in `locales/en`; which one
  // shows is decided by the pure helper (a skipped video is not cut).
  const titles: Record<PatchFinishDialogTitleVariant, string> = {
    skip: t('Finish: skip without cutting'),
    merge: t('Finish: cut and merge'),
    cut: t('Finish: cut only'),
  };
  const title = titles[getFinishDialogTitleVariant(mode === 'merge' ? 'merge' : 'cut', sourceChoice)];

  const summaryLines: string[] = [];
  if (preview != null) {
    const sourceTargetDir = sourceChoice === 'finished'
      ? preview.dirs.finishedSrcMediaDir
      : (sourceChoice === 'skip' ? preview.dirs.finishedSkipSrcMediaDir : preview.dirs.detachedSrcMediaDir);
    summaryLines.push(sourceChoice === 'keep'
      ? t('The source video stays where it is.')
      : t('The source video moves to {{dir}}.', { dir: sourceTargetDir }));

    if (preview.projectFile != null) {
      const projectTarget = resolveProjectTargetDir({
        choice: options.projectFile,
        projectDir: options.projectDir,
        dateGrouping: options.projectDateGrouping,
        stores: {
          finishLlcDir: preview.dirs.finishLlcDir,
          userDataLlcDir: preview.projectStores.userDataLlcDir,
          installLlcDir: preview.projectStores.installLlcDir,
        },
        now: nowDate,
      });
      const projectName = getPathFileName(preview.projectFile.path);
      if (projectTarget.kind === 'dir') {
        if (projectTarget.dir != null) {
          summaryLines.push(t('The project file ({{name}}) moves to {{dir}}.', { name: projectName, dir: projectTarget.dir }));
        }
      } else if (projectTarget.kind === 'follow') {
        summaryLines.push(sourceChoice === 'keep'
          ? t('The project file stays where it is.')
          : t('The project file ({{name}}) follows it.', { name: projectName }));
      } else {
        summaryLines.push(t('The project file stays where it is.'));
      }
    }

    if (mode === 'merge' && mergeOptions != null && preview.merged != null) {
      summaryLines.push(mergedTargetText({ t, preview, choice: mergeOptions.merged }));
    }

    if (mode === 'cut' && cutOptions != null && preview.merged != null) {
      if (cutOptions.mergedResult === 'finished') summaryLines.push(mergedTargetText({ t, preview, choice: 'finished' }));
      else if (cutOptions.mergedResult === 'delete' && preview.mergedInsideWorkArea) summaryLines.push(t('The merged result is permanently deleted.'));
    }

    const { selected: selectedClips, stale: staleClips } = splitClipsByExportSelection(preview.clips, preview.selectedSegIds);
    if (selectedClips.length > 0) {
      summaryLines.push(clipsTargetText({ t, mode, preview, mergeOptions, cutOptions }));
      if (mode === 'cut' && cutOptions?.cutRename.enabled === true && cutOptions.clips !== 'keep') {
        summaryLines.push(t('The cut results are renamed on the way, as shown above.'));
      }
    }
    const deletesStale = mode === 'merge' ? mergeOptions?.deleteStaleClips : cutOptions?.deleteStaleClips;
    if (deletesStale != null && staleClips.length > 0) {
      summaryLines.push(earlierPassesClipsLine({ t, preview, deletesThem: deletesStale }));
    }

    if (options.workDir === 'clear') {
      summaryLines.push(t('After the files are handled, the emptied {{name}} folder is moved to the recycle bin.', { name: workDirName }));
    }

    summaryLines.push(t(options.next === 'next' ? 'Then the next source video is loaded.' : 'This video stays open.'));
  }

  // The exact places the kept results end up, under the summary (fork-owned). The summary says what
  // happens to each group; this says where the files really are, which is what a user copies into an
  // archive or a message. Same rule as the finish summary: the merged result first, then the cut
  // results, capped so a long job cannot push the buttons off the screen.
  const finalPaths: string[] = [];
  if (preview != null) {
    if (mode === 'merge' && mergeOptions != null && preview.merged != null) {
      finalPaths.push(getMergedTargetPath({
        mergedPath: preview.merged?.path ?? '',
        sourcePath: preview.source.path,
        sourceDir: preview.source.dir,
        finishedMergedDir: preview.dirs.finishedMergedDir,
        choice: mergeOptions.merged,
      }));
    } else if (mode === 'cut' && cutOptions != null && preview.merged != null) {
      if (cutOptions.mergedResult === 'finished') {
        finalPaths.push(getMergedTargetPath({
          mergedPath: preview.merged.path,
          sourcePath: preview.source.path,
          sourceDir: preview.source.dir,
          finishedMergedDir: preview.dirs.finishedMergedDir,
          choice: 'finished',
        }));
      } else if (cutOptions.mergedResult === 'keep') {
        finalPaths.push(preview.merged.path);
      }
    }
  }
  finalPaths.push(...cutRenamePreview.paths);

  return (
    <Dialog.Root open={isShown} onOpenChange={(open) => !open && !busy && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay />
        <Dialog.Content style={{ width: '44em', maxHeight: '85vh', overflowY: 'auto' }} aria-describedby={undefined}>
          <Dialog.Title>{title}</Dialog.Title>

          {loading && <div style={{ marginTop: '.6em' }}>{t('Reading the results...')}</div>}

          {preview != null && (
            <>
              <Section title={t('Preset')}>
                {getFinishPresetChoices(flow).map((preset) => (
                  <Option key={preset} id={`finish-preset-${preset}`} name="finish-preset" checked={activePreset === preset} disabled={disabled} onSelect={() => applyPreset(preset)}>
                    {presetLabels[preset]}
                  </Option>
                ))}
                <Option id="finish-preset-custom" name="finish-preset" checked={activePreset === 'custom'} disabled onSelect={() => undefined}>
                  {t('Custom')}
                </Option>
                <div style={{ fontSize: '.9em', color: 'var(--gray-11)', marginTop: '.2em' }}>
                  {t('Changing any option below switches to custom.')}
                </div>
              </Section>

              <Section title={t('Source video')}>
                <PathLine path={preview.source.path} size={preview.source.size} />
                {sourceForced && <div style={{ fontSize: '.9em', color: 'var(--gray-11)', marginTop: '.2em' }}>{t('The source video has to move because the merged result takes its name.')}</div>}
                <div style={{ marginTop: '.35em' }}>
                  {getFinishSourceChoices(flow).map((source) => (
                    <Option key={source} id={`finish-source-${source}`} name="finish-source" checked={sourceChoice === source} disabled={disabled || sourceForced} onSelect={() => setSource(source)}>
                      {sourceLabels[source]}
                    </Option>
                  ))}
                </div>
              </Section>

              <Section title={t('Project file (.llc)')}>
                {preview.projectFile == null
                  ? (
                    <div style={{ fontSize: '.9em', color: 'var(--gray-11)' }}>
                      {preview.warnings.includes('project-unreadable')
                        ? t('The project file exists but could not be read, so it is left where it is.')
                        : t('No project file was found for this video.')}
                    </div>
                  )
                  : (
                    <>
                      <PathLine path={preview.projectFile.path} size={undefined} />
                      <div style={{ marginTop: '.35em' }}>
                        <Option id="finish-project-follow" name="finish-project" checked={options.projectFile === 'follow'} disabled={disabled} onSelect={() => setProjectFile('follow')}>{t('Follow the video')}</Option>
                        <Option id="finish-project-keep" name="finish-project" checked={options.projectFile === 'keep'} disabled={disabled} onSelect={() => setProjectFile('keep')}>{t('Leave it where it is')}</Option>
                        <Option id="finish-project-finish-llc" name="finish-project" checked={options.projectFile === 'finish-llc'} disabled={disabled} onSelect={() => setProjectFile('finish-llc')}>
                          {t('Move it to finish_llc')}{' '}<code style={{ fontSize: '.9em', color: 'var(--gray-11)' }}>{preview.dirs.finishLlcDir}</code>
                        </Option>
                        <Option id="finish-project-userdata" name="finish-project" checked={options.projectFile === 'userdata-llc'} disabled={disabled} onSelect={() => setProjectFile('userdata-llc')}>
                          {t('Move it to the app data folder (llc)')}{' '}<code style={{ fontSize: '.9em', color: 'var(--gray-11)' }}>{preview.projectStores.userDataLlcDir}</code>
                        </Option>
                        <Option id="finish-project-install" name="finish-project" checked={options.projectFile === 'install-llc'} disabled={disabled || !preview.projectStores.installLlcWritable} onSelect={() => setProjectFile('install-llc')}>
                          {t('Move it to the installation folder (llc) (default)')}{' '}<code style={{ fontSize: '.9em', color: 'var(--gray-11)' }}>{preview.projectStores.installLlcDir}</code>
                        </Option>
                        {!preview.projectStores.installLlcWritable && options.projectFile === 'userdata-llc' && (
                          <div style={{ fontSize: '.9em', color: 'var(--amber-11)', marginLeft: '1.4em' }}>{t('The installation folder cannot be written to, so the project file goes to the app data folder.')}</div>
                        )}
                        <Option id="finish-project-custom" name="finish-project" checked={options.projectFile === 'custom'} disabled={disabled} onSelect={() => setProjectFile('custom')}>{t('Move it to another folder...')}</Option>
                      </div>

                      {options.projectFile === 'custom' && (
                        <div style={{ marginTop: '.35em', paddingLeft: '1.4em' }}>
                          {!preview.projectStores.installLlcWritable && (
                            <div style={{ fontSize: '.9em', color: 'var(--amber-11)' }}>{t('The installation folder cannot be written to, so the project file goes to a folder you choose.')}</div>
                          )}
                          <button
                            type="button"
                            disabled={disabled}
                            onClick={() => { chooseProjectDir().catch((err: unknown) => { console.error('Failed to choose the project folder', err); }); }}
                            style={{ padding: '.3em .7em', cursor: disabled ? 'default' : 'pointer' }}
                          >
                            {t('Choose folder...')}
                          </button>
                          {options.projectDir != null
                            ? <div style={{ fontSize: '.9em', color: 'var(--gray-11)', wordBreak: 'break-all', marginTop: '.2em' }}><code>{options.projectDir}</code></div>
                            : <div style={{ fontSize: '.9em', color: 'var(--gray-11)', marginTop: '.2em' }}>{t('No folder chosen yet.')}</div>}
                        </div>
                      )}

                      {projectUsesDateFolders && (
                        <div style={{ marginTop: '.45em', paddingLeft: '1.4em' }}>
                          <Option id="finish-project-date-ym" name="finish-project-date" checked={options.projectDateGrouping === 'ym'} disabled={disabled} onSelect={() => setProjectDateGrouping('ym')}>
                            {t('Year and month ({{example}})', { example: getProjectDateSubdir(nowDate, 'ym') })}
                          </Option>
                          <Option id="finish-project-date-ymd" name="finish-project-date" checked={options.projectDateGrouping === 'ymd'} disabled={disabled} onSelect={() => setProjectDateGrouping('ymd')}>
                            {t('Year, month and day ({{example}})', { example: getProjectDateSubdir(nowDate, 'ymd') })}
                          </Option>
                          <Option id="finish-project-date-none" name="finish-project-date" checked={options.projectDateGrouping === 'none'} disabled={disabled} onSelect={() => setProjectDateGrouping('none')}>
                            {t('No date folders')}
                          </Option>
                        </div>
                      )}
                    </>
                  )}
              </Section>

              {mode === 'merge' && mergeOptions != null && (
                <Section title={t('Merged result')}>
                  {preview.merged != null
                    ? <PathLine path={preview.merged.path} size={preview.merged.size} />
                    : <div style={{ fontSize: '.9em', color: 'var(--gray-11)' }}>{t('No merged result was found.')}</div>}
                  <div style={{ marginTop: '.35em' }}>
                    <Option id="finish-merged-finished" name="finish-merged" checked={mergeOptions.merged === 'finished'} disabled={disabled || preview.merged == null} onSelect={() => onOptionsChange(mode, { ...mergeOptions, merged: 'finished' })}>{t('Move it to finished_merged')}</Option>
                    <Option id="finish-merged-source" name="finish-merged" checked={mergeOptions.merged === 'source'} disabled={disabled || preview.merged == null} onSelect={() => onOptionsChange(mode, { ...mergeOptions, merged: 'source' })}>{t('Move it back to the source folder, keeping the merged file name')}</Option>
                    <Option id="finish-merged-rename" name="finish-merged" checked={mergeOptions.merged === 'source-rename'} disabled={disabled || preview.merged == null} onSelect={() => onOptionsChange(mode, { ...mergeOptions, merged: 'source-rename' })}>{t('Move it back to the source folder and take the source video name')}</Option>
                  </div>
                </Section>
              )}

              {mode === 'cut' && cutOptions != null && preview.merged != null && (
                <Section title={t('Merged result found')}>
                  <PathLine path={preview.merged.path} size={preview.merged.size} />
                  <div style={{ fontSize: '.9em', color: 'var(--gray-11)', marginTop: '.2em' }}>
                    {mergedRebuildable
                      ? t('The cut results are kept below, so the merged result can be rebuilt from them.')
                      : t('The clips this merged result was made from are no longer in the work area. It cannot be rebuilt from the cut results below.')}
                  </div>
                  <div style={{ marginTop: '.35em' }}>
                    <Option id="finish-merged-result-finished" name="finish-merged-result" checked={cutOptions.mergedResult === 'finished'} disabled={disabled} onSelect={() => onOptionsChange(mode, { ...cutOptions, mergedResult: 'finished' })}>{t('Move it to finished_merged (default)')}</Option>
                    <Option id="finish-merged-result-delete" name="finish-merged-result" checked={cutOptions.mergedResult === 'delete'} disabled={disabled || !preview.mergedInsideWorkArea} onSelect={() => onOptionsChange(mode, { ...cutOptions, mergedResult: 'delete' })}>{t('Permanently delete it')}</Option>
                    <Option id="finish-merged-result-keep" name="finish-merged-result" checked={cutOptions.mergedResult === 'keep'} disabled={disabled} onSelect={() => onOptionsChange(mode, { ...cutOptions, mergedResult: 'keep' })}>{t('Keep it where it is')}</Option>
                  </div>
                  {!preview.mergedInsideWorkArea && (
                    <div style={{ fontSize: '.9em', color: 'var(--gray-11)' }}>{t('Only a merged result inside this work area can be deleted here.')}</div>
                  )}
                </Section>
              )}

              <Section title={t('Cut clips')}>
                {(() => {
                  // The clip choices below act on this export's results only; the clips of earlier
                  // passes (temporary clips that never went to finish) are handled on their own, so
                  // the counts are split the same way.
                  const { selected, stale } = splitClipsByExportSelection(preview.clips, preview.selectedSegIds);
                  if (selected.length === 0 && stale.length === 0) {
                    return <div style={{ fontSize: '.9em', color: 'var(--gray-11)' }}>{t('No cut results were found.')}</div>;
                  }
                  const selectedSize = selected.reduce((total, clip) => total + clip.size, 0);
                  const staleSize = stale.reduce((total, clip) => total + clip.size, 0);
                  const deletesThem = mode === 'merge' ? mergeOptions?.deleteStaleClips === true : cutOptions?.deleteStaleClips === true;
                  const metaStyle = { fontSize: '.9em', color: 'var(--gray-11)' };
                  return (
                    <>
                      <div style={metaStyle}>
                        {selected.length > 0
                          ? thisExportClipsLine({ t, mode, preview, mergeOptions, cutOptions })
                          : t('This export: {{count}} cut result(s).', { count: 0 })}
                      </div>
                      {selected.length > 0 && mode === 'merge' && mergeOptions != null && (
                        <div style={{ marginTop: '.35em' }}>
                          <Option id="finish-clips-delete" name="finish-clips" checked={mergeOptions.clips === 'delete'} disabled={disabled || !preview.mergedCoversClips} onSelect={() => onOptionsChange(mode, { ...mergeOptions, clips: 'delete' })}>{t('Permanently delete them (default)')}</Option>
                          <Option id="finish-clips-detached" name="finish-clips" checked={mergeOptions.clips === 'detached'} disabled={disabled} onSelect={() => onOptionsChange(mode, { ...mergeOptions, clips: 'detached' })}>{t('Move them to detached_clips (to delete later)')}</Option>
                          {/* patch: the video is worked on again: the results stay where the next
                              export finds them (the `loop-video` preset uses this). */}
                          <Option id="finish-clips-keep" name="finish-clips" checked={mergeOptions.clips === 'keep'} disabled={disabled} onSelect={() => onOptionsChange(mode, { ...mergeOptions, clips: 'keep' })}>{t('Leave them in the work area')}</Option>
                          {!preview.mergedCoversClips && <div style={{ fontSize: '.9em', color: 'var(--gray-11)' }}>{t('Deleting is disabled: the merged result does not contain the current cut results.')}</div>}
                        </div>
                      )}
                      {selected.length > 0 && mode === 'cut' && cutOptions != null && (
                        <div style={{ marginTop: '.35em' }}>
                          <Option id="finish-clips-finished" name="finish-clips" checked={cutOptions.clips === 'finished'} disabled={disabled} onSelect={() => onOptionsChange(mode, { ...cutOptions, clips: 'finished' })}>{t('Move them to finished_clips (default)')}</Option>
                          <Option id="finish-clips-source" name="finish-clips" checked={cutOptions.clips === 'source'} disabled={disabled} onSelect={() => onOptionsChange(mode, { ...cutOptions, clips: 'source' })}>{t('Move them back to the source folder')}</Option>
                          <Option id="finish-clips-keep" name="finish-clips" checked={cutOptions.clips === 'keep'} disabled={disabled} onSelect={() => onOptionsChange(mode, { ...cutOptions, clips: 'keep' })}>{t('Leave them in the work area')}</Option>
                        </div>
                      )}
                      {stale.length > 0 && (
                        <div style={{ marginTop: '.55em', paddingTop: '.45em', borderTop: '1px solid var(--gray-6)' }}>
                          <div style={metaStyle}>{earlierPassesClipsLine({ t, preview, deletesThem })}</div>
                          <div style={{ display: 'flex', gap: '.45em', alignItems: 'flex-start', marginTop: '.25em' }}>
                            <input
                              id="finish-delete-stale-clips"
                              type="checkbox"
                              checked={deletesThem}
                              disabled={disabled}
                              onChange={(e) => {
                                if (mode === 'merge' && mergeOptions != null) onOptionsChange(mode, { ...mergeOptions, deleteStaleClips: e.target.checked });
                                else if (mode === 'cut' && cutOptions != null) onOptionsChange(mode, { ...cutOptions, deleteStaleClips: e.target.checked });
                              }}
                              style={{ marginTop: '.25em' }}
                            />
                            <label htmlFor="finish-delete-stale-clips" style={{ cursor: disabled ? 'default' : 'pointer' }}>
                              {t('Permanently delete the {{count}} temporary clip(s) (keeps the work area clean)', { count: stale.length })}
                            </label>
                          </div>
                          <div style={{ ...metaStyle, marginTop: '.25em' }}>
                            {t('When unticked, they stay in the work area, so the next pass on this video does not cut them again.')}
                          </div>
                        </div>
                      )}
                      <div style={{ ...metaStyle, marginTop: '.45em', fontWeight: 600 }}>
                        {t('Work area total: {{count}} cut clip(s) ({{size}}).', { count: selected.length + stale.length, size: formatMegabytes(selectedSize + staleSize) })}
                      </div>
                      {(() => {
                        // Results an earlier finish already moved out: context for the counts, never
                        // touched by this job. The hover lists the files and says what is left out.
                        const finished = preview.finishedClips ?? [];
                        if (finished.length === 0) return null;
                        const finishedSize = finished.reduce((total, clip) => total + clip.size, 0);
                        const explanation = t('Results an earlier finish moved out of the work area. A result this export cuts again is not counted, because its old copy is still in the folder; only files still on disk are listed.');
                        return (
                          <div style={{ ...metaStyle, marginTop: '.25em' }} title={`${explanation}\n\n${finished.map((clip) => clip.path).join('\n')}`}>
                            {t('Already in finished_clips: {{count}} result(s) ({{size}})', { count: finished.length, size: formatMegabytes(finishedSize) })}
                          </div>
                        );
                      })()}
                    </>
                  );
                })()}
              </Section>

              {/* patch: the cut results are renamed on the way out (`features/patchFinish/cutRename`).
                  The rule is the export's `{token}` syntax, so a name can be chosen here that the
                  cutting step never had to know - and a one-clip job (no merge) still ends with a
                  readable file name instead of the working title. A result that stays in the work
                  area is not moved, so there is no name to choose. */}
              {mode === 'cut' && cutOptions != null && cutOptions.clips !== 'keep' && splitClipsByExportSelection(preview.clips, preview.selectedSegIds).selected.length > 0 && (
                <Section title={t('Rename the cut results')}>
                  <div style={{ display: 'flex', gap: '.45em', alignItems: 'flex-start' }}>
                    <input
                      id="finish-cut-rename"
                      type="checkbox"
                      checked={cutOptions.cutRename.enabled}
                      disabled={disabled}
                      onChange={(e) => onOptionsChange(mode, { ...cutOptions, cutRename: { ...cutOptions.cutRename, enabled: e.target.checked } })}
                      style={{ marginTop: '.25em' }}
                    />
                    <label htmlFor="finish-cut-rename" style={{ cursor: disabled ? 'default' : 'pointer' }}>
                      {t('Rename them while they are moved (they keep their current name when this is off)')}
                    </label>
                  </div>

                  {cutOptions.cutRename.enabled && (
                    <div style={{ marginTop: '.5em' }}>
                      <NameRuleEditor
                        mode="cut"
                        rule={cutOptions.cutRename.rule}
                        setRule={(rule) => onOptionsChange(mode, { ...cutOptions, cutRename: { ...cutOptions.cutRename, rule } })}
                        defaultRule={defaultFinishCutRenameRule}
                        presets={finishCutRenamePresets}
                        labelSeparator={cutOptions.cutRename.labelSeparator}
                        setLabelSeparator={(labelSeparator) => onOptionsChange(mode, { ...cutOptions, cutRename: { ...cutOptions.cutRename, labelSeparator } })}
                        previewLines={cutRenamePreview.lines}
                        previewError={cutRenamePreview.error}
                        loading={false}
                        // The editor's own warning is about a rule that repeats between exports; here
                        // one rule names the whole batch, so the note below says it in this step's words.
                        collisionProne={false}
                      />
                      {splitClipsByExportSelection(preview.clips, preview.selectedSegIds).selected.length > 1 && !cutRuleSeparatesClips(cutOptions.cutRename.rule) && (
                        <div style={{ marginTop: '.35em', fontSize: '.85em', color: 'var(--amber-11)' }}>
                          {t('A rule like {{example}} gives every cut result the same name, so the position and the time are appended automatically. Add {{token}} to number them yourself.', { example: '{source}-clip', token: '{seg_num}' })}
                        </div>
                      )}
                      <div style={{ marginTop: '.35em', fontSize: '.85em', color: 'var(--gray-11)' }}>
                        {t('A name that is already taken in the target folder gets a number in brackets. The extension is taken from each result.')}
                      </div>
                    </div>
                  )}
                </Section>
              )}

              <Section title={t('Work directory')}>
                <PathLine path={preview.dirs.workDir} size={undefined} />
                <div style={{ display: 'flex', gap: '.45em', alignItems: 'flex-start', marginTop: '.45em' }}>
                  <input
                    id="finish-workdir-clear"
                    type="checkbox"
                    checked={options.workDir === 'clear'}
                    disabled={disabled || !workDirClear.clearable}
                    onChange={(e) => onOptionsChange(mode, { ...options, workDir: e.target.checked ? 'clear' : 'keep' })}
                    style={{ marginTop: '.25em' }}
                  />
                  <label htmlFor="finish-workdir-clear" style={{ cursor: disabled || !workDirClear.clearable ? 'default' : 'pointer', opacity: disabled || !workDirClear.clearable ? 0.55 : 1 }}>
                    {t('Move the empty {{name}} folder to the recycle bin after the job', { name: workDirName })}
                  </label>
                </div>
                {preview.workDirScanFailed
                  ? <div style={{ fontSize: '.9em', color: 'var(--gray-11)', marginTop: '.2em' }}>{t('The work directory could not be read, so it cannot be cleaned automatically.')}</div>
                  : (!workDirClear.clearable && (
                    <div style={{ fontSize: '.9em', color: 'var(--gray-11)', marginTop: '.2em' }}>
                      <div>{t('Only available when the work directory will contain nothing but the app\'s empty stage folders and export manifest.')}</div>
                      {workDirClear.blockers.slice(0, 3).map((blocker) => <div key={blocker}><code>{blocker}</code></div>)}
                    </div>
                  ))}
                <div style={{ fontSize: '.9em', color: 'var(--gray-11)', marginTop: '.2em' }}>
                  {t('Only empty stage folders and the export manifest generated by the app are moved to the recycle bin. Any other file or folder, even an empty one you created, keeps the folder. This cleanup does not delete any file.')}
                </div>
              </Section>

              <Section title={t('Afterwards')}>
                <Option id="finish-next-next" name="finish-next" checked={options.next === 'next'} disabled={disabled} onSelect={() => onOptionsChange(mode, { ...options, next: 'next' })}>{t('Load the next source video from the list')}</Option>
                <Option id="finish-next-none" name="finish-next" checked={options.next === 'none'} disabled={disabled} onSelect={() => onOptionsChange(mode, { ...options, next: 'none' })}>{t('Keep this video open')}</Option>
              </Section>

              <div style={{ marginTop: '.9em', padding: '.6em .7em', border: '1px solid var(--gray-6)', borderRadius: '.3em', background: 'var(--gray-2)', fontSize: '.9em' }}>
                <div style={{ fontWeight: 'bold' }}>{t('What will happen')}</div>
                {summaryLines.map((line) => <div key={line} style={{ marginTop: '.2em' }}>{line}</div>)}
              </div>

              {finalPaths.length > 0 && <FinalPaths paths={finalPaths} />}

              {preview.warnings.length > 0 && (
                <div style={{ marginTop: '.7em', color: 'var(--amber-11)', fontSize: '.9em' }}>
                  {preview.warnings.map((warning) => <WarningLine key={warning} warning={warning} />)}
                </div>
              )}

              {problems.length > 0 && (
                <div style={{ marginTop: '.7em', color: 'var(--red-11)', fontSize: '.9em' }}>
                  {problems.map((problem) => <ProblemLine key={problem} problem={problem} />)}
                </div>
              )}

              {/* `pre-line`: the text is one key with its own paragraph breaks (a wall of eight
                  sentences is unreadable, and splitting it would make the translation drift). */}
              <div style={{ marginTop: '.8em', fontSize: '.9em', color: 'var(--gray-11)', lineHeight: 1.45, whiteSpace: 'pre-line' }}>
                {t('Data is precious and hard to recover.\n\nThe app does not delete source videos on its own. They are moved into the waiting-for-deletion folder instead.\n\nThe finish job permanently deletes only files the app created: cut results the merged result covers, or merged results you no longer need, and the like.\n\nA source video is deleted for good only in the deletion check, on the sources you select there, and only when the app kept a result of them.\n\nEmptying the recycle bin often to free space risks losing files other apps deleted that you may still want back:\nthe better way is to move files aside and delete them permanently by hand.\n\nMoving a file into a folder, or deleting it to the recycle bin, does not free disk space.\n\nWhat really frees space is permanent deletion (Shift+Delete in Explorer),\n\nand emptying the recycle bin is permanent deletion too.\n\nSo: a source video is only moved into the waiting-for-deletion folder; deleting one for good happens only in the deletion check, from the sources that are ready there.')}
              </div>
            </>
          )}

          {failure != null && <FailureBlock failure={failure} />}

          {error != null && (
            <div style={errorPanelStyle}>
              <div style={{ wordBreak: 'break-word' }}>{error}</div>
              <button type="button" onClick={onRetry} disabled={busy || loading} style={{ marginTop: '.45em', padding: '.3em .7em', cursor: busy || loading ? 'default' : 'pointer' }}>
                {t('Try again')}
              </button>
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '.6em', marginTop: '1.2em' }}>
            {/* A running job cannot be cancelled from here: the files are being moved, and the
                summary and the next video arrive when it is over. */}
            <button type="button" onClick={onClose} disabled={busy} style={{ padding: '.45em .9em', cursor: busy ? 'default' : 'pointer' }}>{t('Cancel')}</button>
            <button
              type="button"
              disabled={disabled || problems.length > 0}
              onClick={onExecute}
              style={{ padding: '.45em .9em', cursor: disabled || problems.length > 0 ? 'default' : 'pointer', fontWeight: 'bold' }}
            >
              {t(busy ? 'Working...' : 'Move the files')}
            </button>
          </div>

          <Dialog.CloseButton />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
