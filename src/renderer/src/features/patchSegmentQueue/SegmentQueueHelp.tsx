import i18n from 'i18next';
import { Fragment, useState } from 'react';
import type { ReactNode, SyntheticEvent } from 'react';
import { useTranslation, Trans } from 'react-i18next';

import Kbd from '../../components/Kbd';
import { splitKeyboardKeys } from '../../util';
import { selectedSegNumVariable } from '../../util/outputNameTemplate';
import patchConfig from '../patchWork/patchConfigApi';
import type { KeyBinding } from '../../../../common/types';
import ActionKeys from '../patch/ActionKeys';

/**
The keys of one action, as key caps.

The keys are never hardcoded: they follow the user's bindings (and the patch-mode remap), so the
notes never drift from what the keys actually do.
*/
function Keys({ keys }: { keys: string | undefined }) {
  if (keys == null || keys === '') {
    return <kbd>{i18n.t('Unbound')}</kbd>;
  }
  const split = splitKeyboardKeys(keys);
  return split.map((key, i) => (
    <Fragment key={key}><Kbd code={key} />{i < split.length - 1 && <span style={{ fontSize: '.7em', marginLeft: '-.2em', marginRight: '-.2em' }}>{' + '}</span>}</Fragment>
  ));
}

/**
The cut queue's own help (fork-owned).

It sits above the queue's buttons and explains the two numbers, the drag order and the keys
that move between the segments. The text is patch-mode copy: it describes the queue the way
patch mode uses it (a queue of clips to cut and merge), not the upstream segment list.

The guide starts open and the user closes it by hand: the state is remembered in the patch
settings, so a closed guide stays closed for the next file and the next session.
*/
export default function SegmentQueueHelp({ keyBindingByAction, keyBindings, multiSelect = false }: {
  keyBindingByAction: Record<string, KeyBinding>,
  /** The keys as they really run: the in/out points have two keys each in patch mode. */
  keyBindings: readonly KeyBinding[],
  /** The queue offers the Shift+click multi-selection (not in the merged window, not in invert mode). */
  multiSelect?: boolean | undefined,
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(() => patchConfig.getPatchSetting('segmentQueueHelpOpen'));

  const onToggle = (event: SyntheticEvent<HTMLDetailsElement>) => {
    const nextOpen = event.currentTarget.open;
    setOpen(nextOpen);
    patchConfig.setPatchSetting('segmentQueueHelpOpen', nextOpen);
  };

  const keyOf = (action: string) => keyBindingByAction[action]?.keys;

  // The template variable that numbers the files by the queue order (e.g. `${SELECTED_SEG_NUM}`).
  const selectedSegNumText = `\${${selectedSegNumVariable}}`;

  const items: { id: string, node: ReactNode }[] = [
    {
      id: 'what',
      node: t('Each segment is one exported clip. The circle toggles whether a segment is exported: an unselected segment stays in the list, but it does not take a queue number.'),
    },
    {
      id: 'current',
      node: t('The keys act on the current segment, not on the whole selection.'),
    },
    {
      id: 'overlap',
      node: t('Segments may overlap: two segments can cover the same part of the video, and the overlapping part is exported twice. Only the invert segments mode needs segments that do not overlap.'),
    },
    {
      id: 'select',
      node: <Trans>Press <Keys keys={keyOf('jumpSeekPrevSegment')} /> and <Keys keys={keyOf('jumpSeekNextSegment')} /> to make the previous or next segment the current one. The playhead follows.</Trans>,
    },
    {
      id: 'jump',
      node: <Trans>Press <Keys keys={keyOf('jumpCutStart')} /> to jump to the start of the current segment. <Keys keys={keyOf('jumpSegmentEndPreview')} /> jumps to just before its end, and pressing it again reaches the end.</Trans>,
    },
    {
      id: 'lead-in',
      node: <Trans><Keys keys={keyOf('jumpSegmentEndPreview')} /> stops this many seconds before the end; the number is set in the working directory settings.</Trans>,
    },
    {
      id: 'cut',
      node: <Trans>Press <ActionKeys keyBindings={keyBindings} action="setCutStart" /> and <ActionKeys keyBindings={keyBindings} action="setCutEnd" /> to set the in and out points, then step frame by frame with <ActionKeys keyBindings={keyBindings} action="seekPreviousFrame" /> and <ActionKeys keyBindings={keyBindings} action="seekNextFrame" /> to cut precisely.</Trans>,
    },
    {
      id: 'forced-new',
      node: <Trans>Press <ActionKeys keyBindings={keyBindings} action="toggleNewSegmentMark" /> to make the next in point start a new segment instead of moving the current one. The arm is used up by that press.</Trans>,
    },
    {
      id: 'duplicate',
      node: <Trans>Press <Keys keys={keyOf('duplicateCurrentSegment')} /> to copy the current segment. The copy is placed right after it.</Trans>,
    },
    {
      id: 'drag',
      node: t('Drag a row to change the queue order. It only changes the export and merge order, not the segment times. The colored number is the segment\'s place in the video by start time, the plain number is its place in the queue.'),
    },
    {
      id: 'menu',
      node: t('Right-click a row to jump to the segment, add, label, remove or duplicate it, select segments by label or by expression, change the order, edit its tags or extract frames from it.'),
    },
    // Only the cutting window's queue has the Shift+click multi-selection.
    ...(multiSelect ? [{
      id: 'multi-select',
      node: t('Shift+click a row to start a selection of rows. Every further Shift+click adds or removes the block between the previous row and the clicked one; Shift+click the same row again to take it back out. The bar under the list then deletes those rows, marks them as exported or not exported, or keeps only them. Escape or a plain click leaves the selection. The selection is not the export selection: nothing about the export changes until a button in the bar is pressed.'),
    }] : []),
    {
      id: 'multi-select-empty',
      node: t('The export falls back to all segments when no segment is marked as exported, so marking every row as not exported changes nothing.'),
    },
    {
      id: 'again',
      node: t('If a clip was already exported, exporting again after a reorder only renames the files: nothing is cut a second time. The export still saves the new order, and the merge in the results window joins the clips in that order. A segment you take out of the queue leaves the results: after the next export, a merge no longer contains it.'),
    },
    {
      id: 'naming',
      node: t('To name the files after the queue order, use {{segNumVar}} in the output file name template.', { segNumVar: selectedSegNumText }),
    },
  ];

  return (
    <details open={open} onToggle={onToggle} style={{ padding: '.4em .6em', borderTop: '1px solid var(--gray-6)', color: 'var(--gray-11)', fontSize: '.8em' }}>
      <summary style={{ cursor: 'pointer' }}>{t('How the cut queue works')}</summary>
      <ol style={{ margin: '.4em 0 .2em', paddingLeft: '1.2em', lineHeight: 1.5 }}>
        {items.map(({ id, node }) => <li key={id}>{node}</li>)}
      </ol>
    </details>
  );
}
