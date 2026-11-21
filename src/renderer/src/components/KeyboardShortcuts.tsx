import type { ReactNode, SetStateAction, Dispatch } from 'react';
import { memo, Fragment, useEffect, useMemo, useCallback, useState, useRef } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { FaMouse, FaPlus, FaStepForward, FaStepBackward, FaUndo, FaTrash, FaSave, FaHammer } from 'react-icons/fa';
import groupBy from 'lodash/groupBy';
import orderBy from 'lodash/orderBy';
import uniq from 'lodash/uniq';
import { AnimatePresence, motion } from 'motion/react';

import useUserSettings from '../hooks/useUserSettings';
import SetCutpointButton from './SetCutpointButton';
import SegmentCutpointButton from './SegmentCutpointButton';
import { getModifier } from '../hooks/useTimelineScroll';
import type { KeyBinding, KeyboardAction, KeyBindingScope, ModifierKey } from '../../../common/types';
import type { StateSegment } from '../types';
import { allModifiers, altModifiers, controlModifiers, metaModifiers, shiftModifiers, splitKeyboardKeys } from '../util';
import { analyzeDisableImpact, analyzeKeyBindingConflicts, describeLayoutDifferences, describeUserChanges, hasUserChanges, isKeyBindingEnabled, isPatchModeOnlyAction, keyBindingScope } from '../../../common/features/patchKeys';
import { keyCombination } from '../../../common/features/patchTransport';
import ActionKeys from '../features/patch/ActionKeys';
import * as Dialog from './Dialog';
import Warning from './Warning';
import Button, { DialogButton } from './Button';
import Action from './Action';
import TextInput from './TextInput';
import Kbd from './Kbd';
import Switch from './Switch';
import Select from './Select';
import { useAppContext } from '../contexts';


type Category = string;

type ActionsMap = Record<KeyboardAction, { name: string, category?: Category, before?: ReactNode }>;


const renderKeys = (keys: string[]) => keys.map((key, i) => (
  <Fragment key={key}>
    {i > 0 && <FaPlus style={{ verticalAlign: 'middle', fontSize: '.4em', opacity: 0.8, marginLeft: '.4em', marginRight: '.4em' }} />}
    <Kbd code={key} />
  </Fragment>
));

// For modifier keys you can use shift, ctrl, alt, or meta.
// You can substitute option for alt and command for meta.
function fixKeys(keys: string[]) {
  const uniqed = uniq(keys);
  const nonModifierKeys = keys.filter((key) => !allModifiers.has(key));
  if (nonModifierKeys.length !== 1) return []; // only modifiers is invalid, and there can only be one non-modifier
  return orderBy(uniqed, [(key) => !shiftModifiers.has(key), (key) => !controlModifiers.has(key), (key) => !altModifiers.has(key), (key) => !metaModifiers.has(key), (key) => key]);
}

