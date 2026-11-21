import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { detectTimePairsName, formatTimePairDocument, matchTimePairsTarget, maxTimePairGap, minTimePairGap, normalizeTimePairGap, parseTimePairs, planLlcTimePairs } from '../../../../common/features/patchTimeConvert';
import type { LlcTimePairSegment, TimePairRow } from '../../../../common/features/patchTimeConvert';
import { getParentPath, getPathFileName, getPathStem, getProjectFileName, isSamePath, joinPaths } from '../../../../common/features/patchFinish';
import { patchFinishedSubdirs } from '../../../../common/features/patchWork';
import * as AlertDialog from '../../components/AlertDialog';
import { DialogButton } from '../../components/Button';
import Checkbox from '../../components/Checkbox';
import CopyClipboardButton from '../../components/CopyClipboardButton';
import * as Dialog from '../../components/Dialog';
import Select from '../../components/Select';
import TextInput from '../../components/TextInput';
import useUserSettings from '../../hooks/useUserSettings';
import mainApi from '../../mainApi';
import { addSegmentColorIndex, createSegment } from '../../segments';
import { loadLlcProject, saveLlcProject } from '../../edlStore';
import { isMac, isWindows } from '../../util';
import { usePatchWork } from '../patchWork/PatchWorkProvider';
import patchConfig from './patchConfigApi';
import TimePairEditor from './TimePairEditor';

const { readFile, readdir, stat, writeFile } = window.require('node:fs/promises');
const { webUtils } = window.require('electron');
const { dialog } = window.require('@electron/remote');

/** The select value meaning "use the name typed in the box" (never a real path). */
const customTarget = '__patch_custom_target__';

const pathCaseInsensitive = isWindows || isMac;

const monoStyle = { fontFamily: 'monospace', fontSize: '.75em', lineHeight: 1.35, resize: 'vertical' as const };

/** The gap choices of the generated text. */
const gapChoices = Array.from({ length: maxTimePairGap - minTimePairGap + 1 }, (_, index) => minTimePairGap + index);

function errorMessage(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}

function logError(err: unknown) {
  console.error('Time convert failed', err);
}

/** One folder a project file usually lives in, offered as a shortcut to open the file picker there. */
interface LlcPlace {
  id: string;
  label: string;
  dir: string;
  disabled: boolean;
}

