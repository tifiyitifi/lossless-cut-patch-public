import type { RefObject } from 'react';
import { memo, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { FaFile } from 'react-icons/fa';

import type { PatchCutResultEntry } from '../../../../common/features/patchPlayer';
import type { PatchDetachOrigin } from '../../../../common/features/patchPlayer/playlistOrigin';
import { primaryColor } from '../../colors';
import usePatchFileContextMenu from '../patchFileActions/usePatchFileContextMenu';

const { basename } = window.require('node:path');

/** The yellow badge of the check player says which folder a file came from. */
function originLabel(origin: PatchDetachOrigin, t: (key: string) => string) {
  switch (origin) {
    case 'detachedSrc': { return t('Source, waiting for deletion'); }
    case 'finishedSrc': { return t('Finished source'); }
    case 'finishedSkip': { return t('Skipped source'); }
    case 'finishedClips': { return t('Cut result'); }
    case 'finishedMerged': { return t('Merged result'); }
    case 'detachedClips': { return t('Temporary clip, waiting for deletion'); }
    default: { return t('Merged result, waiting for deletion'); }
  }
}

/**
One row of the cut-results playlist (fork-owned): click plays it, right-click locates the file
on disk (the row needs its own ref for the native context menu).
*/
function PatchCutResultRow({ entry, index, isCurrent, missing, onSelect, currentRef }: {
  entry: PatchCutResultEntry,
  index: number,
  isCurrent: boolean,
  /** The file is gone from disk (another window's finish job moved or renamed it): shown, not playable. */
  missing?: boolean | undefined,
  onSelect: (selected: PatchCutResultEntry) => void,
  /** The list's ref to the playing row (for scrolling it into view), only passed to that row. */
  currentRef: RefObject<HTMLDivElement | null> | undefined,
}) {
  const { t } = useTranslation();
  const rowRef = useRef<HTMLDivElement | null>(null);
  usePatchFileContextMenu({ targetRef: rowRef, path: entry.path });

  const setRef = useCallback((node: HTMLDivElement | null) => {
    rowRef.current = node;
    // The list owns the scroll ref; this is the same wiring the inline row used to do.
    // eslint-disable-next-line no-param-reassign
    if (currentRef != null) currentRef.current = node;
  }, [currentRef]);

  return (
    <div
      ref={setRef}
      role="button"
      tabIndex={-1}
      title={missing === true ? t('The file was moved or deleted.') : entry.path}
      style={{
        fontSize: 13,
        padding: '.2em .2em .2em .4em',
        display: 'flex',
        alignItems: 'center',
        alignContent: 'flex-start',
        background: isCurrent ? 'var(--gray-7)' : undefined,
        borderRight: `.3em solid ${isCurrent ? primaryColor : 'transparent'}`,
        cursor: missing === true ? 'default' : 'pointer',
        color: missing === true ? 'var(--gray-8)' : undefined,
      }}
      onClick={(e) => {
        // A file that is gone cannot be played; the row stays so the user sees which one it is.
        if (missing !== true) onSelect(entry);
        // Keep the upstream keyboard shortcuts alive (they only run while the body has focus).
        e.currentTarget.blur();
      }}
    >
      <FaFile style={{ flexShrink: 0, fontSize: '1em', marginRight: '.1em' }} />
      {/* patch: the row number is the playlist position, shown as the same gray badge the source
          window uses, but at full row size (the source badge is `.7em` of a bigger base font, which
          would shrink it here). A fixed width and tabular figures line the file names up. The
          currently playing row fills the badge so its position reads at a glance. */}
      <b
        style={{
          flexShrink: 0,
          boxSizing: 'border-box',
          minWidth: '1.7em',
          padding: '0 .15em',
          marginRight: '.3em',
          textAlign: 'center',
          fontSize: '1em',
          fontVariantNumeric: 'tabular-nums',
          borderRadius: '.35em',
          color: isCurrent ? 'var(--gray-1)' : 'var(--gray-12)',
          background: isCurrent ? 'var(--gray-10)' : 'transparent',
          border: `.05em solid ${isCurrent ? 'var(--gray-10)' : 'var(--gray-7)'}`,
        }}
      >
        {index + 1}
      </b>
      {entry.origin != null && (
        <span
          style={{
            flexShrink: 0,
            marginRight: '.3em',
            padding: '0 .25em',
            fontSize: '.85em',
            whiteSpace: 'nowrap',
            borderRadius: '.3em',
            background: 'var(--yellow-4)',
            color: 'var(--yellow-11)',
            border: '1px solid var(--yellow-6)',
          }}
        >
          {originLabel(entry.origin, t)}
        </span>
      )}
      <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', direction: 'rtl' }}>
        <span style={{ direction: 'ltr', unicodeBidi: 'isolate', display: 'inline-block' }}>{entry.label || basename(entry.path)}</span>
      </div>
    </div>
  );
}

export default memo(PatchCutResultRow);