// eslint-disable-next-line react/display-name
const CreateBinding = memo(({
  actionsMap, action, keyBindings, setCreatingBinding, onNewKeyBindingConfirmed,
}: {
  actionsMap: ActionsMap,
  action: KeyboardAction | undefined,
  keyBindings: readonly KeyBinding[],
  setCreatingBinding: Dispatch<SetStateAction<KeyboardAction | undefined>>,
  onNewKeyBindingConfirmed: (a: KeyboardAction, keys: string[], scope: KeyBindingScope) => void,
}) => {
  const { t } = useTranslation();

  const [keysDown, setKeysDown] = useState<string[]>([]);
  // A new binding is the user's own unless they say otherwise: it runs in both modes and may not
  // collide with anything. Base / patch are for deliberately pinning a key to one layout.
  const [scope, setScope] = useState<KeyBindingScope>('user');

  const validKeysDown = useMemo(() => fixKeys(keysDown), [keysDown]);

  const isShown = action != null;

  useEffect(() => {
    if (isShown) {
      // todo
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setKeysDown([]);
    }
  }, [isShown]);

  const addKeyDown = useCallback((character: string) => setKeysDown((old) => [...new Set([...old, character])]), []);

  useEffect(() => {
    if (!isShown) return undefined;

    const handleKeyDown = (e: KeyboardEvent) => {
      // console.log(e)
      addKeyDown(e.code);
      e.preventDefault();
      e.stopPropagation();
    };

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [addKeyDown, isShown]);

  const isComboInvalid = validKeysDown.length === 0 && keysDown.length > 0;

  const fixedKeys = useMemo(() => fixKeys(keysDown), [keysDown]);

  // The binding as it would be saved, and what it collides with (pure `common` logic).
  const candidate = useMemo<KeyBinding | undefined>(() => (
    action != null && fixedKeys.length > 0 ? { keys: fixedKeys.join('+'), action, scope } : undefined
  ), [action, fixedKeys, scope]);
  const conflictReport = useMemo(() => (candidate != null ? analyzeKeyBindingConflicts(keyBindings, candidate) : undefined), [candidate, keyBindings]);
  const isBlocked = (conflictReport?.conflicts.length ?? 0) > 0 && conflictReport?.severity === 'blocking';

  if (action == null) return null;

  return (
    <Dialog.Root open={isShown} onOpenChange={(v) => !v && setCreatingBinding(undefined)}>
      <Dialog.Portal>
        <Dialog.Overlay />
        <Dialog.Content style={{ width: '40em' }} aria-describedby={undefined}>
          <Dialog.Title>{t('Bind new key to action')}</Dialog.Title>

          <p>{t('Action:')} {actionsMap[action].name} <span style={{ color: 'var(--gray-10)', marginLeft: '.5em' }}><Action name={action} /></span></p>

          {isPatchModeOnlyAction(action) && (
            <Warning style={{ marginBottom: '.5em', fontSize: '.9em' }}>
              {t('This action only runs in patch mode. In base mode its key explains that instead of running the action.')}
            </Warning>
          )}

          <p>{t('Please press your desired key combination. Make sure it doesn\'t conflict with any other binding or system hotkeys.')}</p>

          <div style={{ marginBottom: '.6em' }}>
            <span style={{ marginRight: '.5em' }}>{t('Scope')}</span>
            <Select value={scope} onChange={(e) => setScope(e.target.value as KeyBindingScope)}>
              <option value="user">{t('My key (both modes: may not collide with a default)')}</option>
              <option value="base">{t('Base mode only (may collide: patch mode wins there)')}</option>
              <option value="patch">{t('Patch mode only (may collide: base mode wins there)')}</option>
            </Select>
          </div>
          <div style={{ fontSize: '.85em', opacity: 0.7, marginBottom: '.8em' }}>
            {t('A key of your own runs in both modes, so it must not take a key a default already uses. A base or patch key belongs to one layout: it may collide, and the other mode\'s layout wins there. Base mode keeps the official keys exactly as they ship, so the keys patch mode adds belong to patch mode only. Defaults cannot be deleted, only switched off; switching one off gives its key back to the other mode\'s default.')}
          </div>

          <div style={{ minHeight: '2em' }}>{renderKeys(validKeysDown.length > 0 ? validKeysDown : keysDown)}</div>

          <AnimatePresence>
            {isComboInvalid && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
              >
                <Warning style={{ paddingBottom: '1em' }}>{t('Combination is invalid')}</Warning>
              </motion.div>
            )}
          </AnimatePresence>

          {conflictReport != null && conflictReport.conflicts.length > 0 && (
            <Warning style={{ paddingBottom: '1em', fontSize: '.9em' }}>
              {isBlocked
                ? <div>{t('This key is already used by a default or by another key of yours. A key of your own may not take it: change the scope above, or switch that binding off first.')}</div>
                : <div>{t('Warning: this key is already used by the other layout. In that mode the other layout wins, so this key will not run there.')}</div>}
              <ul style={{ margin: '.3em 0 0', paddingLeft: '1.2em' }}>
                {conflictReport.conflicts.map((conflict) => (
                  <li key={`${conflict.binding.keys}-${conflict.binding.action}`}>
                    {t('{{keys}} is bound to "{{action}}".', { keys: conflict.binding.keys.split('+').join(' + '), action: actionsMap[conflict.binding.action]?.name ?? conflict.binding.action })}
                    {' '}
                    {conflict.bindingAlternatives.length > 0
                      ? t('That action stays reachable with {{keys}}.', { keys: conflict.bindingAlternatives.join(', ') })
                      : t('That action has no other key.')}
                  </li>
                ))}
              </ul>
            </Warning>
          )}

          <div style={{ marginBottom: '1em', display: 'flex', gap: '.5em', flexWrap: 'wrap' }}>
            {!keysDown.includes('esc') && <Button style={{ padding: '.2em .4em' }} onClick={() => addKeyDown('esc')}>ESC</Button>}
            {keysDown.length > 0 && (
              <Button onClick={() => setKeysDown([])}><FaUndo style={{ fontSize: '.8em', verticalAlign: 'middle', marginRight: '.3em' }} />{t('Start over')}</Button>
            )}
          </div>

          <Dialog.ButtonRow>
            <DialogButton disabled={fixedKeys.length === 0 || isComboInvalid || isBlocked} onClick={() => action != null && onNewKeyBindingConfirmed(action, fixedKeys.length > 0 ? fixedKeys : keysDown, scope)} primary>
              <FaSave style={{ marginRight: '.3em', verticalAlign: 'middle' }} />{t('Save')}
            </DialogButton>
          </Dialog.ButtonRow>

          <Dialog.CloseButton />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
});

const rowStyle = { display: 'flex', alignItems: 'center', borderBottom: '1px solid rgba(0,0,0,0.1)', paddingBottom: '.2em' };

function WheelModifier({ text, wheelText, modifier }: { text: string, wheelText: string, modifier: ModifierKey }) {
  return (
    <div style={{ ...rowStyle, alignItems: 'center' }}>
      <span>{text}</span>
      <div style={{ flexGrow: 1 }} />
      <kbd style={{ marginRight: '.7em' }}>{getModifier(modifier)}</kbd>
      <FaMouse style={{ marginRight: '.3em' }} />
      <span>{wheelText}</span>
    </div>
  );
}

// eslint-disable-next-line react/display-name
const KeyboardShortcuts = memo(({
  keyBindings, displayKeyBindings, setKeyBindings, resetKeyBindings, currentCutSeg, onTriggerActionClick, patchMode,
}: {
  keyBindings: KeyBinding[],
  /** The keys as they really run (patch mode re-purposes some). Defaults to `keyBindings`. */
  displayKeyBindings?: KeyBinding[] | undefined,
  setKeyBindings: Dispatch<SetStateAction<KeyBinding[]>>,
  resetKeyBindings: () => void,
  currentCutSeg: StateSegment | undefined,
  onTriggerActionClick: (action: KeyboardAction) => void,
  /** The base / patch summary only makes sense where both layouts exist. */
  patchMode?: boolean | undefined,
}) => {
  const { t } = useTranslation();
  const { updateKeyboardLayout, confirmDialog } = useAppContext();

  const { mouseWheelZoomModifierKey, mouseWheelFrameSeekModifierKey, mouseWheelKeyframeSeekModifierKey, segmentMouseModifierKey } = useUserSettings();

  const { actionsMap, extraLinesPerCategory } = useMemo(() => {
    const playbackCategory = t('Playback');
    const selectivePlaybackCategory = t('Playback/preview segments only');
    const seekingCategory = t('Seeking');
    const segmentsAndCutpointsCategory = t('Segments and cut points');
    const zoomOperationsCategory = t('Timeline/zoom operations');
    const outputCategory = t('Output actions');
    const batchFilesCategory = t('Batch file list');
    const cutResultsCategory = t('Cut results');
    const otherCategory = t('Other operations');
    const streamsCategory = t('Tracks');
    const finishCategory = t('Finishing the job');

    // eslint-disable-next-line no-shadow
    const actionsMap: ActionsMap = {
      toggleLastCommands: {
        name: t('Last ffmpeg commands'),
      },
      toggleKeyboardShortcuts: {
        name: t('Keyboard & mouse shortcuts'),
      },

      // playbackCategory
      togglePlayResetSpeed: {
        name: t('Play/pause'),
        category: playbackCategory,
      },
      togglePlayNoResetSpeed: {
        name: t('Play/pause (no reset speed)'),
        category: playbackCategory,
      },
      play: {
        name: t('Play'),
        category: playbackCategory,
      },
      pause: {
        name: t('Pause'),
        category: playbackCategory,
      },
      increasePlaybackRate: {
        name: t('Speed up playback'),
        category: playbackCategory,
      },
      reducePlaybackRate: {
        name: t('Slow down playback'),
        category: playbackCategory,
      },
      increasePlaybackRateMore: {
        name: t('Speed up playback more'),
        category: playbackCategory,
      },
      // patch: patch mode's K slot (see common/features/patchTransport).
      resetPlaybackRate: {
        name: t('Reset playback speed'),
        category: playbackCategory,
      },
      // patch: patch mode's Z slot: toggle 1x and the last chosen speed.
      togglePlaybackRate: {
        name: t('Toggle playback speed'),
        category: playbackCategory,
      },
      reducePlaybackRateMore: {
        name: t('Slow down playback more'),
        category: playbackCategory,
      },
      increaseVolume: {
        name: t('Increase audio volume'),
        category: playbackCategory,
      },
      decreaseVolume: {
        name: t('Decrease audio volume'),
        category: playbackCategory,
      },
      toggleMuted: {
        name: t('Mute preview'),
        category: playbackCategory,
      },
      reloadFile: {
        name: t('Reload current media'),
        category: playbackCategory,
      },
      html5ify: {
        name: t('Convert to supported format'),
        category: playbackCategory,
      },
      makeCursorTimeZero: {
        name: t('Make cursor time zero'),
        category: playbackCategory,
      },

      // selectivePlaybackCategory
      togglePlayOnlyCurrentSegment: {
        name: t('Play current segment once'),
        category: selectivePlaybackCategory,
      },
      toggleLoopOnlyCurrentSegment: {
        name: t('Loop current segment'),
        category: selectivePlaybackCategory,
      },
      toggleLoopStartEndOnlyCurrentSegment: {
        name: t('Loop beginning and end of current segment'),
        category: selectivePlaybackCategory,
      },
      togglePlaySelectedSegments: {
        name: t('Play selected segments in order'),
        category: selectivePlaybackCategory,
      },
      toggleLoopSelectedSegments: {
        name: t('Loop selected segments in order'),
        category: selectivePlaybackCategory,
      },

      // seekingCategory
      seekPreviousFrame: {
        name: t('Step backward 1 frame'),
        category: seekingCategory,
      },
      seekNextFrame: {
        name: t('Step forward 1 frame'),
        category: seekingCategory,
      },
      seekBackwards: {
        name: t('Backward seek'),
        category: seekingCategory,
      },
      seekForwards: {
        name: t('Forward seek'),
        category: seekingCategory,
      },
      seekBackwards2: {
        name: t('Backward seek (longer)'),
        category: seekingCategory,
      },
      seekForwards2: {
        name: t('Forward seek (longer)'),
        category: seekingCategory,
      },
      seekBackwards3: {
        name: t('Backward seek (longest)'),
        category: seekingCategory,
      },
      seekForwards3: {
        name: t('Forward seek (longest)'),
        category: seekingCategory,
      },
      seekBackwardsKeyframe: {
        name: t('Seek previous keyframe'),
        category: seekingCategory,
      },
      seekForwardsKeyframe: {
        name: t('Seek next keyframe'),
        category: seekingCategory,
      },
      seekBackwardsPercent: {
        name: t('Seek backward 1% of timeline at current zoom'),
        category: seekingCategory,
      },
      seekForwardsPercent: {
        name: t('Seek forward 1% of timeline at current zoom'),
        category: seekingCategory,
      },
      jumpCutStart: {
        name: t('Jump to current segment\'s start time'),
        category: seekingCategory,
        before: <SegmentCutpointButton currentCutSeg={currentCutSeg} side="start" Icon={FaStepBackward} style={{ verticalAlign: 'middle', marginRight: 5 }} />,
      },
      jumpCutEnd: {
        name: t('Jump to current segment\'s end time'),
        category: seekingCategory,
        before: <SegmentCutpointButton currentCutSeg={currentCutSeg} side="end" Icon={FaStepForward} style={{ verticalAlign: 'middle', marginRight: 5 }} />,
      },
      // patch: stops a lead-in before the end, so the tail can be reviewed (common/features/patchTransport).
      jumpSegmentEndPreview: {
        name: t('Jump just before the current segment\'s end'),
        category: seekingCategory,
      },
      jumpTimelineStart: {
        name: t('Jump to start of video'),
        category: seekingCategory,
      },
      jumpTimelineEnd: {
        name: t('Jump to end of video'),
        category: seekingCategory,
      },
      goToTimecode: {
        name: t('Seek to timecode'),
        category: seekingCategory,
      },

      // segmentsAndCutpointsCategory
      addSegment: {
        name: t('Add cut segment'),
        category: segmentsAndCutpointsCategory,
      },
      removeCurrentCutpoint: {
        name: t('Remove current segment cutpoint'),
        category: segmentsAndCutpointsCategory,
      },
      removeCurrentSegment: {
        name: t('Remove current segment'),
        category: segmentsAndCutpointsCategory,
      },
      setCutStart: {
        name: t('Start current segment at current time'),
        category: segmentsAndCutpointsCategory,
        before: <SetCutpointButton currentCutSeg={currentCutSeg} side="start" style={{ verticalAlign: 'middle', marginRight: 5 }} />,
      },
      setCutEnd: {
        name: t('End current segment at current time'),
        category: segmentsAndCutpointsCategory,
        before: <SetCutpointButton currentCutSeg={currentCutSeg} side="end" style={{ verticalAlign: 'middle', marginRight: 5 }} />,
      },
      labelCurrentSegment: {
        name: t('Label current segment'),
        category: segmentsAndCutpointsCategory,
      },
      editCurrentSegmentTags: {
        name: t('Edit current segment tags'),
        category: segmentsAndCutpointsCategory,
      },
      splitCurrentSegment: {
        name: t('Split segment at cursor'),
        category: segmentsAndCutpointsCategory,
      },
      focusSegmentAtCursor: {
        name: t('Focus segment at cursor'),
        category: segmentsAndCutpointsCategory,
      },
      selectSegmentsAtCursor: {
        name: t('Select segments at cursor'),
        category: segmentsAndCutpointsCategory,
      },
      duplicateCurrentSegment: {
        name: t('Duplicate current segment'),
        category: segmentsAndCutpointsCategory,
      },
      jumpPrevSegment: {
        name: t('Jump to previous segment'),
        category: segmentsAndCutpointsCategory,
      },
      jumpSeekPrevSegment: {
        name: t('Jump & seek to previous segment'),
        category: segmentsAndCutpointsCategory,
      },
      jumpNextSegment: {
        name: t('Jump to next segment'),
        category: segmentsAndCutpointsCategory,
      },
      jumpSeekNextSegment: {
        name: t('Jump & seek to next segment'),
        category: segmentsAndCutpointsCategory,
      },
      jumpFirstSegment: {
        name: t('Jump to first segment'),
        category: segmentsAndCutpointsCategory,
      },
      jumpSeekFirstSegment: {
        name: t('Jump & seek to first segment'),
        category: segmentsAndCutpointsCategory,
      },
      jumpLastSegment: {
        name: t('Jump to last segment'),
        category: segmentsAndCutpointsCategory,
      },
      jumpSeekLastSegment: {
        name: t('Jump & seek to last segment'),
        category: segmentsAndCutpointsCategory,
      },
      reorderSegsByStartTime: {
        name: t('Reorder segments by start time'),
        category: segmentsAndCutpointsCategory,
      },
      invertAllSegments: {
        name: t('Invert all segments on timeline'),
        category: segmentsAndCutpointsCategory,
      },
      fillSegmentsGaps: {
        name: t('Fill gaps between segments'),
        category: segmentsAndCutpointsCategory,
      },
      shiftAllSegmentTimes: {
        name: t('Shift all segments on timeline'),
        category: segmentsAndCutpointsCategory,
      },
      alignSegmentTimesToKeyframes: {
        name: t('Align segment times to keyframes'),
        category: segmentsAndCutpointsCategory,
      },
      createSegmentsFromKeyframes: {
        name: t('Create segments from keyframes'),
        category: segmentsAndCutpointsCategory,
      },
      createFixedDurationSegments: {
        name: t('Create fixed duration segments'),
        category: segmentsAndCutpointsCategory,
      },
      createNumSegments: {
        name: t('Create num segments'),
        category: segmentsAndCutpointsCategory,
      },
      createFixedByteSizedSegments: {
        name: t('Create byte sized segments'),
        category: segmentsAndCutpointsCategory,
      },
      createRandomSegments: {
        name: t('Create random segments'),
        category: segmentsAndCutpointsCategory,
      },
      detectBlackScenes: {
        name: t('Detect black scenes'),
        category: segmentsAndCutpointsCategory,
      },
      detectSilentScenes: {
        name: t('Detect silent scenes'),
        category: segmentsAndCutpointsCategory,
      },
      detectSceneChanges: {
        name: t('Detect scene changes'),
        category: segmentsAndCutpointsCategory,
      },
      shuffleSegments: {
        name: t('Shuffle segments order'),
        category: segmentsAndCutpointsCategory,
      },
      combineOverlappingSegments: {
        name: t('Combine overlapping segments'),
        category: segmentsAndCutpointsCategory,
      },
      combineSelectedSegments: {
        name: t('Combine selected segments'),
      },
      clearSegments: {
        name: t('Clear all segments'),
        category: segmentsAndCutpointsCategory,
      },
      toggleSegmentsList: {
        name: t('Show sidebar'),
        category: segmentsAndCutpointsCategory,
      },
      selectOnlyCurrentSegment: {
        name: t('Select only this segment'),
        category: segmentsAndCutpointsCategory,
      },
      toggleCurrentSegmentSelected: {
        name: t('Toggle current segment selected'),
        category: segmentsAndCutpointsCategory,
      },
      deselectAllSegments: {
        name: t('Deselect all segments'),
        category: segmentsAndCutpointsCategory,
      },
      selectAllSegments: {
        name: t('Select all segments'),
        category: segmentsAndCutpointsCategory,
      },
      selectAllMarkers: {
        name: t('Select all markers'),
        category: segmentsAndCutpointsCategory,
      },
      selectSegmentsByLabel: {
        name: t('Select segments by label'),
        category: segmentsAndCutpointsCategory,
      },
      selectSegmentsByExpr: {
        name: t('Select segments by expression'),
        category: segmentsAndCutpointsCategory,
      },
      labelSelectedSegments: {
        name: t('Label selected segments'),
        category: segmentsAndCutpointsCategory,
      },
      invertSelectedSegments: {
        name: t('Invert selected segments'),
        category: segmentsAndCutpointsCategory,
      },
      removeSelectedSegments: {
        name: t('Remove selected segments'),
        category: segmentsAndCutpointsCategory,
      },
      mutateSegmentsByExpr: {
        name: t('Edit segments by expression'),
        category: segmentsAndCutpointsCategory,
      },

      // streamsCategory
      toggleStreamsSelector: {
        name: t('Edit tracks / metadata tags'),
        category: streamsCategory,
      },
      extractAllStreams: {
        name: t('Extract all tracks'),
        category: streamsCategory,
      },
      showStreamsSelector: {
        name: t('Edit tracks / metadata tags'),
        category: streamsCategory,
      },
      showIncludeExternalStreamsDialog: {
        name: t('Include more tracks from other file'),
        category: streamsCategory,
      },

      // zoomOperationsCategory
      timelineZoomIn: {
        name: t('Zoom in timeline'),
        category: zoomOperationsCategory,
      },
      timelineZoomOut: {
        name: t('Zoom out timeline'),
        category: zoomOperationsCategory,
      },
      timelineToggleComfortZoom: {
        name: t('Toggle zoom between 1x and a calculated comfortable zoom level'),
        category: zoomOperationsCategory,
      },

      // outputCategory
      export: {
        name: t('Export segment(s)'),
        category: outputCategory,
      },
      // patch: re-cut every selected result, ignoring the incremental-export manifest.
      exportForce: {
        name: t('Force re-export all'),
        category: outputCategory,
      },
      captureSnapshot: {
        name: t('Capture snapshot'),
        category: outputCategory,
      },
      captureSnapshotAsCoverArt: {
        name: t('Set current frame as cover art'),
        category: outputCategory,
      },
      captureSnapshotToClipboard: {
        name: t('Capture snapshot to clipboard'),
        category: outputCategory,
      },
      exportYouTube: {
        name: t('Start times as YouTube Chapters'),
        category: outputCategory,
      },
      extractCurrentSegmentFramesAsImages: {
        name: t('Extract frames from current segment as image files'),
        category: outputCategory,
      },
      extractSelectedSegmentsFramesAsImages: {
        name: t('Extract frames from selected segments as image files'),
        category: outputCategory,
      },
      cleanupFilesDialog: {
        name: t('Delete source file'),
        category: outputCategory,
      },
      convertFormatBatch: {
        name: t('Batch convert files to supported format'),
        category: outputCategory,
      },
      convertFormatCurrentFile: {
        name: t('Convert current file to supported format'),
        category: outputCategory,
      },
      fixInvalidDuration: {
        name: t('Fix incorrect duration'),
        category: outputCategory,
      },
      decimate: {
        name: t('Decimate video'),
        category: outputCategory,
      },

      // batchFilesCategory
      batchPreviousFile: {
        name: t('Previous file'),
        category: batchFilesCategory,
      },
      batchOpenPreviousFile: {
        name: t('Open previous file'),
        category: batchFilesCategory,
      },
      batchNextFile: {
        name: t('Next file'),
        category: batchFilesCategory,
      },
      batchOpenNextFile: {
        name: t('Open next file'),
        category: batchFilesCategory,
      },
      // patch: the same two switches, but the opened source starts playing.
      batchOpenPlayPreviousFile: {
        name: t('Open previous file and play it'),
        category: batchFilesCategory,
      },
      batchOpenPlayNextFile: {
        name: t('Open next file and play it'),
        category: batchFilesCategory,
      },
      batchOpenSelectedFile: {
        name: t('Open selected file'),
        category: batchFilesCategory,
      },
      closeBatch: {
        name: t('Close batch'),
        category: batchFilesCategory,
      },
      concatBatch: {
        name: t('Merge/concatenate files'),
        category: batchFilesCategory,
      },

      // patch: the player window's cut-results playlist.
      // cutResultsCategory
      playlistPrev: {
        name: t('Previous cut result'),
        category: cutResultsCategory,
      },
      playlistNext: {
        name: t('Next cut result'),
        category: cutResultsCategory,
      },
      playlistFirst: {
        name: t('First cut result'),
        category: cutResultsCategory,
      },
      playlistLast: {
        name: t('Last cut result'),
        category: cutResultsCategory,
      },
      renameResultLabel: {
        name: t('Rename the current cut result label'),
        category: cutResultsCategory,
      },
      renameResultFull: {
        name: t('Rename the current cut result file'),
        category: cutResultsCategory,
      },
      mergeCutResults: {
        name: t('Merge the cut results into one file'),
        category: cutResultsCategory,
      },

      // patch: the finish flow (the same dialog as `Shift+E`, reached by name from the console).
      finish: {
        name: t('Finish the job (move or delete the files)'),
        category: finishCategory,
      },
      finishMerge: {
        name: t('Finish with the merged result'),
        category: finishCategory,
      },
      finishCut: {
        name: t('Finish with the cut results'),
        category: finishCategory,
      },
      finishKeepSource: {
        name: t('Skip and move this video (to finished_skip_src)'),
        category: finishCategory,
      },
      discardSource: {
        name: t('Discard the video (move to the waiting-for-deletion folder)'),
        category: finishCategory,
      },

      // patch: `Alt+/` arms the next in point to add a segment (see features/patchCutMark).
      toggleNewSegmentMark: {
        name: t('Next in point starts a new segment'),
        category: segmentsAndCutpointsCategory,
      },

      // otherCategory
      toggleKeyframeCutMode: {
        name: t('Cut mode'),
        category: otherCategory,
      },
      toggleCaptureFormat: {
        name: t('Capture frame format'),
        category: otherCategory,
      },
      toggleStripAudio: {
        name: t('Keep or discard audio tracks'),
        category: otherCategory,
      },
      toggleStripVideo: {
        name: t('Keep or discard video tracks'),
        category: otherCategory,
      },
      toggleStripSubtitle: {
        name: t('Keep or discard subtitle tracks'),
        category: otherCategory,
      },
      toggleStripThumbnail: {
        name: t('Keep or discard thumbnail tracks'),
        category: otherCategory,
      },
      toggleStripAll: {
        name: t('Keep or discard all tracks'),
        category: otherCategory,
      },
      toggleStripCurrentFilter: {
        name: t('Toggle tracks using current filter'),
        category: otherCategory,
      },
      increaseRotation: {
        name: t('Change rotation'),
        category: otherCategory,
      },
      setStartTimeOffset: {
        name: t('Set custom start offset/timecode'),
        category: otherCategory,
      },
      undo: {
        name: t('Undo'),
        category: otherCategory,
      },
      redo: {
        name: t('Redo'),
        category: otherCategory,
      },
      copySegmentsToClipboard: {
        name: t('Copy selected segments times to clipboard'),
        category: otherCategory,
      },
      toggleWaveformMode: {
        name: t('Show waveform'),
        category: otherCategory,
      },
      generateOverviewWaveform: {
        name: t('Load overview'),
        category: otherCategory,
      },
      toggleShowThumbnails: {
        name: t('Show thumbnails'),
        category: otherCategory,
      },
      toggleShowKeyframes: {
        name: t('Show keyframes'),
        category: otherCategory,
      },
      readAllKeyframes: {
        name: t('Read all keyframes'),
        category: otherCategory,
      },
      toggleFullscreenVideo: {
        name: 'Toggle full screen video',
        category: otherCategory,
      },
      toggleSettings: {
        name: t('Settings'),
        category: otherCategory,
      },
      toggleDarkMode: {
        name: t('Toggle dark mode'),
        category: otherCategory,
      },
      openSendReportDialog: {
        name: t('Report an error'),
        category: otherCategory,
      },
      openFilesDialog: {
        name: t('Open'),
        category: otherCategory,
      },
      openDirDialog: {
        name: t('Open folder'),
        category: otherCategory,
      },
      closeCurrentFile: {
        name: t('Close current file'),
        category: otherCategory,
      },
      quit: {
        name: t('Quit LosslessCut'),
        category: otherCategory,
      },
      // patch: patch-mode only, so it does nothing in base mode.
      togglePatchCommandConsole: {
        name: t('Patch command console'),
        category: otherCategory,
      },
      // patch: toggles the app menu bar, which patch mode keeps hidden (see features/patchTransport).
      togglePatchMenuBar: {
        name: t('Show/hide the app menu bar'),
        category: otherCategory,
      },
    };

    // eslint-disable-next-line no-shadow
    const extraLinesPerCategory: Record<Category, ReactNode> = {
      [zoomOperationsCategory]: [
        <div key="1" style={{ ...rowStyle, alignItems: 'center' }}>
          <span>{t('Pan timeline')}</span>
          <div style={{ flexGrow: 1 }} />
          <FaMouse style={{ marginRight: '.3em' }} />
          <span>{t('Mouse scroll/wheel up/down')}</span>
        </div>,

        <WheelModifier key="2" text={t('Seek one frame')} wheelText={t('Mouse scroll/wheel up/down')} modifier={mouseWheelFrameSeekModifierKey} />,

        <WheelModifier key="3" text={t('Seek one key frame')} wheelText={t('Mouse scroll/wheel up/down')} modifier={mouseWheelKeyframeSeekModifierKey} />,

        <WheelModifier key="4" text={t('Zoom in/out timeline')} wheelText={t('Mouse scroll/wheel up/down')} modifier={mouseWheelZoomModifierKey} />,
      ],
      [segmentsAndCutpointsCategory]: [
        <div key="1" style={{ ...rowStyle, alignItems: 'center' }}>
          <span>{t('Manipulate segments on timeline')}</span>
          <div style={{ flexGrow: 1 }} />
          <kbd style={{ marginRight: '.7em' }}>{getModifier(segmentMouseModifierKey)}</kbd>
          <FaMouse style={{ marginRight: '.3em' }} />
          <span>{t('Mouse click and drag')}</span>
        </div>,
      ],
    };

    return {
      extraLinesPerCategory,
      actionsMap,
    };
  }, [currentCutSeg, mouseWheelFrameSeekModifierKey, mouseWheelKeyframeSeekModifierKey, mouseWheelZoomModifierKey, segmentMouseModifierKey, t]);

  useEffect(() => {
    updateKeyboardLayout();
  }, [updateKeyboardLayout]);

  useEffect(() => {
    // cleanup invalid bindings, to prevent renamed actions from blocking user to rebind
    const validBindings = keyBindings.filter(({ action }) => actionsMap[action]);

    if (validBindings.length !== keyBindings.length) {
      console.log(`Auto deleting ${keyBindings.length - validBindings.length} invalid key binding(s)`);
      setKeyBindings(validBindings);
    }
  }, [actionsMap, keyBindings, setKeyBindings]);

  const [creatingBinding, setCreatingBinding] = useState<KeyboardAction>();
  const [searchQuery, setSearchQuery] = useState('');

  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    searchInputRef.current?.focus();
  }, []);

  const searchQueryTrimmed = searchQuery.toLowerCase().trim();
  const isSearching = Boolean(searchQueryTrimmed);

  const actionEntries = useMemo(() => (Object.entries(actionsMap) as unknown as [keyof typeof actionsMap, typeof actionsMap[keyof typeof actionsMap]][]).filter(([key, { name, category }]) => (
    !isSearching
    || key.toLocaleLowerCase().includes(searchQueryTrimmed)
    || name.toLowerCase().includes(searchQueryTrimmed)
    || category?.toLowerCase().includes(searchQueryTrimmed)
  )), [actionsMap, isSearching, searchQueryTrimmed]);

  const categoriesWithActions = useMemo(() => Object.entries(groupBy(actionEntries, ([, { category }]) => category)), [actionEntries]);

  const onDeleteBindingClick = useCallback(async ({ action, keys }: { action: KeyboardAction, keys: string }) => {
    if (!(await confirmDialog({ description: t('Are you sure?') }))) return;

    console.log('Delete key binding', action, keys);
    setKeyBindings((existingBindings) => existingBindings.filter((existingBinding) => !(existingBinding.keys === keys && existingBinding.action === action)));
  }, [confirmDialog, setKeyBindings, t]);

  /**
  Switch a default on or off. Defaults are not deleted (the layout stays visible), so this is the
  only way to stop one from running.

  Switching a patch default off hands its key back to the base default on that key in patch mode -
  the switch says so before it flips, because "off" reads like "dead key" otherwise.
  */
  const onToggleDefaultBinding = useCallback(async (binding: KeyBinding, enabled: boolean) => {
    if (!enabled) {
      const nowActive = analyzeDisableImpact(keyBindings, binding);
      if (nowActive.length > 0) {
        const names = nowActive.map((candidate) => `"${actionsMap[candidate.action]?.name ?? candidate.action}" (${candidate.keys.split('+').join(' + ')})`).join(', ');
        const isConfirmed = await confirmDialog({
          description: t('Switching this key off gives it back to what else is on it: {{nowActive}}. Continue?', { nowActive: names }),
        });
        if (!isConfirmed) return;
      }
    }

    setKeyBindings((existingBindings) => existingBindings.map((existing) => (
      existing.keys === binding.keys && existing.action === binding.action
        ? { ...existing, enabled }
        : existing
    )));
  }, [actionsMap, confirmDialog, keyBindings, setKeyBindings, t]);

  const onResetClick = useCallback(async () => {
    // Double confirmation!
    if (
      !(await confirmDialog({ description: t('Are you sure you want to reset all keyboard bindings?') }))
      || !(await confirmDialog({ description: t('Are you sure you want to reset all keyboard bindings?') }))
    ) return;

    resetKeyBindings();
  }, [confirmDialog, resetKeyBindings, t]);

  const onAddBindingClick = useCallback((action: KeyboardAction) => {
    setCreatingBinding(action);
  }, []);

  const stringifyKeys = (keys: string[]) => keys.join('+');

  const onNewKeyBindingConfirmed = useCallback(async (action: KeyboardAction, keys: string[], scope: KeyBindingScope) => {
    const keysStr = stringifyKeys(keys);
    console.log('New key binding', action, keysStr, scope);

    // Only another key of the user's own can be replaced. A default is never replaced: the scope
    // decides who wins, and a default can only be switched off.
    const duplicate = keyBindings.find((existingBinding) => keyBindingScope(existingBinding) === 'user' && keyCombination(existingBinding.keys) === keyCombination(keysStr) && existingBinding.action !== action);
    let shouldReplaceDuplicate: KeyBinding | undefined;
    if (duplicate) {
      const isConfirmed = await confirmDialog({ confirmButtonText: t('Replace'), description: t('Combination is already bound to "{{alreadyBoundKey}}". Do you want to replace the existing binding?', { alreadyBoundKey: actionsMap[duplicate.action]?.name }) });

      if (isConfirmed) {
        shouldReplaceDuplicate = duplicate;
      } else {
        return;
      }
    }

    setKeyBindings((existingBindings) => {
      console.log('Saving key binding');
      setCreatingBinding(undefined);
      const filtered = !shouldReplaceDuplicate ? existingBindings : existingBindings.filter((existing) => existing !== shouldReplaceDuplicate);
      return [...filtered, { action, keys: keysStr, scope, enabled: true }];
    });
  }, [actionsMap, confirmDialog, keyBindings, setKeyBindings, t]);

  // Which combinations the current mode actually runs: used to mark a stored binding that is
  // switched off, or that loses its key to the other layout.
  const activeCombinations = useMemo(
    () => new Set((displayKeyBindings ?? keyBindings).map((binding) => `${keyCombination(binding.keys)}::${binding.action}`)),
    [displayKeyBindings, keyBindings],
  );

  const scopeLabels = useMemo<Record<KeyBindingScope, string>>(() => ({
    base: t('Base'),
    patch: t('Patch'),
    user: t('Mine'),
  }), [t]);

  // patch: two summaries above the list. The first compares the shipped layouts (static), the
  // second the user's table against them (dynamic).
  const [layoutDifferenceOpen, setLayoutDifferenceOpen] = useState(true);
  const [userChangesOpen, setUserChangesOpen] = useState(true);
  const layoutDifferences = useMemo(() => describeLayoutDifferences(), []);
  const userChanges = useMemo(() => describeUserChanges(keyBindings), [keyBindings]);
  const userChangesCount = userChanges.added.length + userChanges.disabled.length + userChanges.missing.length;
  const actionLabel = useCallback((action: KeyboardAction) => actionsMap[action]?.name ?? action, [actionsMap]);

  return (
    <>
      <div style={{ marginBottom: '1em' }}>
        {/* patch: the shipped layouts side by side, on the keys where they disagree. Static data,
            so it stays true no matter what the user does to their own table. */}
        {patchMode && (
          <details
            open={layoutDifferenceOpen}
            onToggle={(event) => setLayoutDifferenceOpen(event.currentTarget.open)}
            style={{ marginBottom: '.8em', fontSize: '.9em' }}
          >
            <summary style={{ cursor: 'pointer', fontSize: '1.15em' }}>
              {t('Where patch mode differs from the base keys ({{count}})', { count: layoutDifferences.length })}
            </summary>
            <div style={{ opacity: 0.75, margin: '.3em 0 .5em' }}>
              {t('The left side is what the key does in base mode, the right side what it does in patch mode. Click a row to show that action in the list below.')}
            </div>
            {layoutDifferences.map(({ keys, baseAction, patchAction }) => (
              <div
                key={keys}
                role="button"
                tabIndex={0}
                onClick={() => setSearchQuery(patchAction ?? baseAction ?? '')}
                onKeyDown={(event) => { if (event.key === 'Enter') setSearchQuery(patchAction ?? baseAction ?? ''); }}
                style={{ ...rowStyle, gap: '.5em', cursor: 'pointer' }}
              >
                <span style={{ minWidth: '9em' }}>{renderKeys(splitKeyboardKeys(keys))}</span>
                <span style={{ opacity: baseAction == null ? 0.45 : 0.8 }}>{baseAction == null ? t('Unbound') : actionLabel(baseAction)}</span>
                <span style={{ opacity: 0.4 }}>→</span>
                <span style={{ opacity: patchAction == null ? 0.45 : 1 }}>{patchAction == null ? t('Unbound') : actionLabel(patchAction)}</span>
              </div>
            ))}
          </details>
        )}

        {/* patch: the user's table against the defaults. Rendered even when empty, so the block is
            discoverable instead of appearing only after the first change. */}
        <details
          open={userChangesOpen}
          onToggle={(event) => setUserChangesOpen(event.currentTarget.open)}
          style={{ marginBottom: '1em', fontSize: '.9em' }}
        >
          <summary style={{ cursor: 'pointer', fontSize: '1.15em' }}>
            {hasUserChanges(userChanges)
              ? t('Your keys: {{count}} difference(s) from the defaults', { count: userChangesCount })
              : t('Your keys: unchanged from the defaults')}
          </summary>

          {!hasUserChanges(userChanges) && (
            <div style={{ opacity: 0.75, marginTop: '.3em' }}>
              {t('Everything is at its default. Keys you add, defaults you switch off and defaults the table has lost are listed here.')}
            </div>
          )}

          {([
            { id: 'added', label: t('Added'), bindings: userChanges.added },
            { id: 'disabled', label: t('Switched off'), bindings: userChanges.disabled },
            { id: 'missing', label: t('Missing'), bindings: userChanges.missing },
          ] as const).filter((group) => group.bindings.length > 0).map((group) => (
            <div key={group.id} style={{ marginTop: '.5em' }}>
              <div style={{ opacity: 0.75 }}>{group.label}</div>
              {group.bindings.map((binding) => (
                <div
                  key={`${group.id}-${binding.keys}-${binding.action}`}
                  role="button"
                  tabIndex={0}
                  onClick={() => setSearchQuery(binding.action)}
                  onKeyDown={(event) => { if (event.key === 'Enter') setSearchQuery(binding.action); }}
                  style={{ ...rowStyle, gap: '.5em', cursor: 'pointer' }}
                >
                  <span>{renderKeys(splitKeyboardKeys(binding.keys))}</span>
                  <span style={{ opacity: 0.8 }}>{actionLabel(binding.action)}</span>
                  <span style={{ marginLeft: 'auto', fontSize: '.8em', opacity: 0.6 }}>{scopeLabels[keyBindingScope(binding)]}</span>
                </div>
              ))}
            </div>
          ))}
        </details>

        <div style={{ marginBottom: '1em' }}>
          <TextInput ref={searchInputRef} value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Search" style={{ width: '100%', padding: '.4em .8em', boxSizing: 'border-box' }} />
        </div>

        {categoriesWithActions.map(([category, actionsInCategory]) => (
          <div key={category}>
            {category !== 'undefined' && <div style={{ marginTop: '2em', marginBottom: '.7em', fontSize: '1.4em' }}>{category}</div>}

            {actionsInCategory.map(([action, actionObj]) => {
              const actionName = (actionObj && actionObj.name) || action;
              const beforeContent = actionObj && actionObj.before;

              // patch: every stored binding of the action is shown, so a switched-off default or one
              // that loses its key to the other layout stays visible and explains itself. `Base` /
              // `Patch` / `Mine` says where the row came from; only a `Mine` row can be deleted.
              const shownBindings = keyBindings.filter((keyBinding) => keyBinding.action === action);

              return (
                <div key={action} style={rowStyle}>
                  <div>
                    {beforeContent}
                    <span title={action} style={{ marginRight: '.5em', opacity: 0.9 }}>{actionName}</span>
                    {isPatchModeOnlyAction(action) && (
                      <span
                        title={t('This action only runs in patch mode.')}
                        style={{ marginRight: '.5em', fontSize: '.72em', padding: '0 .35em', border: '1px solid var(--gray-7)', borderRadius: '.3em', opacity: 0.8, whiteSpace: 'nowrap' }}
                      >
                        {t('Patch only')}
                      </span>
                    )}
                    <div style={{ fontSize: '.8em', opacity: 0.3 }} title={t('API action name: {{action}}', { action })}>{action} <Button onClick={() => onTriggerActionClick(action)}><FaHammer /></Button></div>
                  </div>

                  <div style={{ flexGrow: 1 }} />

                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                    {shownBindings.map((binding) => {
                      const scope = keyBindingScope(binding);
                      const enabled = isKeyBindingEnabled(binding);
                      const isActive = enabled && activeCombinations.has(`${keyCombination(binding.keys)}::${binding.action}`);
                      const isUserBinding = scope === 'user';
                      const scopeLabel = scopeLabels[scope];
                      const inactiveLabel = t(enabled ? 'Not used in this window' : 'Off');
                      const inactiveColor = enabled ? 'var(--gray-11)' : undefined;

                      return (
                        <div key={`${binding.keys}-${scope}`} style={{ display: 'flex', alignItems: 'center', opacity: isActive ? 1 : 0.45 }}>
                          {renderKeys(splitKeyboardKeys(binding.keys))}

                          <span style={{ marginLeft: '.7em', fontSize: '.75em', opacity: 0.75 }}>{scopeLabel}</span>

                          {!isActive && (
                            <span style={{ marginLeft: '.5em', fontSize: '.75em', opacity: 0.9, color: inactiveColor }}>{inactiveLabel}</span>
                          )}

                          {isUserBinding
                            ? <Button title={t('Remove key binding')} onClick={() => onDeleteBindingClick({ action: binding.action, keys: binding.keys })} style={{ marginLeft: '.9em' }}><FaTrash style={{ fontSize: '.8em', verticalAlign: 'middle' }} /></Button>
                            : (
                              <span style={{ marginLeft: '.9em' }} title={t('A default key cannot be deleted, only switched off.')}>
                                <Switch checked={enabled} onCheckedChange={(checked) => { onToggleDefaultBinding(binding, checked).catch((err: unknown) => { console.error('Failed to toggle the default key', err); }); }} />
                              </span>
                            )}
                        </div>
                      );
                    })}

                    {shownBindings.length === 0 && <span style={{ opacity: 0.8, fontSize: '.8em' }}>{t('No binding')}</span>}
                  </div>

                  <Button title={t('Bind new key to action')} onClick={() => onAddBindingClick(action)} style={{ marginLeft: '.5em' }}><FaPlus style={{ fontSize: '.8em', verticalAlign: 'middle' }} /></Button>
                </div>
              );
            })}

            {extraLinesPerCategory[category] && <div style={{ marginTop: '.8em' }}>{extraLinesPerCategory[category]}</div>}
          </div>
        ))}
      </div>

      {!isSearching && <Button onClick={onResetClick} style={{ marginBottom: '1em' }}><FaUndo style={{ marginRight: '.3em', verticalAlign: 'middle', padding: '.5em' }} />{t('Reset')}</Button>}

      <CreateBinding actionsMap={actionsMap} action={creatingBinding} keyBindings={keyBindings} setCreatingBinding={setCreatingBinding} onNewKeyBindingConfirmed={onNewKeyBindingConfirmed} />
    </>
  );
});

