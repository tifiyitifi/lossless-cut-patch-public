import type { CSSProperties, MouseEventHandler } from 'react';
import { memo, useRef, useMemo, useCallback } from 'react';
import type { MenuItemConstructorOptions } from 'electron';
import { useTranslation } from 'react-i18next';
import { FaFile, FaTimes } from 'react-icons/fa';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

import useContextMenu from '../hooks/useContextMenu';
import { dangerColor, primaryColor, primaryTextColor } from '../colors';
import type { ContextMenuTemplate } from '../types';
import type { BatchFileSortMeta, BatchSortKey } from '../../../common/features/batchSort';
import PatchSourceFileRowBody from '../features/patchSourceList/PatchSourceFileRowBody';

function BatchFile({ path, index, isOpen, isSelected, name, onSelect, onDelete, dragging, getExtraMenuItems, patchMode, patchMeta, patchSortKey }: {
  path: string,
  index: number,
  isOpen?: boolean,
  isSelected?: boolean,
  name: string,
  onSelect?: (a: string) => void,
  onDelete?: (a: string) => void,
  dragging?: boolean,
  // patch: extra context-menu items for this row (undefined in base mode, which keeps the menu as-is).
  getExtraMenuItems?: ((a: string) => MenuItemConstructorOptions[]) | undefined,
  // patch: the row's second line and its number badge (features/patchSourceList). Off in base mode,
  // which keeps the upstream single-line row.
  patchMode?: boolean | undefined,
  /** What was read for this file; `undefined` until the background read has it (see features/batchSort). */
  patchMeta?: BatchFileSortMeta | undefined,
  /** The active sort key, so the detail line can emphasise the value the list is ordered by. */
  patchSortKey?: BatchSortKey | undefined,
}) {
  const ref = useRef<HTMLDivElement | null>(null);

  const { t } = useTranslation();
  const contextMenuTemplate = useMemo<ContextMenuTemplate>(() => {
    const extra = getExtraMenuItems?.(path);
    return [
      { label: t('Remove'), click: () => onDelete?.(path) },
      ...(extra != null && extra.length > 0 ? [{ type: 'separator' as const }, ...extra] : []),
    ];
  }, [t, onDelete, path, getExtraMenuItems]);

  // patch: cancelling the default keeps the main process from popping its own menu over this one
  // (see `useContextMenu`); base mode keeps the upstream call.
  useContextMenu(ref, contextMenuTemplate, true, patchMode);

  const sortable = useSortable({
    id: path,
    transition: {
      duration: 150,
      easing: 'ease-in-out',
    },
  });

  const setRef = useCallback((node: HTMLDivElement | null) => {
    sortable.setNodeRef(node);
    ref.current = node;
  }, [sortable]);

  const style = useMemo<CSSProperties>(() => ({
    visibility: sortable.isDragging ? 'hidden' : undefined,
    opacity: dragging ? 0.6 : 1,
    transform: CSS.Transform.toString(sortable.transform),
    transition: sortable.transition,
    background: isSelected ? 'var(--gray-7)' : undefined,
    cursor: dragging ? 'grabbing' : 'default',
    fontSize: 13,
    // patch: the patch row is two lines (name, then the details beside a number badge), and the open
    // file is marked on the left edge, where a list's marker belongs. Base mode keeps its single
    // line and its right-hand marker untouched.
    padding: patchMode ? '.28em .25em .28em .3em' : '.2em .2em .2em .4em',
    display: 'flex',
    alignItems: 'center',
    alignContent: 'flex-start',
    borderRight: patchMode ? undefined : `.3em solid ${isOpen ? primaryColor : 'transparent'}`,
    borderLeft: patchMode ? `.25em solid ${isOpen ? primaryColor : 'transparent'}` : undefined,
  }), [sortable.isDragging, sortable.transform, sortable.transition, dragging, isSelected, isOpen, patchMode]);

  const handleClick = useCallback<MouseEventHandler<HTMLDivElement>>((e) => {
    onSelect?.(path);
    e.currentTarget.blur();
  }, [onSelect, path]);

  const handleDeleteClick = useCallback<MouseEventHandler<SVGElement>>((e) => {
    e.stopPropagation();
    onDelete?.(path);
    e.currentTarget.blur();
  }, [onDelete, path]);

  return (
    <div
      {...sortable.attributes}
      {...sortable.listeners}
      ref={setRef}
      role="button"
      tabIndex={-1}
      style={style}
      title={path}
      onClick={handleClick}
    >
      {patchMode ? (
        <PatchSourceFileRowBody
          index={index}
          name={name}
          isOpen={isOpen === true}
          meta={patchMeta}
          sortKey={patchSortKey}
          onDelete={onDelete == null ? undefined : handleDeleteClick}
        />
      ) : (
        <>
          <FaFile style={{ color: isSelected ? primaryTextColor : undefined, flexShrink: 0, fontSize: '1em', marginRight: '.1em' }} />
          <div style={{ flexShrink: 0, marginRight: '.1em' }}>{index + 1}.</div>
          <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', direction: 'rtl' }}>
            <span style={{ direction: 'ltr', unicodeBidi: 'isolate', display: 'inline-block' }}>{name}</span>
          </div>
          <div style={{ flexGrow: 1 }} />
          {onDelete && <FaTimes style={{ color: dangerColor, fontSize: '.9em', marginRight: '-.3em', flexShrink: 0, cursor: 'pointer', padding: '.3em' }} role="button" onClick={handleDeleteClick} />}
        </>
      )}
    </div>
  );
}

export default memo(BatchFile);
