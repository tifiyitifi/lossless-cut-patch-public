import type { MouseEventHandler } from 'react';
import { useMemo } from 'react';
import { FaTimes } from 'react-icons/fa';

import type { BatchFileSortMeta, BatchSortKey } from '../../../../common/features/batchSort';
import { dangerColor, primaryColor } from '../../colors';
import { buildSourceListDetail, isDetailField } from './sourceListDetails';

/**
One row of the source file list, patch mode (fork-owned).

Upstream draws a number and the file name on one line. Patch mode sorts by more than the name, so
the row has to show what it was sorted by: the number becomes a badge (the queue is walked by
position, it is not a detail), the name is the title, and the second line carries the duration, the
size and the modification time (`sourceListDetails`).

Base mode keeps its own row inside `BatchFile`; this component is only rendered when `patchMode` is
on, so the upstream layout cannot drift with it.
*/
function PatchSourceFileRowBody({ index, name, isOpen, meta, sortKey, onDelete }: {
  index: number;
  name: string;
  isOpen: boolean;
  /** What was read for this file (`features/batchSort`); `undefined` until the background read has it. */
  meta: BatchFileSortMeta | undefined;
  /** The active sort key, or `undefined` in the manual order: its value in the detail line is emphasised. */
  sortKey: BatchSortKey | undefined;
  onDelete?: MouseEventHandler<SVGElement> | undefined;
}) {
  const parts = useMemo(() => buildSourceListDetail(meta), [meta]);
  const highlightedField = isDetailField(sortKey) ? sortKey : undefined;
  const detailText = useMemo(() => parts.map((part) => part.text).join(' · '), [parts]);
  // The extension is cut off last: a truncated name keeps its end visible (base mode does the same
  // with an rtl box), so `001_very_long_title.mp4` still reads as a video file.
  const dot = name.lastIndexOf('.');
  const hasExtension = dot > 0 && dot < name.length - 1;
  const stem = hasExtension ? name.slice(0, dot) : name;
  const extension = hasExtension ? name.slice(dot) : '';

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '.4em', minWidth: 0, flexGrow: 1 }}>
      {/* The row number as a filled chip: with two lines per row the plain "3." of base mode no
          longer reads as the position in the queue. Fixed width and tabular figures keep the names
          of 1, 10 and 100 aligned; the open file fills it so it is found at a glance. */}
      <b
        style={{
          flexShrink: 0,
          boxSizing: 'border-box',
          minWidth: '1.8em',
          padding: '0 .2em',
          textAlign: 'center',
          fontSize: '.92em',
          fontVariantNumeric: 'tabular-nums',
          borderRadius: '.35em',
          color: isOpen ? 'white' : 'var(--gray-12)',
          background: isOpen ? primaryColor : 'var(--gray-6)',
          border: `.05em solid ${isOpen ? primaryColor : 'var(--gray-7)'}`,
        }}
      >
        {index + 1}
      </b>

      <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flexGrow: 1, justifyContent: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '.2em', minWidth: 0 }}>
          <span
            style={{
              display: 'flex',
              minWidth: 0,
              flexGrow: 1,
              overflow: 'hidden',
              whiteSpace: 'nowrap',
              fontWeight: isOpen ? 600 : undefined,
            }}
          >
            <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{stem}</span>
            {extension !== '' && <span style={{ flexShrink: 0 }}>{extension}</span>}
          </span>
          {onDelete && <FaTimes style={{ color: dangerColor, fontSize: '.9em', flexShrink: 0, cursor: 'pointer', padding: '.3em', marginRight: '-.3em' }} role="button" onClick={onDelete} />}
        </div>

        {/* Detail line. One text flow rather than a flex row, so a narrow panel clips the line at
            its end with an ellipsis instead of cutting a value in half; the full line is the tooltip.
            It stays empty (a quiet ellipsis) until the background read answers, which keeps the row
            height and stops the list jumping when the values arrive. */}
        <div
          title={detailText === '' ? undefined : detailText}
          style={{
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            fontSize: '.72em',
            lineHeight: 1.5,
            color: 'var(--gray-11)',
          }}
        >
          {parts.length === 0
            ? <span style={{ opacity: 0.4 }}>…</span>
            : parts.map((part, partIndex) => (
              <span key={part.field}>
                {partIndex > 0 && <span style={{ opacity: 0.4 }}> · </span>}
                <span
                  style={{
                    // The sort key the user picked is the one they want to check: it is the only
                    // value that is not dimmed.
                    color: part.field === highlightedField ? 'var(--gray-12)' : undefined,
                    fontWeight: part.field === highlightedField ? 600 : undefined,
                  }}
                >
                  {part.text}
                </span>
              </span>
            ))}
        </div>
      </div>
    </div>
  );
}

export default PatchSourceFileRowBody;
