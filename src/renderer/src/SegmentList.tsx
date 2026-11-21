import type { SetStateAction, Dispatch, MouseEventHandler, CSSProperties, ReactNode, PointerEvent as ReactPointerEvent } from 'react';
import { memo, useMemo, useRef, useCallback, useState, useEffect } from 'react';
import type { MenuItemConstructorOptions } from 'electron';
import { FaYinYang, FaSave, FaPlus, FaMinus, FaTag, FaSortNumericDown, FaRegCheckCircle, FaRegCircle, FaTimes } from 'react-icons/fa';
import { AiOutlineSplitCells } from 'react-icons/ai';
import { motion } from 'motion/react';
import { useTranslation, Trans } from 'react-i18next';
import type { DragEndEvent, DragStartEvent, UniqueIdentifier } from '@dnd-kit/core';
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, DragOverlay } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, arrayMove, useSortable } from '@dnd-kit/sortable';
import { restrictToVerticalAxis } from '@dnd-kit/modifiers';
import { useVirtualizer } from '@tanstack/react-virtual';
import { CSS } from '@dnd-kit/utilities';
import invariant from 'tiny-invariant';
import prettyBytes from 'pretty-bytes';

import useContextMenu from './hooks/useContextMenu';
import useUserSettings from './hooks/useUserSettings';
import useActionTitle from './hooks/useActionTitle';
import { saveColor, controlsBackground, primaryTextColor, primaryColor, darkModeTransition } from './colors';
import { useSegColors } from './contexts';
import { getSegmentTags } from './segments';
import TagEditor, { cancelTagEditOnEscape } from './components/TagEditor';
import type { ContextMenuTemplate, DefiniteSegmentBase, FormatTimecode, GetFrameCount, InverseCutSegment, SegmentBase, SegmentColorIndex, SegmentTags, StateSegment } from './types';
import type { UseSegments } from './hooks/useSegments';
import * as Dialog from './components/Dialog';
import { DialogButton } from './components/Button';
import getSwal from './swal';


const buttonBaseStyle: CSSProperties = {
  margin: '0 3px', borderRadius: 3, color: 'white', cursor: 'pointer', userSelect: 'none',
};

const disabledButtonStyle = { color: 'var(--gray-10)', backgroundColor: 'var(--gray-6)' };
const neutralButtonColor = 'var(--gray-9)';

// patch: the numbers the patch queue shows in front of a segment: its rank by start time and its
// position in the queue (see features/patchSegmentQueue). The type is declared here so this file
// does not have to know where the numbers are computed.
interface PatchSegmentNumber { startRank: number, queueRank?: number | undefined }

