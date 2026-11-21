import { FaTrash, FaTimes, FaRegCheckCircle, FaRegCircle, FaFilter } from 'react-icons/fa';
import { useTranslation } from 'react-i18next';

import type { MultiSelectActionKind } from '../../../../common/features/patchSegmentQueue';
import type { FormatTimecode } from '../../types';
import { dangerColor, primaryColor } from '../../colors';

/**
The cut queue's multi-selection bar (fork-owned).

It appears between the list and the queue help while a Shift+click selection exists, and it acts on
exactly that selection. Nothing here is the export selection: the two circle buttons mark the
selected rows as exported or not exported, which is what the row circle does one row at a time.

While an export runs (`locked`) the list may not change, so the buttons only report it (disabled
with a hint). In a read-only source (the finish job already ran) the rows may still be selected and
marked - that only decides what an export *would* use - but deleting them is refused.
*/

export interface SegmentSelectionBarProps {
  count: number;
  /** How many of the selected rows can be exported at all (a marker cannot). */
  exportableCount: number;
  duration: number;
  formatTimecode: FormatTimecode;
  /** The list is locked (an export is running): the buttons only report. */
  locked: boolean;
  /** The source is finished (work area / finished folder): selection is allowed, deletion is not. */
  readOnly: boolean;
  /** No segment is marked as exported: upstream then exports all of them. */
  exportSelectionEmpty: boolean;
  onAction: (action: MultiSelectActionKind) => void;
  onClose: () => void;
}

export default function SegmentSelectionBar({ count, exportableCount, duration, formatTimecode, locked, readOnly, exportSelectionEmpty, onAction, onClose }: SegmentSelectionBarProps) {
  const { t } = useTranslation();

  const buttonStyle = { fontSize: '.8em', padding: '.25em .6em', display: 'inline-flex', alignItems: 'center', gap: '.3em' };
  // "Keep only these" needs something that can be exported: with markers alone it would deselect
  // every segment, and the export would fall back to all of them (see common/features/patchSegmentQueue).
  const nothingToKeep = exportableCount === 0;

  return (
    <div style={{ padding: '.4em .6em', borderTop: '1px solid var(--gray-6)', background: 'var(--gray-3)', display: 'flex', flexDirection: 'column', gap: '.3em' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '.3em', fontSize: '.8em' }}>
        <span style={{ color: 'var(--gray-12)', marginRight: '.2em' }}>
          {t('{{count}} segments selected', { count })}
          {count > 0 && <> · {formatTimecode({ seconds: duration })}</>}
        </span>

        <button
          type="button"
          style={{ ...buttonStyle, color: 'white', backgroundColor: dangerColor, borderRadius: 3, cursor: readOnly || locked ? 'default' : 'pointer', opacity: readOnly || locked ? 0.5 : 1 }}
          disabled={readOnly || locked}
          title={readOnly
            ? t('The source is read-only, so its segments cannot be deleted')
            : t('Delete the selected segments')}
          onClick={() => onAction('delete')}
        >
          <FaTrash /> {t('Delete')}
        </button>

        <button
          type="button"
          style={{ ...buttonStyle, color: 'white', backgroundColor: 'var(--gray-9)', borderRadius: 3, cursor: locked ? 'default' : 'pointer', opacity: locked ? 0.5 : 1 }}
          disabled={locked}
          title={t('Mark the selected segments as exported')}
          onClick={() => onAction('select')}
        >
          <FaRegCheckCircle /> {t('Mark as exported')}
        </button>

        <button
          type="button"
          style={{ ...buttonStyle, color: 'var(--gray-12)', backgroundColor: 'var(--gray-5)', borderRadius: 3, cursor: locked ? 'default' : 'pointer', opacity: locked ? 0.5 : 1 }}
          disabled={locked}
          title={t('Mark the selected segments as not exported (they stay in the list)')}
          onClick={() => onAction('deselect')}
        >
          <FaRegCircle /> {t('Mark as not exported')}
        </button>

        <button
          type="button"
          style={{ ...buttonStyle, color: 'white', backgroundColor: primaryColor, borderRadius: 3, cursor: locked || nothingToKeep ? 'default' : 'pointer', opacity: locked || nothingToKeep ? 0.5 : 1 }}
          disabled={locked || nothingToKeep}
          title={nothingToKeep
            ? t('Only segments with an end time are exported, and the selection holds none')
            : t('Export only the selected segments and mark every other segment as not exported')}
          onClick={() => onAction('only')}
        >
          <FaFilter /> {t('Export only these')}
        </button>

        <button
          type="button"
          style={{ ...buttonStyle, marginLeft: 'auto', color: 'var(--gray-11)', backgroundColor: 'transparent', cursor: 'pointer' }}
          title={t('Close the selection')}
          onClick={onClose}
        >
          <FaTimes /> {t('Done')}
        </button>
      </div>

      {locked && (
        <div style={{ fontSize: '.75em', color: 'var(--gray-11)' }}>
          {t('Wait for the current export to finish.')}
        </div>
      )}

      {!locked && nothingToKeep && (
        <div style={{ fontSize: '.75em', color: 'var(--gray-11)' }}>
          {t('Only segments with an end time are exported, and the selection holds none')}
        </div>
      )}

      {!locked && exportSelectionEmpty && (
        <div style={{ fontSize: '.75em', color: 'var(--gray-11)' }}>
          {t('No segment is marked as exported, so the export falls back to all of them.')}
        </div>
      )}
    </div>
  );
}
