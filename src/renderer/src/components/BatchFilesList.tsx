import type { DragEventHandler } from 'react';
import { memo, useCallback, useMemo, useRef, useState } from 'react';
import type { MenuItemConstructorOptions } from 'electron';
import { useTranslation } from 'react-i18next';
import { motion } from 'motion/react';
import { FaArrowDown, FaArrowUp, FaTimes, FaHatWizard, FaSort, FaSortAlphaDown, FaSortAlphaUp, FaEyeSlash } from 'react-icons/fa';
import { AiOutlineMergeCells } from 'react-icons/ai';
import type { DragEndEvent, DragStartEvent, UniqueIdentifier } from '@dnd-kit/core';
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, DragOverlay } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, arrayMove } from '@dnd-kit/sortable';
import { restrictToVerticalAxis } from '@dnd-kit/modifiers';

import BatchFile from './BatchFile';
import { controlsBackground, darkModeTransition, primaryColor } from '../colors';
import type { BatchFile as BatchFileType } from '../types';
import useUserSettings from '../hooks/useUserSettings';
import useNativeMenu from '../hooks/useNativeMenu';
import type { BatchSortKey } from '../../../common/features/batchSort';
import { batchSortKeys, isManualSortSpec } from '../../../common/features/batchSort';
import useBatchFileSort from '../features/batchSort/useBatchFileSort';
import { getBatchSortMeta } from '../features/batchSort/sortSession';
import useSourceListWidth from '../features/patchSourceList/useSourceListWidth';
import SourceListResizeHandle, { sourceListResizeHandleWidth } from '../features/patchSourceList/SourceListResizeHandle';


const iconStyle = {
  flexShrink: 0,
  color: 'var(--gray-12)',
  cursor: 'pointer',
  padding: '.2em .3em',
};

// patch: a stable empty template, so the panel menu is not rebuilt on every render.
const emptyMenuItems: MenuItemConstructorOptions[] = [];

