import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { PatchHistoryLockEventType, PatchHistoryLockMode, PatchHistoryLockReason } from '../../../../common/features/patchPrivacyLock';
import { parseHistoryLockMode, patchHistoryLockDefaultPassword, validateHistoryPassword } from '../../../../common/features/patchPrivacyLock';
import { defaultPatchDirNames, samePatchDirName, validatePatchDirName } from '../../../../common/features/patchWork';
import type { PatchDirNameProblem, PatchDirNames, PatchWorkDirs } from '../../../../common/features/patchWork';
import type { PatchDiscardResultsAction } from '../../../../common/features/patchData/settings';
import type { PatchPlaybackRateStepMode } from '../../../../common/features/patchTransport/playbackRate';
import { parsePlaybackRateStepMode } from '../../../../common/features/patchTransport/playbackRate';
import { joinPaths } from '../../../../common/features/patchFinish';

import * as Dialog from '../../components/Dialog';
import Select from '../../components/Select';
import Switch from '../../components/Switch';
import { showOpenDialog } from '../../dialogs';
import getSwal, { errorToast } from '../../swal';
import { patchNoticeFinishSummary } from '../../../../common/features/patchNotice';
import { usePatchNotice } from '../patchNotice/PatchNoticeProvider';
import { usePatchPrivacyLock } from '../patchPrivacyLock/PatchPrivacyLockProvider';