/**
The time converter (fork-owned, opened from `Tools -> Time convert...`).

It is the tool of the old PowerShell workflow in one dialog, with two directions:

- **Time pairs to a project file**: paste or drop the hand-written cut points (`000130 000132`,
  `000250 001023 label`, optionally with the video name on the first line) and load them into the cut
  list of the open video, or save them as a `.llc` next to the video they name. Each line is checked
  where it is written: a broken line is tinted and the problem is written after it.
- **Project file to time pairs**: drop a `.llc` and get plain time pairs (optionally led by the
  video's file name), so a cut list can be handed to someone else - and pasted back into the first
  tab.

Loading into the cut list is refused while an export runs, while the video is inside the work area /
finished folder, and while a line still has a problem; the cutting window's own rules stay the
cutting window's, the dialog only asks before the list is replaced.

The generated spacing and the optional first line are remembered in `patch-config.json`, the folder
of the last project file too.
*/
export default function PatchTimeConvertDialog({ isShown, onHide, filePath, batchFilePaths, maxLabelLength, readOnlySource, exportRunning, hasCutSegments, onLoadRows }: {
  isShown: boolean;
  onHide: () => void;
  /** The video in the cutting window, if one is open. */
  filePath: string | undefined;
  batchFilePaths: readonly string[];
  maxLabelLength: number;
  /** The open video is in the work area or the finished folder: its cut list is read-only. */
  readOnlySource: boolean;
  exportRunning: boolean;
  /** The cut list already holds cut points (the initial whole-video segment does not count). */
  hasCutSegments: boolean;
  /** Replace the cut list with these rows (the caller owns the locks and the segment shapes). */
  onLoadRows: (rows: TimePairRow[]) => void;
}) {
  const { t } = useTranslation();
  const { llcTimeFormat, customOutDir } = useUserSettings();
  const patchWork = usePatchWork();

  const [tab, setTab] = useState<'toLlc' | 'toTime'>('toLlc');
  const [text, setText] = useState('');
  // Both undefined while the dialog follows the text; set once the user edits them.
  const [nameLineOverride, setNameLineOverride] = useState<boolean>();
  const [nameOverride, setNameOverride] = useState<string>();
  const [pathChoice, setPathChoice] = useState<string>();
  const [status, setStatus] = useState<{ text: string, isError: boolean }>();
  const [busy, setBusy] = useState(false);
  // Replacing a cut list that already has cut points is the one destructive step: ask inside this
  // dialog (an app-level confirm would be behind the modal's focus trap).
  const [confirmReplaceOpen, setConfirmReplaceOpen] = useState(false);
  // Which path the file-system answer belongs to, so a stale answer is never shown.
  const [knownExists, setKnownExists] = useState<{ path: string, exists: boolean }>();

  // The project file's direction.
  const [llcPath, setLlcPath] = useState<string>();
  const [llcSegments, setLlcSegments] = useState<readonly LlcTimePairSegment[]>();
  const [llcMediaName, setLlcMediaName] = useState<string>();
  const [includeUnselected, setIncludeUnselected] = useState(false);
  const [includeLabels, setIncludeLabels] = useState(true);
  const [dragOver, setDragOver] = useState(false);
  const [projectStores, setProjectStores] = useState<Awaited<ReturnType<typeof mainApi.patchProjectStores>>>();
  const [llcCounts, setLlcCounts] = useState<Record<string, number>>({});
  const [countsEpoch, setCountsEpoch] = useState(0);

  // Remembered choices (fork-owned settings).
  const [gap, setGapState] = useState(() => normalizeTimePairGap(patchConfig.getPatchSetting('timeConvertGap')));
  const [nameLine, setNameLineState] = useState(() => patchConfig.getPatchSetting('timeConvertNameLine'));
  const [lastLlcDir, setLastLlcDirState] = useState<string | undefined>(() => patchConfig.getPatchSetting('timeConvertLastLlcDir'));

  const sourceDir = filePath != null ? getParentPath(filePath) : undefined;
  // Where a finish job archives project files (`<root>/<finishedDir>/finish_llc`), the same place
  // the finish dialog names - the work area's own paths do not include the finished sibling.
  const finishLlcDir = patchWork?.effectiveRoot != null && patchWork.effectiveRoot.trim() !== ''
    ? joinPaths(patchWork.effectiveRoot, patchWork.dirNames.finishedDir, patchFinishedSubdirs.finishLlc)
    : undefined;

  const detectedName = useMemo(() => detectTimePairsName(text), [text]);
  const firstLineIsName = nameLineOverride ?? detectedName != null;

  const parsed = useMemo(
    () => parseTimePairs(text, { firstLineIsName, maxLabelLength }),
    [firstLineIsName, maxLabelLength, text],
  );
  const { rows, errors } = parsed;

  // The name the text itself declares (a `:a.mp4` line, or the first line when the box is ticked).
  const nameFromText = parsed.mediaName;

  /**
  The video the text names.

  Its exact file name is tried first, then a unique stem match (`a [1080p].mp4` finds `a.mp4`),
  because a shared cut list rarely spells the name of the local copy. A stem that matches more than
  one video is never guessed: the dropdown has to be used.
  */
  const targetMatch = useMemo(
    () => matchTimePairsTarget({ wantedName: nameFromText, filePaths: [filePath, ...batchFilePaths], caseInsensitive: pathCaseInsensitive }),
    [batchFilePaths, filePath, nameFromText],
  );
  const matchedPath = targetMatch.kind === 'exact' || targetMatch.kind === 'stem' ? targetMatch.path : undefined;

  // The name box shows what will be recorded: the matched video's name, or the name the text gave.
  const nameInput = nameOverride ?? (matchedPath != null ? getPathFileName(matchedPath) : nameFromText) ?? '';

  // A declared (or typed) name that is not in the list is a name of its own: the project file is
  // written next to the open video under that name - that is how a text written for another video,
  // or a video the user does not have at hand, is converted.
  const typedName = nameOverride?.trim() ?? '';
  const autoChoice = matchedPath
    ?? ((typedName !== '' || nameFromText != null) ? customTarget : (filePath ?? batchFilePaths[0] ?? customTarget));
  const selectedChoice = pathChoice ?? autoChoice;

  /** The name typed by hand, resolved against the open video's folder when it is not a path. */
  const typedTarget = useMemo(() => {
    const trimmed = nameInput.trim();
    if (trimmed === '') return undefined;
    if (getParentPath(trimmed) !== '.') return trimmed;
    return sourceDir != null ? joinPaths(sourceDir, trimmed) : trimmed;
  }, [nameInput, sourceDir]);

  const targetPath = selectedChoice === customTarget ? typedTarget : selectedChoice;
  const mediaFileName = targetPath != null ? getPathFileName(targetPath) : undefined;
  const targetIsOpenFile = filePath != null && targetPath != null
    && isSamePath(targetPath, filePath, { caseInsensitive: pathCaseInsensitive });
  const targetExists = targetPath != null && knownExists?.path === targetPath ? knownExists.exists : undefined;

  // Where project files usually are, as shortcuts for the file picker. Only the folders that can be
  // named are listed; the `.llc` count tells the user which of them has something in it.
  const places = useMemo<LlcPlace[]>(() => [
    ...(sourceDir != null ? [{ id: 'source', label: t('Next to the video'), dir: sourceDir, disabled: false }] : []),
    ...(finishLlcDir != null ? [{ id: 'finish-llc', label: t('Archived project files (finish_llc)'), dir: finishLlcDir, disabled: false }] : []),
    ...(projectStores != null ? [
      { id: 'userdata', label: t('App data folder (llc)'), dir: projectStores.userDataLlcDir, disabled: false },
      { id: 'install', label: t('Installation folder (llc)'), dir: projectStores.installLlcDir, disabled: !projectStores.installLlcWritable },
    ] : []),
    ...(customOutDir != null && customOutDir.trim() !== '' ? [{ id: 'custom-out', label: t('Custom output folder'), dir: customOutDir, disabled: false }] : []),
  ], [customOutDir, finishLlcDir, projectStores, sourceDir, t]);

  const defaultLlcDir = lastLlcDir ?? sourceDir ?? finishLlcDir ?? projectStores?.userDataLlcDir ?? projectStores?.installLlcDir;

  const canLoad = rows.length > 0 && errors.length === 0 && targetIsOpenFile && !readOnlySource && !exportRunning && !busy;

  /** The project file's direction: what the dropped/chosen project file contains. */
  const plan = useMemo(
    () => (llcSegments != null ? planLlcTimePairs({ segments: llcSegments, includeUnselected }) : undefined),
    [includeUnselected, llcSegments],
  );
  const output = useMemo(
    () => (plan != null
      ? formatTimePairDocument({
        rows: plan.rows,
        includeLabels,
        gap,
        mediaFileName: nameLine ? llcMediaName : undefined,
      })
      : ''),
    [gap, includeLabels, llcMediaName, nameLine, plan],
  );

  // The store folders live in the main process (same resolution as the finish dialog).
  useEffect(() => {
    let cancelled = false;
    mainApi.patchProjectStores().then((stores) => {
      if (!cancelled) setProjectStores(stores);
    }).catch(logError);
    return () => {
      cancelled = true;
    };
  }, []);

  // How many project files each place holds. Only when the second tab is open: it is a folder scan,
  // and the first tab does not need it.
  useEffect(() => {
    if (!isShown || tab !== 'toTime') return undefined;
    const dirs = places.map((place) => place.dir);
    if (dirs.length === 0) return undefined;

    let cancelled = false;
    Promise.all(dirs.map(async (dir) => {
      try {
        const names = await readdir(dir);
        return [dir, names.filter((name) => name.toLowerCase().endsWith('.llc')).length] as const;
      } catch {
        return [dir, 0] as const;
      }
    })).then((entries) => {
      if (!cancelled) setLlcCounts(Object.fromEntries(entries));
    }).catch(logError);

    return () => {
      cancelled = true;
    };
  }, [countsEpoch, isShown, places, tab]);

  // Tell the user when the name they wrote points at no file: the project file would then name a
  // video that is not there, which only matters when it is opened later.
  useEffect(() => {
    if (targetPath == null) return undefined;
    let cancelled = false;
    const timer = setTimeout(() => {
      stat(targetPath)
        .then((stats) => { if (!cancelled) setKnownExists({ path: targetPath, exists: stats.isFile() }); })
        .catch(() => { if (!cancelled) setKnownExists({ path: targetPath, exists: false }); });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [targetPath]);

  function setGap(value: number) {
    const next = normalizeTimePairGap(value);
    setGapState(next);
    patchConfig.setPatchSetting('timeConvertGap', next);
  }

  function setNameLine(value: boolean) {
    setNameLineState(value);
    patchConfig.setPatchSetting('timeConvertNameLine', value);
  }

  function rememberLlcDir(dir: string | undefined) {
    setLastLlcDirState(dir);
    patchConfig.setPatchSetting('timeConvertLastLlcDir', dir);
  }

  /** Load the rows into the cut list (the caller already agreed to replace the current ones). */
  function loadRows() {
    try {
      onLoadRows(rows);
    } catch (err) {
      // The cut list refuses some lists (upstream: too many segments). Say so instead of closing
      // the dialog as if it had worked.
      setStatus({ text: t('The cut points could not be loaded: {{message}}', { message: errorMessage(err) }), isError: true });
      return;
    }
    onHide();
  }

  function onLoad() {
    if (!canLoad) return;
    if (hasCutSegments) {
      setConfirmReplaceOpen(true);
      return;
    }
    loadRows();
  }

  async function onSaveProject() {
    if (rows.length === 0 || mediaFileName == null) return;
    setBusy(true);
    try {
      const targetDir = targetPath != null ? getParentPath(targetPath) : sourceDir;
      const projectName = getProjectFileName(mediaFileName);
      const { canceled, filePath: savePath } = await dialog.showSaveDialog({
        title: t('Save the project file'),
        ...(targetDir != null && { defaultPath: joinPaths(targetDir, projectName) }),
        filters: [{ name: t('LosslessCut project'), extensions: ['llc'] }],
      });
      if (canceled || savePath == null) return;

      // The project file stores plain segments with their own identity, exactly like the autosave.
      const segments = rows.map((row, index) => addSegmentColorIndex(createSegment({ start: row.start, end: row.end, name: row.label }), index));
      await saveLlcProject({ savePath, mediaFilePath: targetPath ?? mediaFileName, cutSegments: segments, timeFormat: llcTimeFormat });
      setStatus({ text: t('Project file saved: {{path}}', { path: savePath }), isError: false });
      rememberLlcDir(getParentPath(savePath));
      setCountsEpoch((epoch) => epoch + 1);
    } catch (err) {
      setStatus({ text: t('Could not save the project file: {{message}}', { message: errorMessage(err) }), isError: true });
    } finally {
      setBusy(false);
    }
  }

  async function openProjectFile(path: string) {
    setBusy(true);
    try {
      const project = await loadLlcProject(path);
      setLlcPath(path);
      setLlcSegments(project.cutSegments);
      setLlcMediaName(project.mediaFileName);
      setStatus(undefined);
    } catch (err) {
      setLlcPath(path);
      setLlcSegments(undefined);
      setLlcMediaName(undefined);
      setStatus({ text: t('Could not read the project file: {{message}}', { message: errorMessage(err) }), isError: true });
    } finally {
      setBusy(false);
    }
  }

  async function chooseProjectFile(fromDir?: string) {
    const startDir = fromDir ?? defaultLlcDir;
    const { canceled, filePaths } = await dialog.showOpenDialog({
      properties: ['openFile'],
      title: t('Choose a project file'),
      ...(startDir != null && { defaultPath: startDir }),
      filters: [{ name: t('LosslessCut project'), extensions: ['llc'] }],
    });
    const [first] = filePaths;
    if (canceled || first == null) return;
    rememberLlcDir(getParentPath(first));
    await openProjectFile(first);
  }

  async function onSaveText() {
    if (output === '') return;
    const defaultDir = llcPath != null ? getParentPath(llcPath) : sourceDir;
    const textName = llcPath != null ? `${getPathStem(llcPath)}-times.txt` : 'times.txt';
    const { canceled, filePath: savePath } = await dialog.showSaveDialog({
      title: t('Save the text file'),
      ...(defaultDir != null && { defaultPath: joinPaths(defaultDir, textName) }),
      filters: [{ name: t('TXT files'), extensions: ['txt'] }],
    });
    if (canceled || savePath == null) return;
    try {
      await writeFile(savePath, output, 'utf8');
      setStatus({ text: t('Text file saved: {{path}}', { path: savePath }), isError: false });
    } catch (err) {
      setStatus({ text: t('Could not save the text file: {{message}}', { message: errorMessage(err) }), isError: true });
    }
  }

  function onDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
    setDragOver(false);
    const { files } = event.dataTransfer;
    const [file] = [...files];
    if (file == null) return;
    const droppedPath = webUtils.getPathForFile(file);

    // A project file dropped on the wrong tab is what the other tab is for.
    if (tab === 'toTime' || droppedPath.toLowerCase().endsWith('.llc')) {
      if (tab === 'toLlc') setTab('toTime');
      openProjectFile(droppedPath).catch(logError);
      return;
    }

    readFile(droppedPath, 'utf8').then((content) => {
      setText(content);
      // The dropped text is a new input: follow its own name line again.
      setNameLineOverride(undefined);
      setNameOverride(undefined);
      setPathChoice(undefined);
      setStatus(undefined);
    }).catch((err: unknown) => {
      setStatus({ text: t('Could not read the text file: {{message}}', { message: errorMessage(err) }), isError: true });
    });
  }

  function renderStatus() {
    if (status == null) return undefined;
    return (
      <div style={{ marginTop: '.6em', color: status.isError ? 'var(--red-11)' : 'var(--green-11)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
        {status.text}
      </div>
    );
  }

  function renderToProject() {
    const hint = (() => {
      if (readOnlySource) return t('This video is in the work area or the finished folder, so its cut list cannot be changed.');
      if (exportRunning) return t('Wait for the current export to finish.');
      if (errors.length > 0) return t('Fix the marked lines first.');
      if (rows.length === 0) return t('Nothing to convert yet.');
      if (!targetIsOpenFile) return t('Open this video in the cutting window first, then load its cut points.');
      return undefined;
    })();

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '.5em' }}>
        <div style={{ fontSize: '.85em', color: 'var(--gray-11)' }}>
          {t('Paste cut points, one line per cut: start, end, and an optional label. Times may be HHMMSS, HHMMSSfff, H:M:S or seconds with a decimal point. Blank lines, spaces and tabs between the fields do not matter.')}
        </div>

        <div
          onDrop={onDrop}
          onDragOver={(event) => { event.preventDefault(); event.stopPropagation(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          style={{ display: 'flex', flexDirection: 'column', gap: '.3em', ...(dragOver && { outline: '2px dashed var(--gray-9)', outlineOffset: '.2em', borderRadius: '.4em' }) }}
        >
          <TimePairEditor value={text} onChange={(value) => { setText(value); setStatus(undefined); }} errors={errors} maxLabelLength={maxLabelLength} />
          <div style={{ fontSize: '.75em', color: 'var(--gray-11)' }}>{t('Drop a text file here, or paste into the box.')}</div>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.6em', alignItems: 'center' }}>
          <Checkbox
            checked={firstLineIsName}
            onCheckedChange={(checked) => { setNameLineOverride(checked === true); }}
            label={t('The first line is the video name')}
          />
          <TextInput
            value={nameInput}
            placeholder={t('Video name')}
            style={{ maxWidth: '20em' }}
            onChange={(event) => {
              const { value } = event.target;
              setNameOverride(value);
              setPathChoice(customTarget);
            }}
          />
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.5em', alignItems: 'center' }}>
          <span style={{ fontSize: '.85em' }}>{t('Video for this cut list')}</span>
          <Select
            value={selectedChoice}
            style={{ maxWidth: '24em' }}
            onChange={(event) => {
              const { value } = event.target;
              setPathChoice(value);
              // Keep the name box in step with the video the rows belong to.
              setNameOverride(value === customTarget ? (nameFromText ?? '') : getPathFileName(value));
            }}
          >
            {filePath != null && <option value={filePath}>{`${getPathFileName(filePath)} ${t('(open)')}`}</option>}
            {batchFilePaths.filter((path) => path !== filePath).map((path) => (
              <option key={path} value={path}>{getPathFileName(path)}</option>
            ))}
            <option value={customTarget}>{t('Another name...')}</option>
          </Select>
        </div>

        {targetMatch.kind === 'ambiguous' && selectedChoice === customTarget && (
          <div style={{ fontSize: '.8em', color: 'var(--orange-11)' }}>
            {t('Several videos match the name in the text. Choose the one this cut list belongs to.')}
          </div>
        )}

        {targetPath != null && hint == null && targetMatch.kind !== 'ambiguous' && targetExists === false && (
          <div style={{ fontSize: '.8em', color: 'var(--orange-11)' }}>
            {t('The video this cut list names was not found: {{path}}. The project file still points at that name.', { path: targetPath })}
          </div>
        )}

        <div style={{ fontSize: '.85em', color: 'var(--gray-11)' }}>
          <span>{t('{{count}} cut(s)', { count: rows.length })}</span>
          {errors.length > 0 && (
            <span>{` \u00B7 ${t('{{count}} line(s) with a problem.', { count: errors.length })}`}</span>
          )}
          {mediaFileName != null && (
            <span>{` \u00B7 ${t('The project file will be named {{name}}.', { name: getProjectFileName(mediaFileName) })}`}</span>
          )}
          {llcTimeFormat === 'timecode' && (
            <div style={{ marginTop: '.2em' }}>
              {t('This project file stores times as timecodes (v3). Older builds and upstream LosslessCut cannot open it; save as numbers when you share the file.')}
            </div>
          )}
        </div>

        {hint != null && <div style={{ fontSize: '.8em', color: 'var(--gray-11)' }}>{hint}</div>}

        <Dialog.ButtonRow>
          <DialogButton disabled={!canLoad} onClick={onLoad}>{t('Load into the cut list')}</DialogButton>
          <DialogButton primary disabled={busy || rows.length === 0 || mediaFileName == null} onClick={() => { onSaveProject().catch(logError); }}>
            {t('Save the project file...')}
          </DialogButton>
        </Dialog.ButtonRow>
      </div>
    );
  }

  function renderToText() {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '.5em' }}>
        <div
          role="button"
          tabIndex={0}
          onClick={() => { chooseProjectFile().catch(logError); }}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault();
            chooseProjectFile().catch(logError);
          }}
          onDrop={onDrop}
          onDragOver={(event) => { event.preventDefault(); event.stopPropagation(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          style={{
            minHeight: '7em',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '.35em',
            padding: '1em',
            border: `3px dashed ${dragOver ? 'var(--gray-9)' : 'var(--gray-6)'}`,
            borderRadius: '.5em',
            backgroundColor: dragOver ? 'var(--gray-4)' : undefined,
            cursor: 'pointer',
            textAlign: 'center',
          }}
        >
          <div style={{ fontSize: '1em' }}>{t('Drop a project file here or choose one.')}</div>
          {llcPath != null && <div style={{ fontSize: '.8em', color: 'var(--gray-11)', wordBreak: 'break-all' }}>{llcPath}</div>}
        </div>

        {places.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.4em', alignItems: 'center' }}>
            <span style={{ fontSize: '.8em', color: 'var(--gray-11)' }}>{t('Project files are usually here:')}</span>
            {places.map((place) => {
              const count = llcCounts[place.dir] ?? 0;
              return (
                <DialogButton
                  key={place.id}
                  disabled={busy || place.disabled}
                  title={place.dir}
                  style={{ padding: '.3em .7em', fontSize: '.8em' }}
                  onClick={() => { chooseProjectFile(place.dir).catch(logError); }}
                >
                  {`${place.label} (${count})`}
                </DialogButton>
              );
            })}
          </div>
        )}

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1em', alignItems: 'center' }}>
          <Checkbox checked={includeLabels} onCheckedChange={(checked) => { setIncludeLabels(checked === true); }} label={t('Include labels')} />
          <Checkbox
            checked={nameLine && llcMediaName != null}
            disabled={llcMediaName == null}
            onCheckedChange={(checked) => { setNameLine(checked === true); }}
            label={t('First line: the video name')}
          />
          <Checkbox
            checked={includeUnselected}
            onCheckedChange={(checked) => { setIncludeUnselected(checked === true); }}
            label={t('Include segments that are not selected for export')}
          />
          <span style={{ display: 'flex', alignItems: 'center', gap: '.4em', fontSize: '.8em' }}>
            {t('Spaces between fields')}
            <Select
              value={String(gap)}
              onChange={(event) => { setGap(Number(event.target.value)); }}
              style={{ width: '4em' }}
            >
              {gapChoices.map((choice) => <option key={choice} value={String(choice)}>{choice}</option>)}
            </Select>
          </span>
        </div>

        {plan != null && (
          <div style={{ fontSize: '.8em', color: 'var(--gray-11)' }}>
            {t('{{count}} cut(s)', { count: plan.rows.length })}
            {plan.skippedUnselected > 0 && <div>{t('Skipped {{count}} segment(s) that are not selected for export.', { count: plan.skippedUnselected })}</div>}
            {plan.skippedMarkers > 0 && <div>{t('Skipped {{count}} marker(s) with no end time.', { count: plan.skippedMarkers })}</div>}
            {plan.skippedInvalid > 0 && <div>{t('Skipped {{count}} invalid segment(s).', { count: plan.skippedInvalid })}</div>}
          </div>
        )}

        <textarea value={output} readOnly spellCheck={false} placeholder={t('00:01:30.000 00:01:32.000')} style={{ ...monoStyle, minHeight: '9em' }} />

        <Dialog.ButtonRow>
          <CopyClipboardButton text={output}>
            {({ onClick }) => <DialogButton disabled={output === ''} onClick={onClick}>{t('Copy')}</DialogButton>}
          </CopyClipboardButton>
          <DialogButton primary disabled={output === ''} onClick={() => { onSaveText().catch(logError); }}>{t('Save the text file...')}</DialogButton>
        </Dialog.ButtonRow>
      </div>
    );
  }

  return (
    <Dialog.Root open={isShown} onOpenChange={(open) => { if (!open && !busy) onHide(); }}>
      <Dialog.Portal>
        <Dialog.Overlay />
        <Dialog.Content style={{ width: '52em', maxWidth: '92vw' }} aria-describedby={undefined}>
          <Dialog.Title>{t('Time convert')}</Dialog.Title>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.4em', marginBottom: '.7em' }}>
            <DialogButton primary={tab === 'toLlc'} onClick={() => { setTab('toLlc'); setStatus(undefined); }}>
              {t('Time pairs to a project file')}
            </DialogButton>
            <DialogButton primary={tab === 'toTime'} onClick={() => { setTab('toTime'); setStatus(undefined); }}>
              {t('Project file to time pairs')}
            </DialogButton>
          </div>

          {tab === 'toLlc' ? renderToProject() : renderToText()}

          {renderStatus()}

          <Dialog.ButtonRow>
            <DialogButton disabled={busy} onClick={onHide}>{t('Close')}</DialogButton>
          </Dialog.ButtonRow>

          {/* Its own alert, inside this dialog: the app-level confirm dialog would sit behind this
              modal's focus trap and could not be clicked. */}
          <AlertDialog.Root open={confirmReplaceOpen} onOpenChange={setConfirmReplaceOpen}>
            <AlertDialog.Portal>
              <AlertDialog.Overlay />
              <AlertDialog.Content>
                <AlertDialog.Title>{t('Loading replaces the current cut points. Continue?')}</AlertDialog.Title>
                <AlertDialog.Description>{t('This video already has cut points. Loading the converted rows replaces them.')}</AlertDialog.Description>
                <Dialog.ButtonRow>
                  <AlertDialog.Cancel asChild>
                    <DialogButton>{t('Cancel')}</DialogButton>
                  </AlertDialog.Cancel>
                  <AlertDialog.Action asChild>
                    <DialogButton primary onClick={loadRows}>{t('Load')}</DialogButton>
                  </AlertDialog.Action>
                </Dialog.ButtonRow>
              </AlertDialog.Content>
            </AlertDialog.Portal>
          </AlertDialog.Root>

          <Dialog.CloseButton />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
