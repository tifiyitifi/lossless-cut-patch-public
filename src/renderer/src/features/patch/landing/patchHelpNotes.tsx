import { Fragment } from 'react';
import type { ReactNode } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import Kbd from '../../../components/Kbd';
import { isMac, splitKeyboardKeys } from '../../../util';
import { pickDisplayKeyBinding } from '../../../../../common/features/patchKeys';
import type { KeyBinding } from '../../../../../common/types';

/**
The known issues of patch mode (fork-owned).

One list serves both places that show them: the landing page's notes fold-out and the
`Help` → `Known issues` dialog, so a limitation is written once. The keys are never hardcoded:
they follow the user's bindings and the patch-mode remap.
*/

/** Render a key binding as `kbd` elements (`Unbound` when the action has no key). */
export function Keys({ keys }: { keys: string | undefined }) {
  const { t } = useTranslation();
  if (keys == null || keys === '') {
    return <kbd>{t('Unbound')}</kbd>;
  }
  const split = splitKeyboardKeys(keys);
  return split.map((key, i) => (
    <Fragment key={key}><Kbd code={key} />{i < split.length - 1 && <span style={{ fontSize: '.7em', marginLeft: '-.2em', marginRight: '-.2em' }}>{' + '}</span>}</Fragment>
  ));
}

/** The notes as a numbered list: one number badge per row, so a long list stays readable. */
export function KnownIssuesList({ notes }: { notes: readonly { id: string, node: ReactNode }[] }) {
  return (
    <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '.7em' }}>
      {notes.map(({ id, node }, index) => (
        <li key={id} style={{ display: 'flex', alignItems: 'flex-start', gap: '.65em' }}>
          <span
            aria-hidden
            style={{ flex: '0 0 1.6em', width: '1.6em', height: '1.6em', marginTop: '.1em', borderRadius: '50%', background: 'var(--gray-5)', color: 'var(--gray-12)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '.8em', fontWeight: 700, lineHeight: 1 }}
          >
            {index + 1}
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>{node}</div>
        </li>
      ))}
    </ol>
  );
}

