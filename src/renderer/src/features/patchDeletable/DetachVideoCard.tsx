import { memo, useRef } from 'react';
import type { MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';

import type { PatchDeepCheckView } from '../../../../common/features/patchDeletable';
import { getPatchFileQuickHealth } from '../../../../common/features/patchDeletable';
import type { PatchDetachGridItem } from '../../../../common/features/patchDeletable/grid';
import { getPathBaseName } from '../../../../common/features/patchData/videoExtensions';
import usePatchFileContextMenu from '../patchFileActions/usePatchFileContextMenu';
import LazyFrame from './LazyFrame';
import { chipButtonStyle, DeepCheckControl, FileDetailParts, patchCheckText, QuickHealthChip } from './DetachFileMeta';
import { resultFolderLabel, sourceReasonLabel } from './reasonLabels';
import type { DetachableFileDetails } from './useDetachableFileDetails';

/**
One video of the deletion check (fork-owned).

A source and its results are the same card: the frame, the name, the line that says what the file is,
the duration/size/modification time, and the three actions. They are the same size in every view. A
source is marked as one - a "Source video" chip in front of its reason and a gray bar on its left
edge - because in a group panel the source and its results sit next to each other and a glance has to
tell which is which. The bar is gray rather than the accent color: the blue outline belongs to the
selected card, so a blue edge on every source read as a selection.

The whole card is the click target (a Windows file list, not a checkbox): click selects, Ctrl+click
adds or removes, Shift+click selects a range, double-click plays. The action buttons stop the click,
so playing or checking a file never changes what is selected for deletion.

A missing result is not a card: it is not a file, so it cannot be selected or played. It is shown as
the dashed strip `DetachMissingStrip`.
*/

export type DetachCardLayout = 'tile' | 'list';

const nameStyle = {
  wordBreak: 'break-all',
  display: '-webkit-box',
  WebkitBoxOrient: 'vertical',
  WebkitLineClamp: 2,
  overflow: 'hidden',
} as const;

const sourceBadgeStyle = {
  background: 'var(--accent-3)',
  border: '1px solid var(--accent-6)',
  borderRadius: '.25em',
  color: 'var(--accent-11)',
  padding: '0 .3em',
  whiteSpace: 'nowrap',
} as const;

function isParked(item: PatchDetachGridItem) {
  return item.resultFolder === 'detachedClips' || item.resultFolder === 'detachedMerged';
}

function DetachVideoCard({ item, details, deepCheck, selected, layout, tileWidth, onSelect, onPlay, onDeepCheck, onCancelDeepCheck, onLocate }: {
  item: PatchDetachGridItem;
  details: DetachableFileDetails | undefined;
  deepCheck: PatchDeepCheckView | undefined;
  selected: boolean;
  layout: DetachCardLayout;
  /** `undefined` fills the cell (every source card and every card of the list layout). */
  tileWidth: number | undefined;
  onSelect: (selection: { key: string, extend: boolean, toggle: boolean }) => void;
  onPlay: (path: string) => void;
  onDeepCheck: (path: string) => void;
  onCancelDeepCheck: (path: string) => void;
  onLocate: (path: string) => void;
}) {
  const { t } = useTranslation();
  const cardRef = useRef<HTMLDivElement | null>(null);
  usePatchFileContextMenu({ targetRef: cardRef, path: item.path });

  const health = getPatchFileQuickHealth({ size: details?.size, duration: details?.duration });
  const thumbTime = details?.duration != null && details.duration > 0 ? Math.min(5, details.duration / 10) : 1;
  const parked = isParked(item);
  const unavailable = !item.selectable || (item.kind === 'source' && !item.deletable);

  const detail = (
    <span style={{ fontSize: patchCheckText.meta, color: 'var(--gray-11)' }}>
      <FileDetailParts details={details} />
    </span>
  );

  const actions = (
    <div style={{ display: 'flex', gap: '.3em', alignItems: 'center', flexWrap: 'wrap' }}>
      <button
        type="button"
        onClick={(event) => { event.stopPropagation(); onPlay(item.path); }}
        title={t('Play')}
        aria-label={t('Play')}
        style={chipButtonStyle}
      >
        ▶
      </button>
      <DeepCheckControl
        state={deepCheck}
        onStart={() => { onDeepCheck(item.path); }}
        onCancel={() => { onCancelDeepCheck(item.path); }}
      />
      <QuickHealthChip health={health} />
      <button
        type="button"
        onClick={(event) => { event.stopPropagation(); onLocate(item.path); }}
        title={t('Show in the file manager')}
        style={chipButtonStyle}
      >
        {t('Locate')}
      </button>
    </div>
  );

  const typeLine = (
    <span style={{ display: 'flex', gap: '.3em', alignItems: 'center', flexWrap: 'wrap', fontSize: patchCheckText.meta }}>
      {item.kind === 'source' && <span style={sourceBadgeStyle}>{t('Source video')}</span>}
      <span style={{ color: parked || (item.kind === 'source' && !item.deletable) ? 'var(--orange-9)' : 'var(--gray-11)' }}>
        {item.kind === 'source' ? sourceReasonLabel(item.reason ?? 'not-detached', t) : resultFolderLabel(item.resultFolder, t)}
      </span>
    </span>
  );

  const select = (event: MouseEvent<HTMLDivElement>) => {
    // The second click of a double click must not toggle the item off again; the play handler runs.
    if (event.detail > 1) return;
    onSelect({ key: item.key, extend: event.shiftKey, toggle: event.ctrlKey || event.metaKey });
  };

  const commonStyle = {
    // The width below is the width the layout measures a card by (`tileWidth`), so the padding and
    // the border have to live inside it: without this a card is 13 px wider than its column and the
    // rule between the columns lands on top of it.
    boxSizing: 'border-box',
    padding: '.35em',
    borderRadius: '.35em',
    border: `1px solid ${selected ? 'var(--gray-7)' : 'var(--gray-5)'}`,
    background: selected ? 'var(--gray-4)' : 'var(--gray-3)',
    outline: selected ? '2px solid var(--accent-8)' : undefined,
    outlineOffset: '-1px',
    cursor: 'pointer',
    opacity: unavailable ? 0.72 : 1,
    // The source of a group is marked on its edge as well, so the eye finds it before reading. Gray,
    // not the accent color: blue is the selected card's outline, so a blue edge read as a selection.
    boxShadow: item.kind === 'source' ? 'inset 3px 0 0 var(--gray-7)' : undefined,
  } as const;

  return (
    <div
      ref={cardRef}
      role="button"
      tabIndex={-1}
      title={item.path}
      onClick={select}
      onDoubleClick={() => { onPlay(item.path); }}
      style={layout === 'list'
        ? { ...commonStyle, display: 'flex', flexDirection: 'row', alignItems: 'flex-start', gap: '.5em', width: '100%' }
        : { ...commonStyle, display: 'flex', flexDirection: 'column', gap: '.25em', width: tileWidth ?? '100%' }}
    >
      <LazyFrame
        path={item.path}
        cacheKey={`${item.path}|${details?.size ?? ''}|${details?.mtime ?? ''}`}
        time={thumbTime}
        {...(layout === 'list' ? { width: 96, height: 54 } : { fill: true })}
      />

      {layout === 'list' ? (
        <div style={{ minWidth: 0, flexGrow: 1, display: 'flex', flexDirection: 'column', gap: '.12em' }}>
          <span style={{ ...nameStyle, fontSize: patchCheckText.cardTitle }}>{getPathBaseName(item.path)}</span>
          {typeLine}
          {detail}
          {actions}
        </div>
      ) : (
        <>
          <span style={{ ...nameStyle, fontSize: patchCheckText.cardTitle }}>{getPathBaseName(item.path)}</span>
          {typeLine}
          {detail}
          {actions}
        </>
      )}
    </div>
  );
}

export default memo(DetachVideoCard);

/** A result the ledger records but that is not on disk anymore: a strip, not a playable card. */
export function DetachMissingStrip({ path, width, layout }: { path: string; width: number | undefined; layout: DetachCardLayout }) {
  const { t } = useTranslation();
  return (
    <div
      title={path}
      style={{
        boxSizing: 'border-box',
        width: layout === 'list' ? '100%' : width ?? '100%',
        display: 'flex',
        flexDirection: 'column',
        gap: '.1em',
        padding: '.3em .4em',
        borderRadius: '.35em',
        border: '1px dashed var(--orange-7)',
        fontSize: patchCheckText.meta,
        color: 'var(--orange-9)',
      }}
    >
      <span style={nameStyle}>{getPathBaseName(path)}</span>
      <span>{t('Missing file')}</span>
    </div>
  );
}