// eslint-disable-next-line react/display-name
const Segment = memo(({
  seg,
  index,
  isActive,
  dragging,
  formatTimecode,
  getFrameCount,
  updateSegOrder,
  onClick,
  onRemovePress,
  onRemoveSelected,
  onLabelSelectedSegments,
  onReorderPress,
  onLabelPress,
  selected,
  onSelectSingleSegment,
  onToggleSegmentSelected,
  onDeselectAllSegments,
  onSelectSegmentsByLabel,
  onSelectSegmentsByExpr,
  onSelectAllMarkers,
  onSelectAllSegments,
  onMutateSegmentsByExpr,
  jumpSegStart,
  jumpSegEnd,
  addSegment,
  onEditSegmentTags,
  onExtractSegmentsFramesAsImages,
  onExtractSelectedSegmentsFramesAsImages,
  onInvertSelectedSegments,
  onDuplicateSegmentClick,
  getSegEstimatedSize,
  // patch: the queue numbers (see features/patchSegmentQueue)
  patchMode,
  patchNumber,
  // patch: the merged window shows the same list, but its chapters are read-only (see below).
  readOnly,
  // patch: extra context-menu entries from the fork (undefined in base mode).
  patchExtraMenuItems,
  // patch: the queue's Shift+click multi-selection (see features/patchSegmentQueue). A click is
  // offered to it first; returning true means the click belongs to the selection.
  patchRowClick,
  patchMultiSelect,
  patchMultiSelected,
}: {
  seg: StateSegment | InverseCutSegment,
  index: number,
  isActive?: boolean | undefined,
  dragging?: boolean | undefined,
  formatTimecode: FormatTimecode,
  getFrameCount: GetFrameCount,
  updateSegOrder: UseSegments['updateSegOrder'],
  onClick: (i: number) => void,
  onRemovePress: UseSegments['removeSegment'],
  onRemoveSelected: UseSegments['removeSelectedSegments'],
  onLabelSelectedSegments: UseSegments['labelSelectedSegments'],
  onReorderPress: (i: number) => Promise<void>,
  onLabelPress: UseSegments['labelSegment'],
  selected: boolean | undefined,
  onSelectSingleSegment: UseSegments['selectOnlySegment'],
  onToggleSegmentSelected: UseSegments['toggleSegmentSelected'],
  onDeselectAllSegments: UseSegments['deselectAllSegments'],
  onSelectSegmentsByLabel: UseSegments['selectSegmentsByLabel'],
  onSelectSegmentsByExpr: UseSegments['selectSegmentsByExpr'],
  onSelectAllMarkers: UseSegments['selectAllMarkers'],
  onSelectAllSegments: UseSegments['selectAllSegments'],
  onMutateSegmentsByExpr: UseSegments['mutateSegmentsByExpr'],
  jumpSegStart: (i: number) => void,
  jumpSegEnd: (i: number) => void,
  addSegment: UseSegments['addSegment'],
  onEditSegmentTags: (i: number) => void,
  onExtractSegmentsFramesAsImages: (segments: Pick<SegmentBase, 'start' | 'end'>[]) => Promise<void>,
  onExtractSelectedSegmentsFramesAsImages: () => void,
  onInvertSelectedSegments: UseSegments['invertSelectedSegments'],
  onDuplicateSegmentClick: UseSegments['duplicateSegment'],
  getSegEstimatedSize: UseSegments['getSegEstimatedSize'],
  // patch: the queue numbers (see features/patchSegmentQueue)
  patchMode?: boolean | undefined,
  patchNumber?: PatchSegmentNumber | undefined,
  // patch: the merged window shows the same list, but its chapters are read-only: selection and
  // seeking stay, while dragging, the context menu and every edit entry point are off.
  readOnly?: boolean | undefined,
  /** patch: extra context-menu entries from the fork (undefined in base mode, which keeps the menu as-is). */
  patchExtraMenuItems?: MenuItemConstructorOptions[] | undefined,
  /** patch: Shift+click multi-selection - handled before the row's own "make current" behaviour. */
  patchRowClick?: ((segId: string, shiftKey: boolean) => boolean) | undefined,
  /** patch: this queue has the Shift+click multi-selection, so Shift+press belongs to it, not to drag/seek. */
  patchMultiSelect?: boolean | undefined,
  /** patch: this row is part of the queue's temporary multi-selection. */
  patchMultiSelected?: boolean | undefined,
}) => {
  const { invertCutSegments, darkMode } = useUserSettings();
  const { t } = useTranslation();
  const { getSegColor } = useSegColors();

  const ref = useRef<HTMLDivElement | null>(null);

  const contextMenuTemplate = useMemo<ContextMenuTemplate>(() => {
    if (invertCutSegments) return [];

    const updateOrder = (dir: number) => updateSegOrder(index, index + dir);

    // patch: the fork's own entries (the work folders) go first, then a separator.
    const patchMenuPrefix = patchExtraMenuItems != null && patchExtraMenuItems.length > 0
      ? [...patchExtraMenuItems, { type: 'separator' as const }]
      : [];

    // patch: the merged window's chapters can never be modified, but they can still be *selected*
    // and jumped around. Its context menu therefore keeps the read-only and the selection entries
    // and drops every entry that would rewrite the chapter list.
    if (readOnly) {
      return [
        ...patchMenuPrefix,
        { label: t('Jump to start time'), click: () => jumpSegStart(index) },
        { label: t('Jump to end time'), click: () => jumpSegEnd(index) },

        { type: 'separator' },

        { label: t('Select only this segment'), click: () => onSelectSingleSegment(seg) },
        { label: t('Select all segments'), click: () => onSelectAllSegments() },
        { label: t('Deselect all segments'), click: () => onDeselectAllSegments() },
        { label: t('Select all markers'), click: () => onSelectAllMarkers() },
        { label: t('Select segments by label'), click: () => onSelectSegmentsByLabel() },
        { label: t('Select segments by expression'), click: () => onSelectSegmentsByExpr() },
        { label: t('Invert selected segments'), click: () => onInvertSelectedSegments() },

        { type: 'separator' },

        { label: t('Extract frames from selected segments as image files'), click: onExtractSelectedSegmentsFramesAsImages },
        { label: t('Extract segment frames as image files'), click: () => onExtractSegmentsFramesAsImages([seg]) },
      ];
    }

    return [
      ...patchMenuPrefix,
      { label: t('Jump to start time'), click: () => jumpSegStart(index) },
      { label: t('Jump to end time'), click: () => jumpSegEnd(index) },

      { type: 'separator' },

      { label: t('Add segment'), click: addSegment },
      { label: t('Label segment'), click: () => onLabelPress(index) },
      { label: t('Remove segment'), click: () => onRemovePress(index) },
      // patch: the queue puts the copy right after the segment it was copied from.
      { label: t('Duplicate segment'), click: () => onDuplicateSegmentClick(seg, patchMode ? { insertAfter: true } : undefined) },

      { type: 'separator' },

      { label: t('Select only this segment'), click: () => onSelectSingleSegment(seg) },
      { label: t('Select all segments'), click: () => onSelectAllSegments() },
      { label: t('Deselect all segments'), click: () => onDeselectAllSegments() },
      { label: t('Select all markers'), click: () => onSelectAllMarkers() },
      { label: t('Select segments by label'), click: () => onSelectSegmentsByLabel() },
      { label: t('Select segments by expression'), click: () => onSelectSegmentsByExpr() },
      { label: t('Invert selected segments'), click: () => onInvertSelectedSegments() },

      { type: 'separator' },

      { label: t('Label selected segments'), click: onLabelSelectedSegments },
      { label: t('Edit segments by expression'), click: () => onMutateSegmentsByExpr() },
      { label: t('Extract frames from selected segments as image files'), click: onExtractSelectedSegmentsFramesAsImages },
      { label: t('Remove selected segments'), click: onRemoveSelected },

      { type: 'separator' },

      { label: t('Change segment order'), click: () => onReorderPress(index) },
      { label: t('Increase segment order'), click: () => updateOrder(1) },
      { label: t('Decrease segment order'), click: () => updateOrder(-1) },

      { type: 'separator' },

      { label: t('Segment tags'), click: () => onEditSegmentTags(index) },
      { label: t('Extract segment frames as image files'), click: () => onExtractSegmentsFramesAsImages([seg]) },
    ];
  }, [invertCutSegments, t, addSegment, onLabelSelectedSegments, onRemoveSelected, onExtractSelectedSegmentsFramesAsImages, updateSegOrder, index, jumpSegStart, jumpSegEnd, onLabelPress, onRemovePress, onDuplicateSegmentClick, seg, patchMode, patchExtraMenuItems, readOnly, onSelectSingleSegment, onSelectAllSegments, onDeselectAllSegments, onSelectAllMarkers, onSelectSegmentsByLabel, onSelectSegmentsByExpr, onInvertSelectedSegments, onMutateSegmentsByExpr, onReorderPress, onEditSegmentTags, onExtractSegmentsFramesAsImages]);

  // patch: the read-only menu is already filtered down to selection / seeking, so it stays enabled.
  // Patch mode also cancels the default, so the main process does not pop its own menu over this
  // one (see `useContextMenu`); base mode keeps the upstream call.
  useContextMenu(ref, contextMenuTemplate, true, patchMode);

  const duration = useMemo(() => (seg.end == null ? undefined : seg.end - seg.start), [seg]);
  const estimatedSize = useMemo(() => getSegEstimatedSize(seg), [getSegEstimatedSize, seg]);

  const timeStr = useMemo(() => (
    seg.end == null
      ? formatTimecode({ seconds: seg.start })
      : `${formatTimecode({ seconds: seg.start })} - ${formatTimecode({ seconds: seg.end })}`
  ), [formatTimecode, seg]);

  function renderNumber() {
    if (invertCutSegments || !('segColorIndex' in seg)) {
      return <FaSave style={{ color: saveColor, marginRight: '.2em', verticalAlign: 'middle' }} size={14} />;
    }

    const segColor = getSegColor(seg);

    const color = segColor.desaturate(0.25).lightness(darkMode ? 35 : 55);
    const borderColor = darkMode ? color.lighten(0.5) : color.darken(0.3);

    // patch: the queue shows two numbers: the segment's rank by start time (colored, it does not
    // change when the queue is reordered) and its position in the queue (plain, it follows the
    // list). A marker has no number at all.
    if (patchMode) {
      // A loaded list can be rendered before its numbers arrive (the merged window reloads its file
      // and its entry for a moment): show the row position instead of no number at all. A marker
      // (no end) is never exported, so it still has no number.
      if (patchNumber == null) {
        if (seg.end == null) return null;
        return (
          <b style={{ color: 'white', padding: '0 .3em', marginRight: '.3em', marginLeft: '-.23em', background: color.string(), border: `.05em solid ${isActive ? borderColor.string() : 'transparent'}`, borderRadius: '.35em', fontSize: '.7em' }}>
            {index + 1}
          </b>
        );
      }

      return (
        <>
          <b style={{ color: 'white', padding: '0 .3em', marginRight: '.2em', marginLeft: '-.23em', background: color.string(), border: `.05em solid ${isActive ? borderColor.string() : 'transparent'}`, borderRadius: '.35em', fontSize: '.7em' }}>
            {patchNumber.startRank}
          </b>
          {patchNumber.queueRank != null && (
            <b style={{ color: 'var(--gray-12)', padding: '0 .3em', marginRight: '.3em', background: 'transparent', border: '.05em solid var(--gray-7)', borderRadius: '.35em', fontSize: '.7em' }}>
              {patchNumber.queueRank}
            </b>
          )}
        </>
      );
    }

    return (
      <b style={{ color: 'white', padding: '0 .3em', marginRight: '.3em', marginLeft: '-.23em', background: color.string(), border: `.05em solid ${isActive ? borderColor.string() : 'transparent'}`, borderRadius: '.35em', fontSize: '.7em' }}>
        {index + 1}
      </b>
    );
  }

  const onDoubleClick = useCallback((e: React.MouseEvent) => {
    // patch: where the queue has a Shift+click multi-selection, a Shift+click is a selection click,
    // so two of them in a row must not also jump the playhead to the segment start (see
    // features/patchSegmentQueue). Everywhere else - base mode, the merged window's read-only
    // chapters - Shift+click has no other meaning and keeps its jump.
    if ((e.shiftKey && patchMultiSelect === true) || invertCutSegments) return;
    jumpSegStart(index);
  }, [index, invertCutSegments, jumpSegStart, patchMultiSelect]);

  const CheckIcon = selected ? FaRegCheckCircle : FaRegCircle;

  const onToggleSegmentSelectedClick = useCallback<MouseEventHandler>((e) => {
    e.stopPropagation();
    onToggleSegmentSelected(seg);
  }, [onToggleSegmentSelected, seg]);

  const cursor = invertCutSegments || readOnly ? undefined : (dragging ? 'grabbing' : 'grab');

  const tags = useMemo(() => getSegmentTags('tags' in seg ? seg : {}), [seg]);

  const handleSegmentClick = useCallback<MouseEventHandler<HTMLDivElement>>((e) => {
    e.currentTarget.blur();
    // patch: the queue's Shift+click multi-selection sees the click first (features/patchSegmentQueue).
    if (patchRowClick?.(seg.segId, e.shiftKey) === true) return;
    if (!invertCutSegments) onClick(index);
  }, [index, invertCutSegments, onClick, patchRowClick, seg]);

  const handleDraggableClick = useCallback<MouseEventHandler<HTMLDivElement>>((e) => {
    e.currentTarget.blur();
  }, []);

  const sortable = useSortable({
    id: seg.segId,
    transition: {
      duration: 150,
      easing: 'ease-in-out',
    },
    disabled: invertCutSegments || readOnly === true,
  });

  const style = useMemo<CSSProperties>(() => {
    const transitions = [
      ...(sortable.transition ? [sortable.transition] : []),
      'opacity 100ms ease-out',
    ];
    return {
      visibility: sortable.isDragging ? 'hidden' : undefined,
      padding: '3px 5px',
      margin: '1px 0',
      boxSizing: 'border-box',
      originY: 0,
      position: 'relative',
      transform: CSS.Transform.toString(sortable.transform),
      transition: transitions.length > 0 ? transitions.join(', ') : undefined,
      background: 'var(--gray-1)',
      border: `1px solid ${isActive ? 'var(--gray-10)' : 'transparent'}`,
      // patch: the multi-selection gets its own marker. The export selection is the dimmed opacity
      // below, so the two states never look the same (see features/patchSegmentQueue).
      outline: patchMultiSelected ? `.12em solid ${primaryColor}` : undefined,
      outlineOffset: patchMultiSelected ? '-.12em' : undefined,
      borderRadius: 5,
      opacity: !selected && !invertCutSegments ? 0.5 : undefined,
    };
  }, [invertCutSegments, isActive, patchMultiSelected, selected, sortable.isDragging, sortable.transform, sortable.transition]);

  const setRef = useCallback((node: HTMLDivElement | null) => {
    sortable.setNodeRef(node);
    ref.current = node;
  }, [sortable]);

  // patch: while Shift is held a press on the row is the start of a multi-selection click, never a
  // drag: otherwise a few pixels of hand movement would reorder the queue instead of extending the
  // selection (see features/patchSegmentQueue). Only the press listener is wrapped; the sortable
  // set-up both modes share stays untouched.
  const dragListeners = useMemo(() => {
    const listeners = sortable.listeners as Record<string, ((event: ReactPointerEvent) => void) | undefined> | undefined;
    const onPointerDown = listeners?.['onPointerDown'];
    if (!patchMultiSelect || listeners == null || onPointerDown == null) return listeners;
    return {
      ...listeners,
      onPointerDown: (event: ReactPointerEvent) => {
        if (event.shiftKey) return;
        onPointerDown(event);
      },
    };
  }, [patchMultiSelect, sortable.listeners]);

  return (
    <div
      ref={setRef}
      role="button"
      onClick={handleSegmentClick}
      onDoubleClick={onDoubleClick}
      style={style}
      className="segment-list-entry"
    >
      <div
        {...sortable.attributes}
        {...dragListeners}
        role="button"
        tabIndex={-1}
        style={{ cursor, color: 'var(--gray-12)', marginBottom: duration != null ? '.1em' : undefined, display: 'flex', alignItems: 'center', height: '1em' }}
        onClick={handleDraggableClick}
      >
        {renderNumber()}
        <span style={{ cursor, fontSize: `${Math.min(1, 26 / timeStr.length) * 0.75}em`, whiteSpace: 'nowrap' }}>{timeStr}</span>
      </div>

      {'name' in seg && seg.name && <span style={{ fontSize: '.75em', color: primaryTextColor, marginRight: '.3em' }}>{seg.name}</span>}
      {Object.entries(tags).map(([name, value]) => (
        <span style={{ fontSize: '.7em', backgroundColor: 'var(--gray-5)', color: 'var(--gray-12)', borderRadius: '.4em', padding: '0 .2em', marginRight: '.1em' }} key={name}>{name}:<b>{value}</b></span>
      ))}

      {duration != null && (
        <>
          <div style={{ fontSize: '.75em' }}>
            {t('Duration')} {formatTimecode({ seconds: duration, shorten: true })}
          </div>
          <div style={{ fontSize: '.75em' }}>
            <Trans>{{ durationMsFormatted: Math.floor(duration * 1000) }} ms</Trans>
            <span>, <Trans>{{ frameCount: (duration && getFrameCount(duration)) ?? '?' }} frames</Trans></span>
            {estimatedSize != null && (
              <span style={{ fontSize: '.9em' }}>
                , ~{prettyBytes(estimatedSize, { space: false, maximumFractionDigits: 1, minimumFractionDigits: 0 })}
              </span>
            )}

          </div>
        </>
      )}

      {!invertCutSegments && selected != null && (
        <div style={{ position: 'absolute', right: 3, bottom: 3 }}>
          <CheckIcon className="selected" size={20} color="var(--gray-12)" onClick={onToggleSegmentSelectedClick} />
        </div>
      )}
    </div>
  );
});

