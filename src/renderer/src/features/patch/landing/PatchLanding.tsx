import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { MenuItemConstructorOptions } from 'electron';
import { Trans, useTranslation } from 'react-i18next';

import SetCutpointButton from '../../../components/SetCutpointButton';
import SimpleModeButton from '../../../components/SimpleModeButton';
import { useAppContext } from '../../../contexts';
import { getModifier } from '../../../hooks/useTimelineScroll';
import useNativeMenu from '../../../hooks/useNativeMenu';
import useUserSettings from '../../../hooks/useUserSettings';
import type { StateSegment } from '../../../types';
import { isMac } from '../../../util';
import { pickDisplayKeyBinding } from '../../../../../common/features/patchKeys';
import { applyWindowBindings } from '../../../../../common/features/patchTransport/transport';
import type { KeyBinding } from '../../../../../common/types';
import usePatchMenuBarMenuItem from '../../patchMenuBar/usePatchMenuBarMenuItem';
import { usePatchWork } from '../../patchWork/PatchWorkProvider';
import ActionKeys from '../ActionKeys';
import { Keys, KnownIssuesList, usePatchHelpNotes } from './patchHelpNotes';
import styles from './PatchLanding.module.css';

/**
Patch-mode landing (fork-owned).

The outer dashed frame (the `NoFileLoaded` wrapper) is the drop target: dropping one or more
files anywhere inside it opens them (handled by the app-level drop listener). This component
draws an inner dashed box which is the *only* click target.

This split is deliberate: users new to the app tend to click around the landing page, and
keeping the click area separate from the rest of the frame prevents those stray clicks from
popping the file dialog over and over.

The guidance below the box is written as direct instructions rather than conversational asides:
a three-part quick guide that is always visible, then the five workflow steps and the notes
folded away. A newcomer should reach a finished clip from the quick guide alone; the folded
sections are there when something needs explaining, and the cleanup step says how the videos
parked for deletion are cleared out afterwards. The text is selectable and copyable (see
`PatchLanding.module.css`): the quick guide and the notes are the documentation users paste into
a chat when they ask for help.

Keys are never hardcoded. Editor actions render through `ActionKeys` (every binding of the
action, following the user's own bindings and the patch-mode remap); actions that only exist in
the results window, and the patch-preferred single keys, render through `keyOf`/`Keys`.
*/
export default function PatchLanding({ onClick, currentCutSeg, keyBindings }: {
  onClick: () => void,
  currentCutSeg: StateSegment | undefined,
  /** The keys as they really run: patch mode binds two cut-marking keys, and both are shown. */
  keyBindings: readonly KeyBinding[],
}) {
  const { t } = useTranslation();
  const { segmentMouseModifierKey } = useUserSettings();
  const { keyboardLayoutMap } = useAppContext();
  const patchWork = usePatchWork();
  // patch: the start screen's right-click menu offers the same menu-bar toggle as the video.
  const menuBarMenuItem = usePatchMenuBarMenuItem({ keyBindings, keyboardLayoutMap });

  /**
  A right-click with text selected belongs to the user: the menu offers Copy then, and the work
  folders otherwise. `selectionchange` keeps the flag current, so the next right-click builds its
  menu from the selection the drag just made.
  */
  const [hasSelection, setHasSelection] = useState(false);
  useEffect(() => {
    const onSelectionChange = () => {
      setHasSelection((window.getSelection()?.toString() ?? '') !== '');
    };
    document.addEventListener('selectionchange', onSelectionChange);
    return () => document.removeEventListener('selectionchange', onSelectionChange);
  }, []);

  // Right-click anywhere on the landing (the drop box and the tips) opens the work folders, so the
  // previous work areas - and what every source in them became - are reachable before any file is
  // loaded. The menu-bar toggle sits at the bottom, with the key the user actually has.
  const contextMenuTemplate = useMemo<MenuItemConstructorOptions[]>(() => [
    ...(hasSelection ? [
      { role: 'copy' as const, label: t('Copy') },
      { type: 'separator' as const },
    ] : []),
    {
      label: t('Work folders and results...'),
      click: () => patchWork?.setWorkPathListVisible(true),
    },
    { type: 'separator' as const },
    menuBarMenuItem,
  ], [hasSelection, menuBarMenuItem, patchWork, t]);
  const { openMenu } = useNativeMenu(contextMenuTemplate);

  const currentCutSegOrDefault = useMemo(() => currentCutSeg ?? { segColorIndex: 0 }, [currentCutSeg]);

  /**
  The steps below also describe the clip window, which re-purposes a few keys (it merges instead of
  exporting, and renames results instead of segments). Those actions exist only in the results
  window's table, so the landing resolves them from it as a fallback - otherwise the merge key
  would render as "Unbound" on a page that is explaining how to merge.
  */
  const resultsBindings = useMemo(() => applyWindowBindings(keyBindings, 'player'), [keyBindings]);
  const bindingsForLanding = useMemo(() => [...keyBindings, ...resultsBindings], [keyBindings, resultsBindings]);
  const keyOf = (action: string) => pickDisplayKeyBinding(bindingsForLanding, action, { preferMetaKey: isMac })?.keys;

  // The happy path in three parts: a first-time user should get a finished clip from this alone.
  // The keys are never hardcoded: they follow the user's bindings and the patch-mode remap.
  const quickStart: { id: string, node: ReactNode }[] = [
    {
      id: 'open',
      node: t('Drop one or more videos into the box, or click the dashed box above to pick files; right-click to see the work folders from an earlier session and what each source became.'),
    },
    {
      id: 'mark-and-export',
      node: (
        <>
          <div>
            <Trans>Press <ActionKeys keyBindings={keyBindings} action="seekBackwardsKeyframe" /> / <ActionKeys keyBindings={keyBindings} action="seekForwardsKeyframe" /> to step one keyframe, <ActionKeys keyBindings={keyBindings} action="seekBackwards" /> / <ActionKeys keyBindings={keyBindings} action="seekForwards" /> to jump one second.</Trans>
          </div>
          <div>
            <Trans><ActionKeys keyBindings={keyBindings} action="setCutStart" /> marks the start of the part to keep and <ActionKeys keyBindings={keyBindings} action="setCutEnd" /> marks the end.</Trans>
          </div>
          <div>
            <Trans>In the source window, <ActionKeys keyBindings={keyBindings} action="export" /> opens the cut export settings; press it again to start the export.</Trans>
          </div>
          <div>
            <Trans>In the clip window, <Keys keys={keyOf('mergeCutResults')} /> opens the naming dialog for the merged result; press it again to merge the clips into one file.</Trans>
          </div>
        </>
      ),
    },
    {
      id: 'finish',
      node: (
        <Trans>When a result is good, <ActionKeys keyBindings={keyBindings} action="finish" /> finishes the video and opens the next file, if there is one; the dialog can also stay on the same video and keep working on it.</Trans>
      ),
    },
  ];

  // The workflow in user order. Five stages: open, operate, export and finish, discard and skip,
  // clean up. Every step opens with the action it asks for, and the keys are never hardcoded:
  // they follow the user's bindings and the patch-mode remap.
  const workflowSteps: { id: string, node: ReactNode }[] = [
    {
      id: 'open',
      node: (
        <>
          <div><b>{t('Open the videos')}</b></div>
          <div>{t('Drop files anywhere in this window, or click the dashed box above to pick them.')}</div>
          <div>{t('By default each video gets its own work area next to it, so nothing has to be set up before the first cut; the folder names are in the working directory settings.')}</div>
        </>
      ),
    },
    {
      id: 'operate',
      node: (
        <>
          <div><b>{t('Operations and keys')}</b></div>
          <div>
            <Trans>The arrows differ from the official LosslessCut defaults: <ActionKeys keyBindings={keyBindings} action="seekBackwardsKeyframe" /> / <ActionKeys keyBindings={keyBindings} action="seekForwardsKeyframe" /> step one keyframe, <ActionKeys keyBindings={keyBindings} action="seekBackwards" /> / <ActionKeys keyBindings={keyBindings} action="seekForwards" /> jump one second, and <ActionKeys keyBindings={keyBindings} action="setCutStart" /> / <ActionKeys keyBindings={keyBindings} action="setCutEnd" /> mark the start and end of the part to keep.</Trans>
          </div>
          <div>
            <Trans><ActionKeys keyBindings={keyBindings} action="togglePatchMenuBar" /> shows or hides the app menu bar; the same entry is in the right-click menu of the video and of this start screen. It stays hidden in patch mode so a bare Alt cannot take the focus away from the cutting keys; open it only when a menu entry is needed, then hide it again (press Escape first if the bar itself has the focus).</Trans>
          </div>
          <div>
            <Trans>The preview volume is <ActionKeys keyBindings={keyBindings} action="toggleMuted" /> (mute), <ActionKeys keyBindings={keyBindings} action="decreaseVolume" /> (down) and <ActionKeys keyBindings={keyBindings} action="increaseVolume" /> (up).</Trans>
          </div>
          <div>
            <Trans>Scrolling the mouse wheel over the video changes the preview volume (up louder, down quieter); Ctrl, Alt and Shift with the wheel keep their zoom, frame-seek and keyframe-seek actions.</Trans>
          </div>
          <div>
            <Trans><ActionKeys keyBindings={keyBindings} action="toggleNewSegmentMark" /> makes the next start point begin a new segment instead of moving the current segment&apos;s start, so an already marked segment cannot be changed by mistake. It applies to the next start point only, and pressing it again cancels it; while it is armed, a New segment row appears above the segment list.</Trans>
          </div>
          <div>
            <Trans><ActionKeys keyBindings={keyBindings} action="jumpSeekPrevSegment" /> and <ActionKeys keyBindings={keyBindings} action="jumpSeekNextSegment" /> jump to the previous or next segment. <ActionKeys keyBindings={keyBindings} action="jumpCutStart" /> jumps to the current segment&apos;s start; <ActionKeys keyBindings={keyBindings} action="jumpSegmentEndPreview" /> stops a set number of seconds before its end, and pressing it again reaches the end. That number is in the working directory settings.</Trans>
          </div>
          <div>
            <Trans><ActionKeys keyBindings={keyBindings} action="removeCurrentCutpoint" /> removes the cut point, <ActionKeys keyBindings={keyBindings} action="splitCurrentSegment" /> splits, <ActionKeys keyBindings={keyBindings} action="labelCurrentSegment" /> labels, <ActionKeys keyBindings={keyBindings} action="duplicateCurrentSegment" /> duplicates, <ActionKeys keyBindings={keyBindings} action="undo" /> undoes.</Trans>
          </div>
          <div>
            <Trans><ActionKeys keyBindings={keyBindings} action="togglePlayNoResetSpeed" /> plays without changing the speed, <ActionKeys keyBindings={keyBindings} action="resetPlaybackRate" /> sets it back to 1x, <ActionKeys keyBindings={keyBindings} action="jumpTimelineStart" /> jumps to the start of the video, <ActionKeys keyBindings={keyBindings} action="jumpTimelineEnd" /> to the end, and <ActionKeys keyBindings={keyBindings} action="toggleFullscreenVideo" /> toggles full screen in the cutting window.</Trans>
          </div>
          <div>
            <Trans>The circle at the bottom right of a segment decides whether it is exported: an unselected segment stays in the list but does not enter the results. Dragging a row only changes the export and merge order, not the segment times.</Trans>
          </div>
          <div>
            <Trans>Playback speed and single frames sit under the left hand: <Keys keys={keyOf('reducePlaybackRate')} /> slows down, <Keys keys={keyOf('togglePlaybackRate')} /> toggles between 1x and the last speed you chose, <Keys keys={keyOf('increasePlaybackRate')} /> speeds up, and <Keys keys={keyOf('seekPreviousFrame')} /> / <Keys keys={keyOf('seekNextFrame')} /> step one frame back or forward.</Trans>
          </div>
          <div>
            <Trans>In the source window, <ActionKeys keyBindings={keyBindings} action="batchOpenPlayPreviousFile" /> and <ActionKeys keyBindings={keyBindings} action="batchOpenPlayNextFile" /> open the previous or next video and start playing it.</Trans>
          </div>
          <div>
            <Trans>Optional: if the built-in player stutters on a file, play it in another player. Switch back and press <ActionKeys keyBindings={keyBindings} action="goToTimecode" />, type the time and press Enter to jump there and mark points: plain digits read as a compact time (123456 = 12:34:56), two leading dots (..) ask for the timeline&apos;s timecode format, and a leading + or - seeks relative to now. The same key opens and closes this box.</Trans>
          </div>
        </>
      ),
    },
    {
      id: 'export-and-finish',
      node: (
        <>
          <div>
            <Trans><ActionKeys keyBindings={keyBindings} action="export" /> opens the cut export settings in the normal flow, and the same key starts the export.</Trans>
          </div>
          <div>
            {t('Change the segments again; only the segments that changed are cut again: unchanged clips are reused or renamed, and the notice says how many of each.')}
          </div>
          <div>
            {t('The files go into the clips and merged folders of the work area.')}
          </div>
          <div>
            <Trans>The cut clips open in their own window: <Keys keys={keyOf('playlistPrev')} /> and <Keys keys={keyOf('playlistNext')} /> walk them, <Keys keys={keyOf('renameResultLabel')} /> renames the label, <Keys keys={keyOf('renameResultFull')} /> the whole file name, and <Keys keys={keyOf('mergeCutResults')} /> merges them into one file (the naming dialog opens first).</Trans>
          </div>
          <div>
            <Trans>The same key exports in the source window and merges in the clip window; <ActionKeys keyBindings={keyBindings} action="finish" /> is always the finish key.</Trans>
          </div>
          <div>
            <Trans><ActionKeys keyBindings={keyBindings} action="finish" /> finishes. The dialog decides where the source goes (finished_src_media, detached_src_media for later deletion, or leave it where it is), whether the clips and the merged file are kept or deleted, and whether empty work folders are cleaned up; it then opens the next file or stays on the same video, as the dialog says.</Trans>
          </div>
        </>
      ),
    },
    {
      id: 'discard-and-skip',
      node: (
        <>
          <div>
            <Trans><ActionKeys keyBindings={keyBindings} action="discardSource" /> discards the cut results, prepares the source for deletion and opens the next video: it moves the source into the waiting-for-deletion folder, and the generated cut and merged files are deleted by default.</Trans>
          </div>
          <div>
            <Trans><ActionKeys keyBindings={keyBindings} action="finishKeepSource" /> skips the cut processing but keeps the source; by default the source moves to finished_skip_src.</Trans>
          </div>
          <div>
            {t('The last video of the batch stays open.')}
          </div>
          <div>
            {t('A video inside a work or finished folder is always read-only: an editing action opens a dialog that asks you to move the video out before cutting it again. Closing the source window also closes its clip-result and merged-result windows.')}
          </div>
        </>
      ),
    },
    {
      id: 'cleanup',
      node: (
        <>
          <div><b>{t('Clean up the sources waiting for deletion')}</b></div>
          <div>{t('Open Work folders and results (File menu, right-click on this page, or opl in the command console), select the work folder and press Check deletable source videos.')}</div>
          <div>{t('It opens a window of its own that lists each parked source and the results it produced in one group; the whole file can be decode-checked.')}</div>
          <div>{t('By default only a source whose kept result is still on disk counts toward the delete; the check\'s settings can allow the other kinds. A card that cannot be deleted says why on its state line, and the confirmation lists every file it will remove.')}</div>
          <div>{t('The result files cannot be deleted there; results, and sources whose kind is not allowed in the check\'s settings, still have to be handled in the file manager.')}</div>
        </>
      ),
    },
  ];

  // The notes live in `patchHelpNotes`: the landing page and `Help` → `Known issues` show one list.
  const notes = usePatchHelpNotes({ keyBindings });

  return (
    <div
      onContextMenu={(event) => {
        event.preventDefault();
        openMenu(event.nativeEvent);
      }}
      style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', minHeight: 0, padding: '.5em', whiteSpace: 'normal' }}
    >
      <button
        type="button"
        onClick={onClick}
        style={{ flex: '0 0 46%', minHeight: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: 0, background: 'transparent', color: 'inherit', font: 'inherit', cursor: 'pointer', border: '.35em dashed var(--gray-6)', borderRadius: '.4em' }}
      >
        <span style={{ fontSize: '1.7em', textTransform: 'uppercase', color: 'var(--gray-11)' }}>{t('Drop files or click here')}</span>
        <span style={{ fontSize: '1.1em', color: 'var(--gray-11)', marginTop: '.3em' }}>{t('Multiple files are supported.')}</span>
        <span style={{ fontSize: '.9em', color: 'var(--gray-11)', marginTop: '.6em' }}>{t('Right-click here to open a previous work folder and its results, or to check which parked sources can be deleted (the folder buttons open the file manager).')}</span>
      </button>

      {/* Centered column, left-aligned text. Selectable and copyable, unlike the rest of the frame. */}
      <div className={styles['selectable']} style={{ flexGrow: 1, minHeight: 0, overflow: 'auto', marginTop: '.8em', padding: '0 .5em', color: 'var(--gray-11)', textAlign: 'center' }}>
        <div style={{ display: 'inline-block', maxWidth: '48em', textAlign: 'left', verticalAlign: 'top' }}>
          <div style={{ fontSize: '1.2em', textTransform: 'uppercase', marginBottom: '.3em' }}>{t('Simple guide')}</div>

          <ol style={{ fontSize: '1.05em', listStylePosition: 'inside', whiteSpace: 'normal', lineHeight: 1.6, margin: '0 0 .9em', paddingLeft: 0 }}>
            {quickStart.map(({ id, node }) => <li key={id}>{node}</li>)}
          </ol>

          <details style={{ marginBottom: '.6em' }}>
            <summary style={{ fontSize: '1.2em', textTransform: 'uppercase', cursor: 'pointer', marginBottom: '.3em' }}>{t('The whole workflow')}</summary>
            <ol style={{ fontSize: '1.05em', listStylePosition: 'inside', whiteSpace: 'normal', lineHeight: 1.6, margin: '0 0 .6em', paddingLeft: 0 }}>
              {workflowSteps.map(({ id, node }) => <li key={id}>{node}</li>)}
            </ol>
          </details>

          <details style={{ marginBottom: '.6em' }}>
            <summary style={{ fontSize: '1.2em', textTransform: 'uppercase', cursor: 'pointer', marginBottom: '.3em' }}>{t('Notes ({{total}})', { total: notes.length })}</summary>
            <div style={{ fontSize: '1.05em', whiteSpace: 'normal', lineHeight: 1.5, margin: '0 0 .6em' }}>
              <KnownIssuesList notes={notes} />
            </div>
          </details>

          <div style={{ fontSize: '1.05em', marginBottom: '.6em' }}>
            <Trans>Command console <Keys keys={keyOf('togglePatchCommandConsole')} />: tkp keyboard practice, tbfl file list, tws work settings, opl work folders and results, cewd clear empty work folders; start typing to see every command.</Trans>
          </div>

          <div style={{ fontSize: '1.1em', marginBottom: '.2em' }}>
            <Trans>See <b>Help</b> menu for help</Trans>
          </div>

          <div style={{ fontSize: '1.1em' }}>
            <Trans><SetCutpointButton currentCutSeg={currentCutSegOrDefault} side="start" style={{ verticalAlign: 'middle' }} /> <SetCutpointButton currentCutSeg={currentCutSegOrDefault} side="end" style={{ verticalAlign: 'middle' }} /> set the cut point at the playhead, or hold <Keys keys={getModifier(segmentMouseModifierKey)} /> and drag the selected segment&apos;s ends on the timeline; dragging inside it moves the whole segment.</Trans>
          </div>

          <div style={{ fontSize: '1.1em', marginTop: '.3em' }}>
            <Trans><SimpleModeButton style={{ verticalAlign: 'middle' }} /> switches between the simple and the advanced view: the simple view hides the advanced controls in the bottom bar and the advanced export options.</Trans>
          </div>
        </div>
      </div>
    </div>
  );
}
