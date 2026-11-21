import type { PointerEvent as ReactPointerEvent } from 'react';
import { useCallback, useRef, useState } from 'react';

import { defaultSourceListWidth } from '../../../../common/features/patchData/sourceList';
import { primaryColor } from '../../colors';

/**
The drag strip on the source list's right edge (patch, fork-owned).

The panel used to carry `resize: horizontal`, which never worked: the width is a React prop, so the
inline width the browser writes while the user drags is overwritten on the next render. This strip
is the real thing - pointer capture instead of a browser resize corner, so the drag keeps working
when the pointer leaves the 6px strip, and a value that is committed once on release.

The width is only *rendered* while dragging (`onWidthChange`); the settings write happens on release
(`onWidthCommit`), because the patch store writes to disk.
*/

interface DragState {
  pointerId: number;
  startX: number;
  startWidth: number;
}

/** How wide the grab strip is; the list keeps its rows clear of it (see `BatchFilesList`). */
export const sourceListResizeHandleWidth = 6;

export default function SourceListResizeHandle({ width, onWidthChange, onWidthCommit }: {
  /** The width the panel currently shows, i.e. where a new drag starts from. */
  width: number;
  /** Called on every pointer move with the width the panel should show now. */
  onWidthChange: (width: number) => void;
  /** Called once, on release (and on a double click) with the width to keep. */
  onWidthCommit: (width: number) => void;
}) {
  const dragRef = useRef<DragState | undefined>(undefined);
  // The last width this drag produced: the `width` prop lags one render behind the pointer.
  const latestWidthRef = useRef(width);
  const [dragging, setDragging] = useState(false);
  const [hovered, setHovered] = useState(false);

  const handlePointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    // Keep the press away from the panel (context menu, row drag) and out of text selection.
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { pointerId: event.pointerId, startX: event.clientX, startWidth: width };
    latestWidthRef.current = width;
    setDragging(true);
  }, [width]);

  const handlePointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (drag == null || drag.pointerId !== event.pointerId) return;
    latestWidthRef.current = drag.startWidth + (event.clientX - drag.startX);
    onWidthChange(latestWidthRef.current);
  }, [onWidthChange]);

  const handlePointerUp = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (drag == null || drag.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    // One write per drag: the store is a real file. (`lostpointercapture` may call this a second
    // time; the second call finds no drag and does nothing.)
    dragRef.current = undefined;
    setDragging(false);
    onWidthCommit(latestWidthRef.current);
  }, [onWidthCommit]);

  /** A cancelled drag (a touch interrupted by the system) keeps the stored width: nothing is saved. */
  const handlePointerCancel = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (drag == null || drag.pointerId !== event.pointerId) return;
    // Dropped before releasing, or `lostpointercapture` would take the drag over and commit it.
    dragRef.current = undefined;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    setDragging(false);
    onWidthChange(drag.startWidth);
  }, [onWidthChange]);

  /** The pointer can be released outside the window: capturing is what tells us it is over. */
  const handleLostPointerCapture = useCallback(() => {
    if (dragRef.current == null) return;
    dragRef.current = undefined;
    setDragging(false);
    onWidthCommit(latestWidthRef.current);
  }, [onWidthCommit]);

  const handleDoubleClick = useCallback(() => {
    onWidthCommit(defaultSourceListWidth);
  }, [onWidthCommit]);

  return (
    <>
      {/* Pointer capture routes the events here, but the cursor still follows what is under the
          pointer: a full-window layer keeps it `ew-resize` for the whole drag. */}
      {dragging && <div style={{ position: 'fixed', inset: 0, zIndex: 9999, cursor: 'ew-resize' }} />}
      <div
        role="separator"
        aria-orientation="vertical"
        tabIndex={-1}
        title=""
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onLostPointerCapture={handleLostPointerCapture}
        onPointerEnter={() => setHovered(true)}
        onPointerLeave={() => setHovered(false)}
        onDoubleClick={handleDoubleClick}
        onContextMenu={(event) => event.stopPropagation()}
        style={{
          position: 'absolute',
          top: 0,
          right: 0,
          bottom: 0,
          width: sourceListResizeHandleWidth,
          cursor: 'ew-resize',
          touchAction: 'none',
          zIndex: 2,
        }}
      >
        {/* A hairline that only shows itself when the user is on the strip: the panel's edge is
            part of the video's frame, a permanent line there would read as a border. */}
        <div style={{ position: 'absolute', top: 0, bottom: 0, right: 0, width: 2, background: hovered || dragging ? primaryColor : 'transparent' }} />
      </div>
    </>
  );
}