/**
Working directory settings (fork-owned).

The working directory is the root the app keeps its work area in
(`<working directory>/.losslesscut_work`, see `common/features/patchWork`). The dialog also shows
the directories that are derived from it, so the user can see where the cut results will land.
*/
export default function PatchWorkSettingsDialog({ isShown, onHide, workRoot, workDirs, dirNames, exporting, autoOpenPlayer, singleWindowPlayback, reloadResultsWindow, segmentLeadInSeconds, playbackRateStep, confirmFinishPermanentDelete, confirmDetachedSrcPermanentDelete, confirmDiscardSource, confirmClearFileList, discardResultsAction, historyLockMode, historyLockIdleMinutes, setWorkRoot, setDirNames, setAutoOpenPlayer, setSingleWindowPlayback, setReloadResultsWindow, setSegmentLeadInSeconds, setPlaybackRateStep, setConfirmFinishPermanentDelete, setConfirmDetachedSrcPermanentDelete, setConfirmDiscardSource, setConfirmClearFileList, setDiscardResultsAction, setHistoryLockMode, setHistoryLockIdleMinutes, clearExportManifest }: {
  isShown: boolean,
  onHide: () => void,
  workRoot: string | undefined,
  workDirs: PatchWorkDirs | undefined,
  /** The folder names currently in effect. */
  dirNames: PatchDirNames,
  /** Is this window exporting? The names must not change while it writes into the work area. */
  exporting: boolean,
  autoOpenPlayer: boolean,
  singleWindowPlayback: boolean,
  reloadResultsWindow: boolean,
  segmentLeadInSeconds: number,
  playbackRateStep: PatchPlaybackRateStepMode,
  confirmFinishPermanentDelete: boolean,
  /** Ask before the detached-source check deletes a source for good. */
  confirmDetachedSrcPermanentDelete: boolean,
  confirmDiscardSource: boolean,
  /** Ask before the source file list is cleared from its context menu. */
  confirmClearFileList: boolean,
  discardResultsAction: PatchDiscardResultsAction,
  /** When the work history locks itself (fork-owned; it never unlocks). */
  historyLockMode: PatchHistoryLockMode,
  historyLockIdleMinutes: number,
  setWorkRoot: (newWorkRoot: string | undefined) => void,
  setDirNames: (names: PatchDirNames) => void,
  setAutoOpenPlayer: (value: boolean) => void,
  setSingleWindowPlayback: (value: boolean) => void,
  setReloadResultsWindow: (value: boolean) => void,
  setSegmentLeadInSeconds: (value: number) => void,
  setPlaybackRateStep: (value: PatchPlaybackRateStepMode) => void,
  setConfirmFinishPermanentDelete: (value: boolean) => void,
  setConfirmDetachedSrcPermanentDelete: (value: boolean) => void,
  setConfirmDiscardSource: (value: boolean) => void,
  setConfirmClearFileList: (value: boolean) => void,
  setDiscardResultsAction: (value: PatchDiscardResultsAction) => void,
  setHistoryLockMode: (mode: PatchHistoryLockMode) => void,
  setHistoryLockIdleMinutes: (minutes: number) => void,
  clearExportManifest: () => Promise<void>,
}) {
  const { t } = useTranslation();
  // The finish summary is a silenceable notice; this dialog lives inside the notice provider.
  const patchNotice = usePatchNotice();
  const privacyLock = usePatchPrivacyLock();
  const lockStatus = privacyLock?.status;
  const lockEnabled = lockStatus?.enabled === true;
  const lockLocked = lockEnabled && !lockStatus?.unlocked;
  const lockStatusText = (() => {
    if (lockStatus == null) return t('Reading the lock status...');
    if (!lockEnabled) return t('No password is set.');
    if (lockLocked) return t('The work history is locked.');
    return t('The work history is unlocked for this run.');
  })();

  const [lockCurrentPassword, setLockCurrentPassword] = useState('');
  const [lockNewPassword, setLockNewPassword] = useState('');
  const [lockConfirmPassword, setLockConfirmPassword] = useState('');
  const [lockPasswordError, setLockPasswordError] = useState<string | undefined>(undefined);
  const [lockPasswordNotice, setLockPasswordNotice] = useState<string | undefined>(undefined);
  const [lockPasswordBusy, setLockPasswordBusy] = useState(false);

  const lockReasonText = useCallback((reason: PatchHistoryLockReason) => {
    switch (reason) {
      case 'wrong-password': { return t('That password is not correct.'); }
      case 'unreadable': { return t('The password file could not be read. Delete it to restore the default password.'); }
      case 'unavailable': { return t('The password file is not available.'); }
      case 'empty': { return t('The password cannot be empty.'); }
      case 'too-long': { return t('The password is too long.'); }
      case 'write-failed': { return t('The password file could not be written.'); }
      case 'exists': { return t('A password is already set.'); }
      default: { return t('The password could not be changed.'); }
    }
  }, [t]);

  const lockEventText = useCallback((type: PatchHistoryLockEventType) => {
    switch (type) {
      case 'created': { return t('Default password created'); }
      case 'reset': { return t('Password file deleted; the default password was restored'); }
      case 'changed': { return t('Password changed'); }
      case 'unlocked': { return t('History unlocked'); }
      default: { return ''; }
    }
  }, [t]);

  const onChangeHistoryPassword = useCallback(async () => {
    if (privacyLock == null || lockPasswordBusy) return;
    setLockPasswordNotice(undefined);
    const problem = validateHistoryPassword(lockNewPassword);
    if (problem != null) {
      setLockPasswordError(problem === 'empty' ? t('The password cannot be empty.') : t('The password is too long.'));
      return;
    }
    if (lockNewPassword !== lockConfirmPassword) {
      setLockPasswordError(t('The two passwords do not match.'));
      return;
    }
    setLockPasswordBusy(true);
    try {
      const result = lockEnabled
        ? await privacyLock.changePassword(lockCurrentPassword, lockNewPassword)
        : await privacyLock.setPassword(lockNewPassword);
      if (!result.ok) {
        setLockPasswordError(lockReasonText(result.reason));
        return;
      }
      setLockCurrentPassword('');
      setLockNewPassword('');
      setLockConfirmPassword('');
      setLockPasswordError(undefined);
      const message = lockEnabled ? t('The password was changed.') : t('The password was set.');
      setLockPasswordNotice(message);
      getSwal().toast.fire({ icon: 'success', text: message });
    } finally {
      setLockPasswordBusy(false);
    }
  }, [lockEnabled, lockNewPassword, lockConfirmPassword, lockPasswordBusy, lockReasonText, lockCurrentPassword, privacyLock, t]);

  // patch: the folder names are edited as drafts and applied with one button. Saving on every
  // keystroke would create a folder for every intermediate (valid) name - `PatchWorkProvider`
  // creates the work area of the configured name. The draft is derived from the applied names, so
  // it resets by itself when the names change (Apply) or the dialog is reopened.
  const [namesDraft, setNamesDraft] = useState<{ base: PatchDirNames; workDir: string; finishedDir: string } | undefined>(undefined);
  const draft = namesDraft != null && namesDraft.base.workDir === dirNames.workDir && namesDraft.base.finishedDir === dirNames.finishedDir
    ? namesDraft
    : { base: dirNames, workDir: dirNames.workDir, finishedDir: dirNames.finishedDir };
  const workNameDraft = draft.workDir;
  const finishedNameDraft = draft.finishedDir;
  const setWorkNameDraft = useCallback((value: string) => {
    setNamesDraft({ base: dirNames, workDir: value, finishedDir: finishedNameDraft });
  }, [dirNames, finishedNameDraft]);
  const setFinishedNameDraft = useCallback((value: string) => {
    setNamesDraft({ base: dirNames, workDir: workNameDraft, finishedDir: value });
  }, [dirNames, workNameDraft]);

  const workProblem = validatePatchDirName(workNameDraft);
  const finishedProblem = validatePatchDirName(finishedNameDraft);
  const namesCollide = workProblem == null && finishedProblem == null && samePatchDirName(workNameDraft, finishedNameDraft);
  // A name may not be the *other* folder's default: the defaults keep being recognized after a
  // rename, so the folder would be a work area and a finished area at once (see
  // `resolvePatchDirNames`). The resolver would silently fall back; say why instead.
  const workIsFinishedDefault = workProblem == null && samePatchDirName(workNameDraft, defaultPatchDirNames.finishedDir);
  const finishedIsWorkDefault = finishedProblem == null && samePatchDirName(finishedNameDraft, defaultPatchDirNames.workDir);
  const trimmedWorkName = workNameDraft.trim();
  const trimmedFinishedName = finishedNameDraft.trim();
  const namesChanged = trimmedWorkName !== dirNames.workDir || trimmedFinishedName !== dirNames.finishedDir;
  const canApplyNames = workProblem == null && finishedProblem == null && !namesCollide
    && !workIsFinishedDefault && !finishedIsWorkDefault && namesChanged && !exporting;

  const problemMessage = useCallback((problem: PatchDirNameProblem) => {
    switch (problem) {
      case 'empty': { return t('The name cannot be empty.'); }
      case 'path-separator': { return t('The name cannot contain a path separator.'); }
      case 'invalid-character': { return t('The name contains a character Windows does not allow in a folder name.'); }
      case 'trailing-dot-or-space': { return t('The name cannot end with a dot or a space.'); }
      case 'reserved-name': { return t('This name is reserved by Windows.'); }
      case 'too-long': { return t('The name is too long.'); }
      default: { return ''; }
    }
  }, [t]);

  const onApplyNames = useCallback(() => {
    if (!canApplyNames) return;
    setDirNames({ workDir: trimmedWorkName, finishedDir: trimmedFinishedName });
  }, [canApplyNames, setDirNames, trimmedFinishedName, trimmedWorkName]);

  const onChoose = useCallback(async () => {
    try {
      const { canceled, filePaths } = await showOpenDialog({
        properties: ['openDirectory', 'createDirectory'],
        ...((workRoot != null) && { defaultPath: workRoot }),
        title: t('Choose a working directory'),
      });
      if (canceled) return;
      const [dir] = filePaths;
      if (dir == null) return;
      setWorkRoot(dir);
    } catch (err) {
      console.error('Failed to choose the working directory', err);
      errorToast(t('Failed to choose the working directory'));
    }
  }, [setWorkRoot, t, workRoot]);

  const onOpen = useCallback(async () => {
    if (workDirs == null) return;
    try {
      await window.electron.patchOpenFolder(workDirs.workDir);
    } catch (err) {
      console.error('Failed to open the work area', err);
      errorToast(t('Failed to open the work area'));
    }
  }, [t, workDirs]);

  const onClear = useCallback(() => {
    setWorkRoot(undefined);
  }, [setWorkRoot]);

  const onClearManifest = useCallback(async () => {
    try {
      await clearExportManifest();
    } catch (err) {
      console.error('Failed to clear the export manifest', err);
      errorToast(t('Failed to clear the export manifest'));
    }
  }, [clearExportManifest, t]);

  return (
    <Dialog.Root open={isShown} onOpenChange={(open) => { if (!open) { setNamesDraft(undefined); onHide(); } }}>
      <Dialog.Portal>
        <Dialog.Overlay />
        <Dialog.Content style={{ width: '40em' }} aria-describedby={undefined}>
          <Dialog.Title>{t('Working directory')}</Dialog.Title>
          <Dialog.Description>{t('The app keeps a work area inside the working directory and writes the cut results there.')}</Dialog.Description>

          <div style={{ display: 'flex', gap: '.5em', alignItems: 'center', marginTop: '.6em' }}>
            <div style={{ flexGrow: 1, minWidth: 0, padding: '.4em .5em', border: '.1em solid var(--gray-7)', borderRadius: '.3em', wordBreak: 'break-all', color: workRoot != null ? 'inherit' : 'var(--gray-11)' }}>
              {workRoot ?? t('No working directory is set')}
            </div>
            <button type="button" onClick={onChoose} style={{ padding: '.4em .8em', cursor: 'pointer' }}>
              {t('Choose...')}
            </button>
            <button type="button" disabled={workDirs == null} onClick={onOpen} style={{ padding: '.4em .8em', cursor: workDirs != null ? 'pointer' : 'default' }}>
              {t('Open')}
            </button>
            <button type="button" disabled={workRoot == null} onClick={onClear} style={{ padding: '.4em .8em', cursor: workRoot != null ? 'pointer' : 'default' }}>
              {t('Clear')}
            </button>
          </div>

          {workRoot == null && (
            <div style={{ marginTop: '.5em', fontSize: '.9em', color: 'var(--gray-11)' }}>
              {t('Without a working directory the work area is created next to the source file.')}
            </div>
          )}

          {workDirs != null && (
            <div style={{ marginTop: '.8em', fontSize: '.9em', color: 'var(--gray-11)' }}>
              <div style={{ wordBreak: 'break-all' }}>{t('Work area')}: <code>{workDirs.workDir}</code></div>
              <div style={{ wordBreak: 'break-all' }}>{t('Cut results')}: <code>{workDirs.clipsDir}</code></div>
              <div style={{ wordBreak: 'break-all' }}>{t('Merge results')}: <code>{workDirs.mergedDir}</code></div>
              {workRoot != null && (
                <div style={{ wordBreak: 'break-all' }}>{t('Finished folder')}: <code>{joinPaths(workRoot, dirNames.finishedDir)}</code></div>
              )}
            </div>
          )}

          {/* patch: the work-history privacy lock (features/patchPrivacyLock). The work-folders
              dialog only locks and unlocks; the timing, the password and the reset/unlock log live
              here so the two dialogs stay one purpose each. */}
          <div style={{ marginTop: '1em', paddingTop: '.8em', borderTop: '1px solid var(--gray-6)' }}>
            <div style={{ fontWeight: 'bold', marginBottom: '.5em' }}>{t('Privacy lock')}</div>

            <div style={{ fontSize: '.9em', color: 'var(--gray-11)' }}>
              {lockStatusText}
            </div>

            {lockStatus?.isDefaultPassword === true && (
              <div style={{ marginTop: '.4em', fontSize: '.9em', color: 'var(--orange-9)' }}>
                {t('The default password {{password}} is in use. Change it before lending the computer.', { password: patchHistoryLockDefaultPassword })}
              </div>
            )}
            {lockStatus?.writeFailed === true && (
              <div style={{ marginTop: '.4em', fontSize: '.9em', color: 'var(--orange-9)' }}>
                {t('The password file could not be written. The lock still works until the app closes.')}
              </div>
            )}

            <div style={{ display: 'flex', gap: '.6em', alignItems: 'center', marginTop: '.7em' }}>
              <label htmlFor="patch-history-lock-mode" style={{ flexGrow: 1 }}>{t('Lock the work history')}</label>
              <Select
                id="patch-history-lock-mode"
                value={historyLockMode}
                disabled={!lockEnabled || lockLocked}
                onChange={(event) => { setHistoryLockMode(parseHistoryLockMode(event.target.value)); }}
              >
                <option value="manual">{t('Manually')}</option>
                <option value="startup">{t('When the app starts')}</option>
                <option value="idle">{t('After the computer is idle')}</option>
              </Select>
            </div>

            {historyLockMode === 'idle' && (
              <div style={{ display: 'flex', gap: '.6em', alignItems: 'center', marginTop: '.5em' }}>
                <label htmlFor="patch-history-lock-idle" style={{ flexGrow: 1 }}>{t('Minutes before it locks')}</label>
                <input
                  id="patch-history-lock-idle"
                  type="number"
                  min={1}
                  max={240}
                  step={1}
                  value={historyLockIdleMinutes}
                  disabled={!lockEnabled || lockLocked}
                  onChange={(event) => {
                    const value = Number(event.target.value);
                    if (Number.isFinite(value)) setHistoryLockIdleMinutes(value);
                  }}
                  style={{ width: '4.5em', padding: '.3em .4em' }}
                />
              </div>
            )}

            <div style={{ marginTop: '.3em', fontSize: '.85em', color: 'var(--gray-11)' }}>
              {lockLocked
                ? t('Unlock the work history to change when it locks.')
                : t('Manual remembers the last state. The other two always start locked; the idle option also locks when Windows locks the screen or the computer sleeps.')}
            </div>

            <div style={{ marginTop: '.8em', display: 'grid', gap: '.4em' }}>
              {lockEnabled && (
                <input
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  value={lockCurrentPassword}
                  placeholder={t('Current password')}
                  onChange={(event) => { setLockCurrentPassword(event.target.value); setLockPasswordError(undefined); }}
                  style={{ padding: '.35em .45em' }}
                />
              )}
              <input
                type="password"
                autoComplete="off"
                spellCheck={false}
                maxLength={200}
                value={lockNewPassword}
                placeholder={lockEnabled ? t('New password') : t('Password')}
                onChange={(event) => { setLockNewPassword(event.target.value); setLockPasswordError(undefined); }}
                style={{ padding: '.35em .45em' }}
              />
              <input
                type="password"
                autoComplete="off"
                spellCheck={false}
                maxLength={200}
                value={lockConfirmPassword}
                placeholder={lockEnabled ? t('Confirm the new password') : t('Confirm the password')}
                onChange={(event) => { setLockConfirmPassword(event.target.value); setLockPasswordError(undefined); }}
                style={{ padding: '.35em .45em' }}
              />
              <div style={{ display: 'flex', gap: '.6em', alignItems: 'center', flexWrap: 'wrap' }}>
                <button type="button" disabled={lockPasswordBusy} onClick={() => { onChangeHistoryPassword().catch(() => undefined); }} style={{ padding: '.4em .8em', cursor: lockPasswordBusy ? 'default' : 'pointer' }}>
                  {lockEnabled ? t('Change password') : t('Set password')}
                </button>
                {lockPasswordError != null && <span style={{ color: 'var(--red-9)', fontSize: '.9em' }}>{lockPasswordError}</span>}
                {lockPasswordNotice != null && <span style={{ color: 'var(--green-9)', fontSize: '.9em' }}>{lockPasswordNotice}</span>}
              </div>
            </div>

            <div style={{ marginTop: '.8em', fontSize: '.9em' }}>
              <div style={{ fontWeight: 600 }}>{t('Recent password events')}</div>
              {(lockStatus?.events.length ?? 0) === 0
                ? <div style={{ color: 'var(--gray-11)' }}>{t('No password events yet.')}</div>
                : (
                  <ul style={{ margin: '.25em 0 0', paddingLeft: '1.2em', color: 'var(--gray-11)' }}>
                    {lockStatus?.events.map((event) => (
                      <li key={`${event.at}-${event.type}`}>
                        {lockEventText(event.type)} — {new Date(event.at).toLocaleString()}
                      </li>
                    ))}
                  </ul>
                )}
              <div style={{ marginTop: '.25em', fontSize: '.85em', color: 'var(--gray-11)' }}>
                {t('The time of a reset is when the app noticed the missing file. This log only helps you notice resets and unlocks; it is not security and the videos are not encrypted.')}
              </div>
            </div>

            {lockStatus?.filePath != null && lockStatus.filePath !== '' && (
              <div style={{ marginTop: '.6em', fontSize: '.85em', color: 'var(--gray-11)' }}>
                <div>{t('Password file')}: <code style={{ userSelect: 'text', wordBreak: 'break-all' }}>{lockStatus.filePath}</code></div>
                <div style={{ marginTop: '.2em' }}>
                  {t('Forgot the password? Delete that file in the file manager. The app restores the default password {{password}} and keeps the history locked; the reset appears above.', { password: patchHistoryLockDefaultPassword })}
                </div>
              </div>
            )}
          </div>

          {/* patch: the two folder names are visible in the video directory, so they are the
              user's call. Both are only *names*: a path would let the setting leave the working
              directory. */}
          <div style={{ marginTop: '1em', paddingTop: '.8em', borderTop: '1px solid var(--gray-6)' }}>
            <div style={{ fontWeight: 'bold', marginBottom: '.5em' }}>{t('Folder names')}</div>

            <div style={{ display: 'flex', gap: '.5em', alignItems: 'center' }}>
              <label htmlFor="patch-work-dir-name" style={{ flexGrow: 1 }}>{t('Work folder name')}</label>
              <input
                id="patch-work-dir-name"
                type="text"
                value={workNameDraft}
                spellCheck={false}
                onChange={(e) => setWorkNameDraft(e.target.value)}
                style={{ width: '14em', padding: '.3em .4em' }}
              />
              <button type="button" disabled={workNameDraft === defaultPatchDirNames.workDir} onClick={() => setWorkNameDraft(defaultPatchDirNames.workDir)} style={{ padding: '.3em .6em', cursor: workNameDraft === defaultPatchDirNames.workDir ? 'default' : 'pointer' }}>
                {t('Reset to default')}
              </button>
            </div>
            {workProblem != null && (
              <div style={{ marginTop: '.2em', fontSize: '.9em', color: 'var(--red-9)' }}>{problemMessage(workProblem)}</div>
            )}
            {workIsFinishedDefault && (
              <div style={{ marginTop: '.2em', fontSize: '.9em', color: 'var(--red-9)' }}>{t("The work folder cannot use the finished folder's default name.")}</div>
            )}

            <div style={{ display: 'flex', gap: '.5em', alignItems: 'center', marginTop: '.6em' }}>
              <label htmlFor="patch-finished-dir-name" style={{ flexGrow: 1 }}>{t('Finished folder name')}</label>
              <input
                id="patch-finished-dir-name"
                type="text"
                value={finishedNameDraft}
                spellCheck={false}
                onChange={(e) => setFinishedNameDraft(e.target.value)}
                style={{ width: '14em', padding: '.3em .4em' }}
              />
              <button type="button" disabled={finishedNameDraft === defaultPatchDirNames.finishedDir} onClick={() => setFinishedNameDraft(defaultPatchDirNames.finishedDir)} style={{ padding: '.3em .6em', cursor: finishedNameDraft === defaultPatchDirNames.finishedDir ? 'default' : 'pointer' }}>
                {t('Reset to default')}
              </button>
            </div>
            {finishedProblem != null && (
              <div style={{ marginTop: '.2em', fontSize: '.9em', color: 'var(--red-9)' }}>{problemMessage(finishedProblem)}</div>
            )}
            {finishedIsWorkDefault && (
              <div style={{ marginTop: '.2em', fontSize: '.9em', color: 'var(--red-9)' }}>{t("The finished folder cannot use the work folder's default name.")}</div>
            )}
            {namesCollide && (
              <div style={{ marginTop: '.2em', fontSize: '.9em', color: 'var(--red-9)' }}>{t('The two folder names must be different.')}</div>
            )}

            <div style={{ display: 'flex', gap: '.6em', alignItems: 'center', flexWrap: 'wrap', marginTop: '.6em' }}>
              <button type="button" disabled={!canApplyNames} onClick={onApplyNames} style={{ padding: '.4em .8em', cursor: canApplyNames ? 'pointer' : 'default' }}>
                {t('Apply folder names')}
              </button>
              <span style={{ fontSize: '.9em', color: 'var(--gray-11)' }}>
                {t(exporting ? 'Wait for the current export to finish.' : 'Changing a folder name does not rename an existing folder. The app creates the configured names and keeps recognizing the default ones.')}
              </span>
            </div>
          </div>

          <div style={{ marginTop: '.6em', display: 'flex', gap: '.6em', alignItems: 'center', flexWrap: 'wrap' }}>
            <button type="button" disabled={workDirs == null} onClick={onClearManifest} style={{ padding: '.4em .8em', cursor: workDirs != null ? 'pointer' : 'default' }}>
              {t('Clear export manifest')}
            </button>
            <span style={{ fontSize: '.9em', color: 'var(--gray-11)' }}>{t('The next export regenerates every result.')}</span>
          </div>

          <div style={{ display: 'flex', gap: '.6em', alignItems: 'center', marginTop: '1em' }}>
            <Switch checked={autoOpenPlayer} onCheckedChange={setAutoOpenPlayer} />
            <span>{t('Open a player window with the cut results after cutting')}</span>
          </div>

          <div style={{ display: 'flex', gap: '.6em', alignItems: 'center', marginTop: '.6em' }}>
            <Switch checked={reloadResultsWindow} onCheckedChange={setReloadResultsWindow} />
            <span>{t('Reload a results window that did not finish loading')}</span>
          </div>
          <div style={{ marginTop: '.4em', fontSize: '.9em', color: 'var(--gray-11)' }}>
            {t('A window that stays blank is loaded once more. The failure is reported either way.')}
          </div>

          <div style={{ marginTop: '1em', paddingTop: '.8em', borderTop: '1px solid var(--gray-6)' }}>
            <div style={{ fontWeight: 'bold', marginBottom: '.5em' }}>{t('Playback')}</div>
            <div style={{ display: 'flex', gap: '.6em', alignItems: 'center' }}>
              <Switch checked={singleWindowPlayback} onCheckedChange={setSingleWindowPlayback} />
              <span>{t('Only one result window plays at a time')}</span>
            </div>
            <div style={{ marginTop: '.4em', fontSize: '.9em', color: 'var(--gray-11)' }}>
              {t('Starting playback in one result window pauses the other. The cutting window and the result windows always pause each other.')}
            </div>
            <div style={{ display: 'flex', gap: '.6em', alignItems: 'center', marginTop: '1em' }}>
              <label htmlFor="patch-playback-rate-step" style={{ flexGrow: 1 }}>{t('Speed key step')}</label>
              <Select id="patch-playback-rate-step" value={playbackRateStep} onChange={(event) => { setPlaybackRateStep(parsePlaybackRateStepMode(event.target.value)); }}>
                <option value="fixed">{t('Fixed 0.1 steps (PotPlayer style)')}</option>
                <option value="base">{t('Same as base mode')}</option>
              </Select>
            </div>
            <div style={{ marginTop: '.4em', fontSize: '.9em', color: 'var(--gray-11)' }}>
              {t('X and C slow down and speed up. Base mode multiplies the rate (three presses double the speed); fixed steps add or subtract 0.1.')}
            </div>
            <div style={{ display: 'flex', gap: '.6em', alignItems: 'center', marginTop: '1em' }}>
              <label htmlFor="patch-segment-lead-in" style={{ flexGrow: 1 }}>
                {t('Seconds before the segment end')}
              </label>
              <input
                id="patch-segment-lead-in"
                type="number"
                min={1}
                max={60}
                step={1}
                value={segmentLeadInSeconds}
                onChange={(e) => {
                  const value = Number(e.target.value);
                  if (!Number.isFinite(value)) return;
                  setSegmentLeadInSeconds(Math.min(60, Math.max(1, Math.round(value))));
                }}
                style={{ width: '4.5em', padding: '.3em .4em' }}
              />
            </div>
            <div style={{ marginTop: '.4em', fontSize: '.9em', color: 'var(--gray-11)' }}>
              {t('Shift+Right stops this many seconds before the end of the current segment. Press it again to go to the end.')}
            </div>
          </div>

          <div style={{ marginTop: '1em', paddingTop: '.8em', borderTop: '1px solid var(--gray-6)' }}>
            <div style={{ fontWeight: 'bold', marginBottom: '.5em' }}>{t('Finish')}</div>
            <div style={{ display: 'flex', gap: '.6em', alignItems: 'center' }}>
              <Switch checked={confirmFinishPermanentDelete} onCheckedChange={setConfirmFinishPermanentDelete} />
              <span>{t('Ask before permanently deleting files')}</span>
            </div>
            <div style={{ marginTop: '.4em', fontSize: '.9em', color: 'var(--gray-11)' }}>
              {t('The finish job asks before it permanently deletes cut results or a merged result.')}
            </div>

            <div style={{ display: 'flex', gap: '.6em', alignItems: 'center', marginTop: '.7em' }}>
              <Switch checked={confirmDetachedSrcPermanentDelete} onCheckedChange={setConfirmDetachedSrcPermanentDelete} />
              <span>{t('Ask before permanently deleting a selected source video')}</span>
            </div>
            <div style={{ marginTop: '.4em', fontSize: '.9em', color: 'var(--gray-11)' }}>
              {t('The deletion check asks before it removes the source videos you selected. By default only a source whose kept result is on disk can be deleted; the check\'s settings can allow the other kinds. A source that cannot be deleted can still be played and checked.')}
            </div>

            {patchNotice != null && (
              <>
                <div style={{ display: 'flex', gap: '.6em', alignItems: 'center', marginTop: '1em' }}>
                  <Switch
                    checked={!patchNotice.isSuppressed(patchNoticeFinishSummary)}
                    onCheckedChange={(v) => {
                      if (v) patchNotice.unsuppress(patchNoticeFinishSummary);
                      else patchNotice.suppress(patchNoticeFinishSummary);
                    }}
                  />
                  <span>{t('Show the finish summary')}</span>
                </div>
                <div style={{ marginTop: '.4em', fontSize: '.9em', color: 'var(--gray-11)' }}>
                  {t('The summary shown after the finish job. A job that did not fully succeed is always reported.')}
                </div>
              </>
            )}
          </div>

          <div style={{ marginTop: '1em', paddingTop: '.8em', borderTop: '1px solid var(--gray-6)' }}>
            <div style={{ fontWeight: 'bold', marginBottom: '.5em' }}>{t('Discarding a video')}</div>
            <div style={{ display: 'flex', gap: '.6em', alignItems: 'center' }}>
              <Switch checked={confirmDiscardSource} onCheckedChange={setConfirmDiscardSource} />
              <span>{t('Ask before moving a video to the waiting-for-deletion folder')}</span>
            </div>
            <div style={{ marginTop: '.4em', fontSize: '.9em', color: 'var(--gray-11)' }}>
              {t('Ctrl+Delete discards the video: it moves to the waiting-for-deletion folder and the next one opens.')}
            </div>
            <div style={{ display: 'flex', gap: '.6em', alignItems: 'center', marginTop: '1em' }}>
              <label htmlFor="patch-discard-results-action" style={{ flexGrow: 1 }}>{t('When a discarded video already has cut results')}</label>
              <Select id="patch-discard-results-action" value={discardResultsAction} onChange={(event) => { setDiscardResultsAction(event.target.value as PatchDiscardResultsAction); }}>
                <option value="ask">{t('Ask every time')}</option>
                <option value="delete">{t('Delete them permanently')}</option>
                <option value="detached">{t('Move them to the waiting-for-deletion folder')}</option>
              </Select>
            </div>
          </div>

          <div style={{ marginTop: '1em', paddingTop: '.8em', borderTop: '1px solid var(--gray-6)' }}>
            <div style={{ fontWeight: 'bold', marginBottom: '.5em' }}>{t('Source file list')}</div>
            <div style={{ display: 'flex', gap: '.6em', alignItems: 'center' }}>
              <Switch checked={confirmClearFileList} onCheckedChange={setConfirmClearFileList} />
              <span>{t('Ask before clearing the source file list')}</span>
            </div>
            <div style={{ marginTop: '.4em', fontSize: '.9em', color: 'var(--gray-11)' }}>
              {t('The file list can be cleared from its right-click menu. Clearing removes the rows only: the open video and its results stay.')}
            </div>
          </div>

          <Dialog.CloseButton />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