function KeyboardShortcutsDialog({
  isShown, onHide, keyBindings, displayKeyBindings, setKeyBindings, resetKeyBindings, currentCutSeg, getKeyboardAction, patchMode,
}: {
  isShown: boolean,
  onHide: () => void,
  keyBindings: KeyBinding[],
  /** Patch mode's remapped keys, shown in the list; editing still happens on `keyBindings`. */
  displayKeyBindings?: KeyBinding[] | undefined,
  setKeyBindings: Dispatch<SetStateAction<KeyBinding[]>>,
  resetKeyBindings: () => void,
  currentCutSeg: StateSegment | undefined,
  getKeyboardAction: (action: KeyboardAction) => () => void,
  /** Patch mode re-purposes two transport bindings, which this dialog should explain. */
  patchMode?: boolean,
}) {
  const { t } = useTranslation();

  const handleTriggerActionClick = useCallback((action: KeyboardAction) => {
    onHide();
    getKeyboardAction(action)();
  }, [getKeyboardAction, onHide]);


  return (
    <Dialog.Root open={isShown} onOpenChange={(v) => !v && onHide()}>
      <Dialog.Portal>
        <Dialog.Overlay />
        <Dialog.Content style={{ width: '40em' }} aria-describedby={undefined}>
          <Dialog.Title>{t('Keyboard & mouse shortcuts')}</Dialog.Title>

          {/* patch: the scope model. Base and patch layouts coexist; patch mode runs its own on top,
              and a default can only be switched off, not deleted. */}
          {patchMode && (
            <div style={{ marginBottom: '.5em', color: 'var(--gray-11)' }}>
              <div>{t('Base mode runs the official LosslessCut keys untouched, and the keys patch mode adds belong to patch mode. Patch mode adds its own keys on top: where both use a key, patch mode wins, and every other key works in both modes. Keys you add yourself work in both modes; a key bound to a patch-only action explains that in base mode instead of running.')}</div>
              <div>{t('Every default key is always listed. A default can only be switched off, not deleted; a key you add yourself is listed as "Mine" and can be deleted.')}</div>
              <div>{t('Switching a default off gives its key back to whatever else is on it - a patch key that loses to it, or the base key it was hiding - so read the confirmation before you switch it.')}</div>
              <div>{t('Patch mode adds keys and re-purposes a few: the arrows step keyframes, Alt+arrows seek a second, Up/Down mark the cut, Space keeps the playback speed (K resets it), Shift+Right stops before the segment end, E exports/merges, Shift+E finishes, X/Z/C slow down/reset/speed up the playback, Alt+Z toggles the comfort zoom and F/D step one frame.')}</div>
              <div>
                <Trans>Patch mode keeps the app menu bar hidden, so a bare Alt cannot take the focus away from the cutting keys; <ActionKeys keyBindings={displayKeyBindings ?? keyBindings} action="togglePatchMenuBar" /> shows or hides it. The preview volume is <ActionKeys keyBindings={displayKeyBindings ?? keyBindings} action="toggleMuted" /> (mute), <ActionKeys keyBindings={displayKeyBindings ?? keyBindings} action="decreaseVolume" /> and <ActionKeys keyBindings={displayKeyBindings ?? keyBindings} action="increaseVolume" />.</Trans>
              </div>
              <div>
                <Trans>Scrolling the mouse wheel over the video changes the preview volume (up louder, down quieter); Ctrl, Alt and Shift with the wheel keep their zoom, frame-seek and keyframe-seek actions.</Trans>
              </div>
              <div><Trans>Ctrl+E captures a snapshot; Ctrl+Delete discards the video: it moves it to the waiting-for-deletion folder and opens the next one. <ActionKeys keyBindings={displayKeyBindings ?? keyBindings} action="finishKeepSource" /> finishes the job with the source moving to finished_skip_src instead.</Trans></div>
            </div>
          )}

          <KeyboardShortcuts keyBindings={keyBindings} displayKeyBindings={displayKeyBindings} setKeyBindings={setKeyBindings} currentCutSeg={currentCutSeg} resetKeyBindings={resetKeyBindings} onTriggerActionClick={handleTriggerActionClick} patchMode={patchMode} />

          <Dialog.CloseButton />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export default memo(KeyboardShortcutsDialog);
