import { useCallback, useRef } from 'react';
import type { MouseEventHandler } from 'react';

import { usePatchSession } from '../session/patchSessionContext';

/** Column 2: simple cut bar under the player. Shows cut segments and the playhead; click to seek. */
export default function CutBar() {
  const { cutSegments, currentSegIndex, fileDuration, relevantTime, seekAbs, setCurrentSegIndex } = usePatchSession();
  const barRef = useRef<HTMLDivElement>(null);

  const handleClick = useCallback<MouseEventHandler<HTMLDivElement>>((event) => {
    const bar = barRef.current;
    if (bar == null || fileDuration == null || fileDuration <= 0) return;
    const rect = bar.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    seekAbs(ratio * fileDuration);
  }, [fileDuration, seekAbs]);

  if (fileDuration == null || fileDuration <= 0) {
    return <div style={{ height: 26, background: 'var(--gray-3)', flexShrink: 0 }} />;
  }

  const percent = (time: number) => `${Math.min(100, Math.max(0, (time / fileDuration) * 100))}%`;

  return (
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions
    <div
      ref={barRef}
      onClick={handleClick}
      style={{ position: 'relative', height: 26, background: 'var(--gray-4)', cursor: 'crosshair', flexShrink: 0 }}
    >
      {cutSegments.map((segment, index) => {
        const end = segment.end ?? fileDuration;
        const isCurrent = index === currentSegIndex;
        return (
          // eslint-disable-next-line jsx-a11y/no-static-element-interactions
          <div
            key={segment.segId}
            title={String(index + 1)}
            onClick={(event) => { event.stopPropagation(); setCurrentSegIndex(index); seekAbs(segment.start); }}
            style={{
              position: 'absolute',
              top: 3,
              bottom: 3,
              left: percent(segment.start),
              width: `${Math.max(0, ((end - segment.start) / fileDuration) * 100)}%`,
              background: segment.selected ? 'var(--accent-8)' : 'var(--gray-8)',
              outline: isCurrent ? '1px solid var(--accent-11)' : undefined,
              borderRadius: 2,
              cursor: 'pointer',
            }}
          />
        );
      })}
      <div style={{ position: 'absolute', top: 0, bottom: 0, left: percent(relevantTime), width: 1, background: 'var(--red-9)', pointerEvents: 'none' }} />
    </div>
  );
}