/** The list, with the keys resolved for the window that shows it. */
export function usePatchHelpNotes({ keyBindings }: {
  keyBindings: readonly KeyBinding[];
}): { id: string, node: ReactNode }[] {
  const { t } = useTranslation();
  const keyOf = (action: string) => pickDisplayKeyBinding(keyBindings, action, { preferMetaKey: isMac })?.keys;

  return [
    {
      id: 'files',
      node: (
        <Trans>While editing, cut files are written to .losslesscut_work/clips next to the video and merged files to .losslesscut_work/merged (or into the working directory, if one is set); finishing moves the files to losslesscut_finished (both folder names can be changed in the settings). <Keys keys={keyOf('finishKeepSource')} /> skips the cut and puts the source in losslesscut_finished/finished_skip_src, separate from the sources kept after processing (finished_src_media).</Trans>
      ),
    },
    {
      id: 'detached',
      node: t('At the moment the app does not empty the waiting-for-deletion folders by itself: parked results (detached_clips, detached_merged) and a parked source without a kept result have to be deleted by hand in the file manager; the deletion check only deletes a source whose kept result is still on disk.'),
    },
    {
      id: 'discard-moves',
      node: (
        <Trans><Keys keys={keyOf('discardSource')} /> does not delete a video: it moves it into detached_src_media and opens the next one. At the moment the app does not delete it on its own; it can be deleted for good in the deletion check (if it has a kept result on disk) or in the file manager.</Trans>
      ),
    },
    { id: 'parked-locked', node: t('If another player has the same video open, the moved file may not be openable or deletable until that player is closed. On exFAT drives (most portable SSDs) Windows reports this as "access denied" instead of "in use", so the file looks broken, and Shift+Delete in Explorer also fails without deleting anything. Close the player and delete it again; if it still cannot be solved, consider reporting a bug.') },
    {
      id: 'file-switching',
      node: (
        <Trans>The file list moves one file per step: <Keys keys={keyOf('batchPreviousFile')} /> / <Keys keys={keyOf('batchNextFile')} /> only move the highlight, <Keys keys={keyOf('batchOpenSelectedFile')} /> opens the highlighted file, <Keys keys={keyOf('batchOpenPreviousFile')} /> / <Keys keys={keyOf('batchOpenNextFile')} /> open it without the extra step, and <Keys keys={keyOf('batchOpenPlayPreviousFile')} /> / <Keys keys={keyOf('batchOpenPlayNextFile')} /> open it and start playing. Otherwise an opened source starts paused: press <Keys keys={keyOf('togglePlayNoResetSpeed')} /> to play it.</Trans>
      ),
    },
    {
      id: 'list-details',
      node: t('Each row shows how long the file is, how big it is and when it was last changed. MP4, MOV, MKV, WebM and their variants (M4V, M4A, 3GP, MKA) are read from the file header, so their length usually arrives first; TS, AVI and other containers need FFprobe, so their length arrives a second or two later, and a large batch of those costs a few seconds of background CPU in this run (the values are kept, so each file is read once). A file the app cannot read simply has no values in that line. If a sort by duration cannot read a single file, it explains that once, and the duration option stays greyed out for the rest of the run while the other sort keys keep working. The Work folders and results dialog shows the duration and the size under each file name, read the same way, but not the modification time.'),
    },
    {
      id: 'list-order',
      node: t('The sort menu next to the list title orders the files by name, extension, size, modification time or duration; the value that was sorted by is the only one not dimmed in the row, and clicking the same key again flips the direction. The previous and next file keys follow the order you see, so after a sort they walk the list in that order. Dragging a row makes your order the manual one again.'),
    },
    {
      id: 'list-width',
      node: t('Drag the right edge of the source file list to change its width, and double-click the edge to go back to the default width; the width is remembered after a restart. Click the eye button with the list name in the top bar (or tbfl in the command console) to show or hide the batch file list.'),
    },
    {
      id: 'merge-seam',
      node: (
        <Trans>Merging lossless clips leaves a hole of two to three frames at every join, so playback stutters there and fast-forwards for a moment after you seek (a known ffmpeg limitation: mifi/lossless-cut #2921, #1202). In the export settings (<Keys keys={keyOf('export')} />), A and B repair it by re-encoding a small group of frames at each cut point: A keeps a little extra past every cut end, B cuts exactly where you asked. C keeps the old behaviour (no re-encoding, joins still stutter). The choice is baked into each clip when it is cut, so merging reuses it as is.</Trans>
      ),
    },
    { id: 'damaged-source', node: t('A downloaded video can have a damaged first GOP: the app warns you when it sees decode errors; no cut can repair those frames — only a new download or re-encoding that spot can.') },
    { id: 'result-collision', node: t('If two results of the same export would get the same name, both get the position in the export and the time appended, so neither overwrites the other. A name already taken by a file the app does not own (another source, for example) is not renamed automatically: with overwrite off that result is skipped and reported, with it on the file is replaced.') },
    { id: 'keyframe-cut', node: t('Keyframe cut: enabled snaps the segment to the preceding keyframe (more before, less after); disabled cuts at the exact point but may leave an empty start (less before, more after).') },
    { id: 'player-sync', node: t('If a merged file still plays fast for a moment after you seek in PotPlayer, turn off its automatic audio/video sync: the player then stops catching up with the broken join. It hides the symptom; the repair above removes the cause.') },
    { id: 'video-named-project', node: t('A cut list named after the video itself is read too: an a.llc next to a.mp4 (or in the working folder) is loaded when the video is opened, but the app still saves to a-proj.llc. Merely opening it does not create that file; changing the cut list, exporting or finishing the job writes it, and the next open prefers it. Delete the .llc once you have checked it, or turn the project-file auto-save off. When both exist, -proj.llc wins.') },
    // Base mode's start page carries the same cut-point sentence with a nested `<span><kbd>` around
    // the modifier, which makes the key that react-i18next builds at runtime differ from the one the
    // extractor stored - so that line falls back to English in every translation. Patch mode does
    // not use that markup (see PatchLanding), but the list is where a user reports such a thing, so
    // the known issue is named here until upstream's line is fixed.
    { id: 'base-mode-cutpoint-english', node: t('In base mode, the last line of the empty start page (the cut-point sentence) is shown in English even when the app is translated: the markup of the sentence and its stored translation key do not match, so the app falls back to the English text. The same line in patch mode is not affected.') },
  ];
}