function BatchFilesList({ selectedBatchFiles, filePath, width, batchFiles, setBatchFiles, onBatchFileSelect, batchListRemoveFile, closeBatch, onMergeFilesClick, onBatchConvertToSupportedFormatClick, onDrop, patchMode = false, getExtraMenuItems, panelMenuItems }: {
  selectedBatchFiles: string[],
  filePath: string | undefined,
  width: number,
  batchFiles: BatchFileType[],
  setBatchFiles: (f: BatchFileType[]) => void,
  onBatchFileSelect: (f: string) => void,
  batchListRemoveFile: (path: string | undefined) => void,
  closeBatch: () => void,
  onMergeFilesClick: () => void,
  onBatchConvertToSupportedFormatClick: () => void,
  onDrop: DragEventHandler<HTMLDivElement>,
  // patch: in patch mode the button hides the list instead of destroying it (see App's closeBatch).
  patchMode?: boolean,
  // patch: extra context-menu items for a row (file location menu); undefined in base mode.
  getExtraMenuItems?: ((path: string) => MenuItemConstructorOptions[]) | undefined,
  // patch: the context menu of the panel itself (header and the area around the rows); undefined in base mode.
  panelMenuItems?: MenuItemConstructorOptions[] | undefined,
}) {
  const { t } = useTranslation();
  const { springAnimation, simpleMode } = useUserSettings();

  const [sortDesc, setSortDesc] = useState<boolean>();
  const [draggingId, setDraggingId] = useState<UniqueIdentifier | undefined>();

  // patch: patch mode sorts by more than the name (extension, size, modification time, duration),
  // in both directions, and remembers what it read for the whole session (features/batchSort).
  const {
    spec: patchSortSpec,
    progress: patchSortProgress,
    unavailableKeys: patchSortUnavailableKeys,
    sortBy: patchSortBy,
    setDirection: patchSetSortDirection,
    resetToManual: patchResetSortOrder,
  } = useBatchFileSort({ files: batchFiles, setFiles: setBatchFiles, enabled: patchMode });

  // patch: rows keep their own menu; this ref tells the panel's handler where they end.
  const rowContainerRef = useRef<HTMLDivElement | null>(null);
  const { openMenu: openPanelMenu } = useNativeMenu(panelMenuItems ?? emptyMenuItems);

  // patch: the panel's width is the user's, dragged on the right edge and remembered in the patch
  // settings (features/patchSourceList). Base mode keeps the width its caller passes.
  const { width: patchWidth, setWidth: patchSetWidth, commitWidth: patchCommitWidth } = useSourceListWidth(patchMode);
  const effectiveWidth = patchMode ? patchWidth : width;
  // The grab strip sits on the panel's edge and must not cover the rows' scrollbar or the header's
  // icons, so both keep this much room free.
  const patchStripInset = `calc(${sourceListResizeHandleWidth}px + .3em)`;

  const sortableList = batchFiles.map((batchFile) => ({ id: batchFile.path, batchFile }));

  const onSortClick = useCallback(() => {
    const newSortDesc = sortDesc == null ? false : !sortDesc;
    const sortedFiles = [...batchFiles];
    const order = newSortDesc ? -1 : 1;
    // natural language sort (numeric) https://github.com/mifi/lossless-cut/issues/844
    sortedFiles.sort((a, b) => order * a.name.localeCompare(b.name, 'en-US', { numeric: true }));
    setBatchFiles(sortedFiles);
    setSortDesc(newSortDesc);
  }, [batchFiles, setBatchFiles, sortDesc]);

  const SortIcon = sortDesc ? FaSortAlphaDown : FaSortAlphaUp;

  // patch: the sort key names, shared by the menu and the "what the list is ordered by" line.
  const patchSortKeyLabels = useMemo<Record<BatchSortKey, string>>(() => ({
    name: t('File name'),
    ext: t('Extension'),
    size: t('File size'),
    mtime: t('Modification time'),
    duration: t('Duration'),
  }), [t]);

  // patch: the patch sort menu. A key that could not be read is disabled for the session; the
  // others stay available, so one unreadable source never takes the whole list's sorting away.
  const patchSortMenuItems = useMemo<MenuItemConstructorOptions[]>(() => {
    if (!patchMode) return emptyMenuItems;
    const direction = isManualSortSpec(patchSortSpec) ? undefined : patchSortSpec.direction;
    return [
      ...batchSortKeys.map((key) => ({
        label: patchSortKeyLabels[key],
        type: 'radio' as const,
        checked: !isManualSortSpec(patchSortSpec) && patchSortSpec.key === key,
        enabled: !patchSortUnavailableKeys.has(key),
        click: () => {
          patchSortBy(key).catch((err: unknown) => { console.error('Failed to sort the file list', err); });
        },
      })),
      { type: 'separator' as const },
      { label: t('Ascending'), type: 'radio' as const, checked: direction === 'asc', enabled: direction != null, click: () => { patchSetSortDirection('asc').catch((err: unknown) => { console.error('Failed to change the sort direction', err); }); } },
      { label: t('Descending'), type: 'radio' as const, checked: direction === 'desc', enabled: direction != null, click: () => { patchSetSortDirection('desc').catch((err: unknown) => { console.error('Failed to change the sort direction', err); }); } },
      { type: 'separator' as const },
      { label: t('Manual order'), type: 'radio' as const, checked: isManualSortSpec(patchSortSpec), click: patchResetSortOrder },
    ];
  }, [patchMode, patchResetSortOrder, patchSetSortDirection, patchSortBy, patchSortKeyLabels, patchSortSpec, patchSortUnavailableKeys, t]);

  const { openMenu: openPatchSortMenu } = useNativeMenu(patchSortMenuItems);

  const patchSortTitle = patchSortProgress == null
    ? t('Sort items')
    : t('Reading file details ({{done}} of {{total}})', { done: patchSortProgress.done, total: patchSortProgress.total });


  const sensors = useSensors(useSensor(PointerSensor, {
    activationConstraint: {
      distance: 10,
    },
  }));

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
      setBatchFiles(newList.map((item) => item.batchFile));
      // patch: the dragged order is the user's own now; leaving "sorted by X" checked would lie.
      if (patchMode) patchResetSortOrder();
    }
  };

  const draggingFile = useMemo(() => sortableList.find((s) => s.id === draggingId), [sortableList, draggingId]);

  return (
    <motion.div
      className="no-user-select"
      style={{
        width: effectiveWidth,
        background: controlsBackground,
        color: 'var(--gray-12)',
        borderRight: '1px solid var(--gray-7)',
        transition: darkModeTransition,
        display: 'flex',
        flexDirection: 'column',
        overflowY: 'hidden',
        overflowX: 'hidden',
        // patch: patch mode drags its own edge (features/patchSourceList); the browser resize corner
        // never worked here anyway, because the width is a React prop and gets re-rendered over it.
        position: patchMode ? 'relative' : undefined,
        resize: patchMode ? undefined : 'horizontal',
      }}
      initial={{ x: -effectiveWidth }}
      animate={{ x: 0 }}
      exit={{ x: -effectiveWidth }}
      transition={springAnimation}
      onDrop={onDrop}
      onContextMenu={panelMenuItems == null ? undefined : (event) => {
        // patch: a row opens its own menu; the panel menu belongs to the header and the area
        // around the rows, so the two never pop up together. The default is cancelled for both:
        // otherwise the main process also pops its menu (`src/main/contextMenu.ts`) over the row's
        // one, and a full list - with no empty area left to right-click - loses "Clear the source
        // file list" along with the rest of the row menu.
        event.preventDefault();
        if (rowContainerRef.current?.contains(event.target as Node)) return;
        openPanelMenu(event.nativeEvent);
      }}
    >
      <div style={{ paddingBottom: patchMode ? '.3em' : '.5em', paddingTop: 0, paddingLeft: '.5em', paddingRight: patchMode ? patchStripInset : undefined, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', flexWrap: 'wrap', gap: '.2em' }}>
        <div style={{ fontSize: '.8em' }}>{t('Batch file list')}{batchFiles.length > 0 && ` (${batchFiles.length})`}</div>
        <div style={{ flexGrow: 1 }} />
        <FaHatWizard role="button" title={`${t('Convert to supported format')}...`} style={iconStyle} onClick={onBatchConvertToSupportedFormatClick} />
        {/* patch: patch mode sorts by more than the name; the menu carries every key and both directions. */}
        {patchMode ? (
          <FaSort
            role="button"
            title={patchSortTitle}
            style={{ ...iconStyle, opacity: patchSortProgress == null ? 1 : 0.5 }}
            onClick={(event) => {
              if (patchSortProgress == null) openPatchSortMenu(event.nativeEvent);
            }}
          />
        ) : (
          <SortIcon role="button" title={t('Sort items')} style={iconStyle} onClick={onSortClick} />
        )}
        <AiOutlineMergeCells className={simpleMode ? 'export-animation' : undefined} role="button" title={`${t('Merge/concatenate files')}...`} style={{ ...iconStyle, color: 'white', background: primaryColor, borderRadius: '.5em' }} onClick={onMergeFilesClick} />
        {/* patch: patch mode hides the list (it can be shown again with the command console). */}
        {patchMode
          ? <FaEyeSlash role="button" title={t('Hide source file list')} style={{ ...iconStyle, fontSize: '1.1em', color: 'var(--gray-11)' }} onClick={closeBatch} />
          : <FaTimes role="button" title={t('Close batch')} style={{ ...iconStyle, fontSize: '1.1em', color: 'var(--gray-11)' }} onClick={closeBatch} />}
      </div>

      {/* patch: what the list is ordered by, and what it is still reading. The rows show the values
          themselves; this line says which one the order follows, which is the part a second look at
          the list cannot answer (two files with the same size look identical either way). An empty
          list has no order to show. */}
      {patchMode && batchFiles.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '.25em', padding: '0 .5em .4em .5em', paddingRight: patchStripInset, fontSize: '.72em', lineHeight: 1.4, color: 'var(--gray-11)', minWidth: 0, overflow: 'hidden', whiteSpace: 'nowrap' }}>
          {patchSortProgress == null ? (
            <>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {isManualSortSpec(patchSortSpec) ? t('Manual order') : patchSortKeyLabels[patchSortSpec.key]}
              </span>
              {!isManualSortSpec(patchSortSpec) && (patchSortSpec.direction === 'asc' ? <FaArrowUp size={9} /> : <FaArrowDown size={9} />)}
            </>
          ) : (
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {t('Reading file details ({{done}} of {{total}})', { done: patchSortProgress.done, total: patchSortProgress.total })}
            </span>
          )}
        </div>
      )}

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd} onDragStart={handleDragStart} modifiers={[restrictToVerticalAxis]}>
        <SortableContext items={sortableList} strategy={verticalListSortingStrategy}>
          <div ref={rowContainerRef} style={{ overflowX: 'hidden', overflowY: 'auto', marginRight: patchMode ? sourceListResizeHandleWidth : undefined }}>
            {patchMode && batchFiles.length === 0 && (
              // patch: the panel stays on screen before the first video (it is a drop target too),
              // so it has to say what it is waiting for instead of showing only a header.
              <div style={{ padding: '.8em .6em', fontSize: '.85em', lineHeight: 1.5, color: 'var(--gray-11)' }}>
                {t('No files yet: drop videos here or anywhere in the window, or click the box in the middle to pick them.')}
              </div>
            )}
            {sortableList.map(({ batchFile: { path, name } }, index) => (
              <BatchFile
                key={path}
                index={index}
                path={path}
                name={name}
                isSelected={selectedBatchFiles.includes(path)}
                isOpen={filePath === path}
                onSelect={onBatchFileSelect}
                onDelete={batchListRemoveFile}
                getExtraMenuItems={getExtraMenuItems}
                patchMode={patchMode}
                // patch: the row's detail line reads the session cache directly; the cached object
                // keeps its identity until it changes, so a row only re-renders when its own
                // details arrive (features/batchSort).
                patchMeta={patchMode ? getBatchSortMeta(path) : undefined}
                patchSortKey={isManualSortSpec(patchSortSpec) ? undefined : patchSortSpec.key}
              />
            ))}
          </div>
        </SortableContext>

        <DragOverlay>
          {draggingFile ? (
            <BatchFile
              dragging
              index={sortableList.indexOf(draggingFile)}
              path={draggingFile.batchFile.path}
              name={draggingFile.batchFile.name}
              patchMode={patchMode}
              patchMeta={patchMode ? getBatchSortMeta(draggingFile.batchFile.path) : undefined}
              patchSortKey={isManualSortSpec(patchSortSpec) ? undefined : patchSortSpec.key}
            />
          ) : null}
        </DragOverlay>
      </DndContext>

      {/* patch: the drag strip on the right edge. It is the panel's last child so it paints over the
          rows' scrollbar corner, and it owns the pointer events (features/patchSourceList). */}
      {patchMode && (
        <SourceListResizeHandle width={patchWidth} onWidthChange={patchSetWidth} onWidthCommit={patchCommitWidth} />
      )}
    </motion.div>
  );
}

export default memo(BatchFilesList);