function SegmentList({
  width,
  formatTimecode,
  cutSegments,
  inverseCutSegments,
  getFrameCount,
  onSegClick,
  currentSegIndex,
  updateSegOrder,
  updateSegOrders,
  addSegment,
  removeSegment,
  onRemoveSelected,
  onLabelSegment,
  currentCutSeg,
  firstSegmentAtCursor,
  toggleSegmentsList,
  splitCurrentSegment,
  selectedSegments,
  onSelectSingleSegment,
  onToggleSegmentSelected,
  onDeselectAllSegments,
  onSelectAllSegments,
  onSelectSegmentsByLabel,
  onSelectSegmentsByExpr,
  onMutateSegmentsByExpr,
  onSelectAllMarkers,
  onExtractSegmentsFramesAsImages,
  onExtractSelectedSegmentsFramesAsImages,
  onLabelSelectedSegments,
  onInvertSelectedSegments,
  onDuplicateSegmentClick,
  jumpSegStart,
  jumpSegEnd,
  updateSegAtIndex,
  editingSegmentTags,
  editingSegmentTagsSegmentIndex,
  setEditingSegmentTags,
  setEditingSegmentTagsSegmentIndex,
  onEditSegmentTags,
  getSegEstimatedSize,
  // patch: the queue numbers and the queue's own help (see features/patchSegmentQueue)
  patchMode,
  patchNumbers,
  patchHelp,
  patchLeadRow,
  patchLeadActive,
  // patch: the merged window shows the same list, but its chapters are read-only (see above).
  readOnly,
  // patch: extra context-menu entries from the fork (undefined in base mode).
  patchExtraMenuItems,
  // patch: the queue's Shift+click multi-selection (see features/patchSegmentQueue).
  patchRowClick,
  patchMultiSelect,
  patchMultiSelectedIds,
  patchSelectionBar,
}: {
  width: number,
  formatTimecode: FormatTimecode,
  cutSegments: StateSegment[],
  inverseCutSegments: InverseCutSegment[],
  getFrameCount: GetFrameCount,
  onSegClick: (index: number) => void,
  currentSegIndex: number,
  updateSegOrder: UseSegments['updateSegOrder'],
  updateSegOrders: UseSegments['updateSegOrders'],
  addSegment: UseSegments['addSegment'],
  removeSegment: UseSegments['removeSegment'],
  onRemoveSelected: UseSegments['removeSelectedSegments'],
  onLabelSegment: UseSegments['labelSegment'],
  currentCutSeg: UseSegments['currentCutSeg'],
  firstSegmentAtCursor: StateSegment | undefined,
  toggleSegmentsList: () => void,
  splitCurrentSegment: UseSegments['splitCurrentSegment'],
  selectedSegments: DefiniteSegmentBase[],
  onSelectSingleSegment: UseSegments['selectOnlySegment'],
  onToggleSegmentSelected: UseSegments['toggleSegmentSelected'],
  onDeselectAllSegments: UseSegments['deselectAllSegments'],
  onSelectAllSegments: UseSegments['selectAllSegments'],
  onSelectSegmentsByLabel: UseSegments['selectSegmentsByLabel'],
  onSelectSegmentsByExpr: UseSegments['selectSegmentsByExpr'],
  onSelectAllMarkers: UseSegments['selectAllMarkers'],
  onMutateSegmentsByExpr: UseSegments['mutateSegmentsByExpr'],
  onExtractSegmentsFramesAsImages: (segments: Pick<SegmentBase, 'start' | 'end'>[]) => Promise<void>,
  onExtractSelectedSegmentsFramesAsImages: () => void,
  onLabelSelectedSegments: UseSegments['labelSelectedSegments'],
  onInvertSelectedSegments: UseSegments['invertSelectedSegments'],
  onDuplicateSegmentClick: UseSegments['duplicateSegment'],
  jumpSegStart: (index: number) => void,
  jumpSegEnd: (index: number) => void,
  updateSegAtIndex: UseSegments['updateSegAtIndex'],
  editingSegmentTags: SegmentTags | undefined,
  editingSegmentTagsSegmentIndex: number | undefined,
  setEditingSegmentTags: Dispatch<SetStateAction<SegmentTags | undefined>>,
  setEditingSegmentTagsSegmentIndex: Dispatch<SetStateAction<number | undefined>>,
  onEditSegmentTags: (index: number) => void,
  getSegEstimatedSize: UseSegments['getSegEstimatedSize'],
  // patch: the queue numbers and the queue's own help (see features/patchSegmentQueue)
  patchMode?: boolean | undefined,
  patchNumbers?: Map<string, PatchSegmentNumber> | undefined,
  patchHelp?: ReactNode | undefined,
  /** patch: a row pinned above the queue's first segment (the armed "next in point" row). */
  patchLeadRow?: ReactNode | undefined,
  /** patch: the pinned row is the active one, so no segment row shows the active highlight. */
  patchLeadActive?: boolean | undefined,
  // patch: the merged window shows the same list, but its chapters are read-only (see above).
  readOnly?: boolean | undefined,
  /** patch: extra context-menu entries from the fork (undefined in base mode, which keeps the menu as-is). */
  patchExtraMenuItems?: MenuItemConstructorOptions[] | undefined,
  /** patch: Shift+click multi-selection of this queue (see features/patchSegmentQueue). */
  patchRowClick?: ((segId: string, shiftKey: boolean) => boolean) | undefined,
  /** patch: this queue has the Shift+click multi-selection: Shift+press belongs to it, not to drag/seek. */
  patchMultiSelect?: boolean | undefined,
  /** patch: the segment ids the multi-selection holds. */
  patchMultiSelectedIds?: ReadonlySet<string> | undefined,
  /** patch: the multi-selection's action bar, rendered above the queue help. */
  patchSelectionBar?: ReactNode | undefined,
}) {
  const { t } = useTranslation();
  const { getSegColor, nextSegColorIndex } = useSegColors();
  const [draggingId, setDraggingId] = useState<UniqueIdentifier | undefined>();

  const { invertCutSegments, simpleMode, darkMode, springAnimation } = useUserSettings();
  const actionTitle = useActionTitle();

  const getButtonColor = useCallback((seg: SegmentColorIndex | undefined, next?: boolean) => getSegColor(seg ? { segColorIndex: next ? seg.segColorIndex + 1 : seg.segColorIndex } : undefined).desaturate(0.3).lightness(darkMode ? 45 : 55).string(), [darkMode, getSegColor]);
  const currentSegColor = useMemo(() => getButtonColor(currentCutSeg), [currentCutSeg, getButtonColor]);
  const segAtCursorColor = useMemo(() => getButtonColor(firstSegmentAtCursor), [getButtonColor, firstSegmentAtCursor]);
  const nextSegmentColor = useMemo(() => getButtonColor({ segColorIndex: nextSegColorIndex }, false), [getButtonColor, nextSegColorIndex]);

  const segmentsTotal = useMemo(() => selectedSegments.reduce((acc, seg) => (seg.end == null ? 0 : seg.end - seg.start) + acc, 0), [selectedSegments]);

  const segmentsOrInverse: (InverseCutSegment | StateSegment)[] = invertCutSegments ? inverseCutSegments : cutSegments;

  const sortableList = useMemo(() => segmentsOrInverse.map((seg) => ({ id: seg.segId, seg })), [segmentsOrInverse]);

  const isOnlyMarkers = useMemo(() => segmentsOrInverse.length > 0 && segmentsOrInverse.every((seg) => seg.end == null), [segmentsOrInverse]);

  function getHeader() {
    if (segmentsOrInverse.length === 0) {
      if (invertCutSegments) {
        return (
          <Trans>You have enabled the &quot;invert segments&quot; mode <FaYinYang style={{ verticalAlign: 'middle' }} /> which will cut away selected segments instead of keeping them. But there is no space between any segments, or at least two segments are overlapping. This would not produce any output. Either make room between segments or click the Yinyang <FaYinYang style={{ verticalAlign: 'middle' }} /> symbol below to disable this mode. Alternatively you may combine overlapping segments from the menu.</Trans>
        );
      }
      return t('No segments to export.');
    }

    if (isOnlyMarkers) {
      return t('Markers:');
    }
    return t('Segments to export:');
  }

  const onReorderSegs = useCallback(async (index: number) => {
    if (cutSegments.length < 2) return;
    const { value } = await getSwal().Swal.fire({
      title: `${t('Change order of segment')} ${index + 1}`,
      text: t('Please enter a number from 1 to {{n}} to be the new order for the current segment', { n: cutSegments.length }),
      input: 'text',
      inputValue: index + 1,
      showCancelButton: true,
      inputValidator: (v) => {
        const parsed = parseInt(v, 10);
        return Number.isNaN(parsed) || parsed > cutSegments.length || parsed < 1 ? t('Invalid number entered') : undefined;
      },
    });

    if (value) {
      const newOrder = parseInt(value, 10);
      updateSegOrder(index, newOrder - 1);
    }
  }, [cutSegments.length, t, updateSegOrder]);

  function renderFooter() {
    // patch: the merged window keeps the same toolbar, but its chapters are read-only, so every
    // button is shown greyed out instead of running its edit action. Selection stays on the rows.
    const editDisabled = readOnly === true;
    return (
      <>
        <div style={{ display: 'flex', padding: '5px 0', alignItems: 'center', justifyContent: 'center', borderBottom: '1px solid var(--gray-6)' }}>
          <FaPlus
            size={24}
            style={{ ...buttonBaseStyle, ...(editDisabled ? disabledButtonStyle : { background: nextSegmentColor }) }}
            role="button"
            title={actionTitle(t('Add segment'), 'addSegment')}
            onClick={editDisabled ? undefined : addSegment}
          />

          <FaMinus
            size={24}
            style={{ ...buttonBaseStyle, ...(editDisabled || cutSegments.length === 0 ? disabledButtonStyle : { backgroundColor: currentSegColor }) }}
            role="button"
            title={actionTitle(t('Remove cutpoint from segment {{segmentNumber}}', { segmentNumber: currentSegIndex + 1 }), 'removeCurrentCutpoint')}
            onClick={editDisabled ? undefined : () => removeSegment(currentSegIndex)}
          />

          {!invertCutSegments && !simpleMode && (
            <>
              <FaSortNumericDown
                size={16}
                title={actionTitle(t('Change segment order'), 'reorderSegsByStartTime')}
                role="button"
                style={{ ...buttonBaseStyle, padding: 4, ...(editDisabled || cutSegments.length < 2 ? disabledButtonStyle : { backgroundColor: currentSegColor }) }}
                onClick={editDisabled ? undefined : () => onReorderSegs(currentSegIndex)}
              />

              <FaTag
                size={16}
                title={actionTitle(t('Label segment'), 'labelCurrentSegment')}
                role="button"
                style={{ ...buttonBaseStyle, padding: 4, ...(editDisabled || cutSegments.length === 0 ? disabledButtonStyle : { backgroundColor: currentSegColor }) }}
                onClick={editDisabled ? undefined : () => onLabelSegment(currentSegIndex)}
              />
            </>
          )}

          <AiOutlineSplitCells
            size={22}
            title={actionTitle(t('Split segment at cursor'), 'splitCurrentSegment')}
            role="button"
            style={{ ...buttonBaseStyle, padding: 1, ...(editDisabled || !firstSegmentAtCursor ? disabledButtonStyle : { backgroundColor: segAtCursorColor }) }}
            onClick={editDisabled ? undefined : splitCurrentSegment}
          />

          {!invertCutSegments && (
            <FaRegCheckCircle
              size={22}
              title={actionTitle(t('Invert segment selection'), 'invertSelectedSegments')}
              role="button"
              // patch: inverting the selection does not modify the chapters, so it stays available in
              // the merged window's read-only list.
              style={{ ...buttonBaseStyle, padding: 1, ...(cutSegments.length === 0 ? disabledButtonStyle : { backgroundColor: neutralButtonColor }) }}
              onClick={cutSegments.length === 0 ? undefined : onInvertSelectedSegments}
            />
          )}
        </div>

        <div style={{ padding: '5px 10px', boxSizing: 'border-box', borderBottom: '1px solid var(--gray-6)', borderTop: '1px solid var(--gray-6)', display: 'flex', justifyContent: 'space-between', fontSize: '.8em' }}>
          <div>{t('Segments total:')}</div>
          <div>{formatTimecode({ seconds: segmentsTotal })}</div>
        </div>
      </>
    );
  }

  const [editingTag, setEditingTag] = useState<string>();

  const onTagsChange = useCallback((keyValues: Record<string, string>) => setEditingSegmentTags((existingTags) => ({
    ...existingTags,
    ...keyValues,
  })), [setEditingSegmentTags]);

  const onTagReset = useCallback((tag: string) => setEditingSegmentTags((tags) => {
    invariant(tags != null);
    const { [tag]: _deleted, ...rest } = tags;
    return rest;
  }), [setEditingSegmentTags]);

  const onSegmentTagsCloseComplete = useCallback(() => {
    setEditingSegmentTagsSegmentIndex(undefined);
    setEditingSegmentTags(undefined);
  }, [setEditingSegmentTags, setEditingSegmentTagsSegmentIndex]);

  const onSegmentTagsConfirm = useCallback(() => {
    invariant(editingSegmentTagsSegmentIndex != null);
    updateSegAtIndex(editingSegmentTagsSegmentIndex, { tags: editingSegmentTags });
    onSegmentTagsCloseComplete();
  }, [editingSegmentTags, editingSegmentTagsSegmentIndex, onSegmentTagsCloseComplete, updateSegAtIndex]);

  const scrollerRef = useRef<HTMLDivElement>(null);

  const sensors = useSensors(useSensor(PointerSensor, {
    activationConstraint: {
      distance: 10,
    },
  }));

  // todo https://github.com/TanStack/virtual/issues/1119
  // eslint-disable-next-line react-hooks/incompatible-library
  const rowVirtualizer = useVirtualizer({
    count: sortableList.length,
    gap: 7,
    getScrollElement: () => scrollerRef.current,
    estimateSize: () => 66, // todo this probably needs to be changed if the segment height changes
    overscan: 5,
    getItemKey: (index) => sortableList[index]!.id,
  });

  useEffect(() => {
    if (invertCutSegments) return;
    rowVirtualizer.scrollToIndex(currentSegIndex, { behavior: 'smooth', align: 'auto' });
  }, [currentSegIndex, invertCutSegments, rowVirtualizer]);

  const handleDragStart = (event: DragStartEvent) => {
    setDraggingId(event.active.id);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setDraggingId(undefined);
    const { active, over } = event;
    if (over != null && active.id !== over?.id) {
      const ids = sortableList.map((s) => s.id);
      const oldIndex = ids.indexOf(active.id as string);
      const newIndex = ids.indexOf(over.id as string);
      const newList = arrayMove(sortableList, oldIndex, newIndex);
      updateSegOrders(newList.map((item) => item.id));
    }
  };

  const draggingSeg = useMemo(() => sortableList.find((s) => s.id === draggingId), [sortableList, draggingId]);

  function renderSegment({ seg, index, selected, isActive, dragging }: {
    seg: StateSegment | InverseCutSegment,
    index: number,
    selected?: boolean,
    isActive?: boolean,
    dragging?: boolean,
  }) {
    return (
      <Segment
        seg={seg}
        index={index}
        isActive={isActive}
        dragging={dragging}
        selected={selected}
        onClick={onSegClick}
        addSegment={addSegment}
        onRemoveSelected={onRemoveSelected}
        onRemovePress={removeSegment}
        onReorderPress={onReorderSegs}
        onLabelPress={onLabelSegment}
        jumpSegStart={jumpSegStart}
        jumpSegEnd={jumpSegEnd}
        updateSegOrder={updateSegOrder}
        getFrameCount={getFrameCount}
        formatTimecode={formatTimecode}
        onSelectSingleSegment={onSelectSingleSegment}
        onToggleSegmentSelected={onToggleSegmentSelected}
        onDeselectAllSegments={onDeselectAllSegments}
        onSelectAllSegments={onSelectAllSegments}
        onEditSegmentTags={onEditSegmentTags}
        onSelectSegmentsByLabel={onSelectSegmentsByLabel}
        onSelectSegmentsByExpr={onSelectSegmentsByExpr}
        onMutateSegmentsByExpr={onMutateSegmentsByExpr}
        onExtractSegmentsFramesAsImages={onExtractSegmentsFramesAsImages}
        onExtractSelectedSegmentsFramesAsImages={onExtractSelectedSegmentsFramesAsImages}
        onLabelSelectedSegments={onLabelSelectedSegments}
        onSelectAllMarkers={onSelectAllMarkers}
        onInvertSelectedSegments={onInvertSelectedSegments}
        onDuplicateSegmentClick={onDuplicateSegmentClick}
        getSegEstimatedSize={getSegEstimatedSize}
        // patch: the queue numbers (see features/patchSegmentQueue)
        patchMode={patchMode}
        patchNumber={patchNumbers?.get(seg.segId)}
        // patch: the merged window shows the same list, but its chapters are read-only.
        readOnly={readOnly}
        // patch: "Work folders and results..." (see the App's patchWorkPathListMenuItems).
        patchExtraMenuItems={patchExtraMenuItems}
        // patch: the queue's Shift+click multi-selection (see features/patchSegmentQueue).
        patchRowClick={patchRowClick}
        patchMultiSelect={patchMultiSelect}
        patchMultiSelected={patchMultiSelectedIds?.has(seg.segId)}
      />
    );
  }

  return (
    <>
      <Dialog.Root open={editingSegmentTagsSegmentIndex != null} onOpenChange={(open) => !open && onSegmentTagsCloseComplete()}>
        <Dialog.Portal>
          <Dialog.Overlay />
          <Dialog.Content style={{ width: '40em' }} aria-describedby={undefined} onEscapeKeyDown={cancelTagEditOnEscape(editingTag, setEditingTag)}>
            <Dialog.Title>{t('Edit segment tags')}</Dialog.Title>

            <TagEditor customTags={editingSegmentTags} editingTag={editingTag} setEditingTag={setEditingTag} onTagsChange={onTagsChange} onTagReset={onTagReset} addTagTitle={t('Add segment tag')} />

            <Dialog.ButtonRow>
              <DialogButton onClick={onSegmentTagsConfirm} disabled={editingTag != null} primary>
                <FaSave style={{ verticalAlign: 'baseline', fontSize: '.8em', marginRight: '.3em' }} />
                {t('Save')}
              </DialogButton>
            </Dialog.ButtonRow>

            <Dialog.CloseButton />
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <motion.div
        style={{ width, background: controlsBackground, borderLeft: '1px solid var(--gray-7)', color: 'var(--gray-11)', transition: darkModeTransition, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
        initial={{ x: width }}
        animate={{ x: 0 }}
        exit={{ x: width }}
        transition={springAnimation}
      >
        <div style={{ padding: '.2em .5em', color: 'var(--gray-12)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '.2em' }} className="no-user-select">
          <span style={{ fontSize: '.8em' }}>{getHeader()}</span>

          <FaTimes
            title={actionTitle(t('Close sidebar'), 'toggleSegmentsList')}
            style={{ fontSize: '1.1em', verticalAlign: 'middle', color: 'var(--gray-11)', cursor: 'pointer', padding: '.2em .3em' }}
            role="button"
            onClick={toggleSegmentsList}
          />
        </div>

        {/* patch: the "0" row while the next in point is armed. It stays outside the scroller so it
            never disturbs the virtualized list's measurement or scroll math. */}
        {patchLeadRow != null && <div style={{ padding: '0 .2em 0 .5em' }}>{patchLeadRow}</div>}

        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd} onDragStart={handleDragStart} modifiers={[restrictToVerticalAxis]}>
          <SortableContext items={sortableList} strategy={verticalListSortingStrategy}>
            <div ref={scrollerRef} style={{ padding: '0 .2em 0 .5em', overflowX: 'hidden', overflowY: 'scroll', flexGrow: 1 }} className="consistent-scrollbar">
              <div style={{ height: rowVirtualizer.getTotalSize(), position: 'relative', overflow: 'hidden' }}>
                {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                  const { id, seg } = sortableList[virtualRow.index]!;
                  const selected = 'selected' in seg ? seg.selected : true;
                  const isActive = !invertCutSegments && !patchLeadActive && currentSegIndex === virtualRow.index;

                  return (
                    <div
                      key={id}
                      data-index={virtualRow.index}
                      ref={rowVirtualizer.measureElement}
                      style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: '100%',
                        transform: `translateY(${virtualRow.start}px)`,
                      }}
                    >
                      {renderSegment({ seg, index: virtualRow.index, selected, isActive })}
                    </div>
                  );
                })}
              </div>
            </div>
          </SortableContext>

          <DragOverlay>
            {draggingSeg ? renderSegment({ seg: draggingSeg.seg, index: sortableList.indexOf(draggingSeg), dragging: true }) : null}
          </DragOverlay>
        </DndContext>

        {isOnlyMarkers && (
          <div style={{ padding: '1em .7em', color: 'var(--gray-11)', fontSize: '.85em' }}>
            {t('Markers are segments without an end time and will not be exported. Convert markers to segments by setting their end time.')}
          </div>
        )}

        {/* patch: the Shift+click multi-selection's actions, right under the list it acts on. */}
        {patchSelectionBar}

        {/* patch: the queue's own help, above the buttons (see features/patchSegmentQueue). */}
        {patchHelp}

        {renderFooter()}
      </motion.div>
    </>
  );
}

export default memo(SegmentList);
