import { memo, useCallback, useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { motion } from 'motion/react';
import Lottie from 'react-lottie-player/dist/LottiePlayerLight';
import { Trans, useTranslation } from 'react-i18next';
import useInterval from 'react-use/lib/useInterval';

import loadingLottie from '../7077-magic-flow.json';
import Button from './Button';
import styles from './Working.module.css';


interface OverlayOffset { x: number, y: number }

/** Keep the whole box inside the window. `applied` is what the box's style already holds. */
function clampOverlayOffset(box: HTMLElement, wanted: OverlayOffset, applied: OverlayOffset): OverlayOffset {
  const rect = box.getBoundingClientRect();
  // `rect` already carries `applied`, so the plain layout position is the difference.
  const baseLeft = rect.left - applied.x;
  const baseTop = rect.top - applied.y;
  const left = Math.min(Math.max(0, baseLeft + wanted.x), Math.max(0, window.innerWidth - rect.width));
  const top = Math.min(Math.max(0, baseTop + wanted.y), Math.max(0, window.innerHeight - rect.height));
  return { x: left - baseLeft, y: top - baseTop };
}

function Working({ text, progress, onAbortClick, patchExportOverlay }: {
  text: string,
  progress?: number | undefined,
  onAbortClick: () => void,
  /**
  patch: the patch export's overlay (see features/patchExportRun).

  The export may run for minutes, and the user may want to keep playing, seeking and scrubbing
  the source while it does - the cut list is locked at the data layer (`useSegments`), not by this
  overlay. So this variant lets the pointer through to the window underneath, and the box itself
  can be dragged out of the way. The dimmed backdrop follows the interaction: clicking the box
  dims the window again, clicking anywhere else fades the dim. Keyboard focus is untouched - the
  app's shortcut hook only dispatches while `document.body` has focus.
  */
  patchExportOverlay?: boolean | undefined,
}) {
  const { t } = useTranslation();

  const [startedAt] = useState(() => new Date());
  const [elapsedMs, setElapsedMs] = useState(0);

  const boxRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ pointerId: number, startX: number, startY: number, origin: OverlayOffset } | undefined>(undefined);
  const [offset, setOffset] = useState<OverlayOffset>({ x: 0, y: 0 });
  const [dimmed, setDimmed] = useState(true);

  // Reassure the user that the app is not frozen
  // This is because some ffmpeg operations can take a long time without giving any progress updates, which might make the user think that the app is frozen
  // https://github.com/mifi/lossless-cut/issues/2746

  useInterval(() => {
    setElapsedMs(Date.now() - startedAt.getTime());
  }, 100);

  // patch: the backdrop dims when the box is being used and fades while the window underneath is.
  // Deliberately not DOM focus: anything focusable would take it off `document.body` and silently
  // disable every keyboard shortcut (see `useKeyboard`).
  useEffect(() => {
    if (patchExportOverlay !== true) return undefined;
    const onPointerDown = (e: PointerEvent) => {
      setDimmed(boxRef.current?.contains(e.target as Node) === true);
    };
    document.addEventListener('pointerdown', onPointerDown, { capture: true });
    return () => document.removeEventListener('pointerdown', onPointerDown, { capture: true });
  }, [patchExportOverlay]);

  const onBoxPointerDown = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (patchExportOverlay !== true || e.button !== 0) return;
    // The Abort button stays a click, not the start of a drag.
    if (e.target instanceof Element && e.target.closest('button') != null) return;
    dragRef.current = { pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, origin: offset };
    e.currentTarget.setPointerCapture(e.pointerId);
  }, [offset, patchExportOverlay]);

  const onBoxPointerMove = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    const box = boxRef.current;
    if (drag == null || box == null || drag.pointerId !== e.pointerId) return;
    const wanted = {
      x: drag.origin.x + (e.clientX - drag.startX),
      y: drag.origin.y + (e.clientY - drag.startY),
    };
    setOffset((current) => clampOverlayOffset(box, wanted, current));
  }, []);

  const onBoxPointerUp = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (drag == null || drag.pointerId !== e.pointerId) return;
    dragRef.current = undefined;
  }, []);

  return (
    <div
      className={patchExportOverlay === true && !dimmed
        ? `${styles['wrapper']} ${styles['wrapperFaded']}`
        : styles['wrapper']}
      style={{
        position: 'absolute',
        bottom: 0,
        top: 0,
        left: 0,
        right: 0,
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        // patch: the export overlay does not swallow clicks meant for the player underneath.
        ...(patchExportOverlay === true && { pointerEvents: 'none' as const }),
      }}
    >
      <motion.div
        ref={boxRef}
        className={styles['loader-box']}
        initial={{ opacity: 0, scale: 0 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0 }}
        style={patchExportOverlay === true ? { position: 'relative', left: offset.x, top: offset.y, pointerEvents: 'auto', cursor: 'move' } : {}}
        onPointerDown={patchExportOverlay === true ? onBoxPointerDown : undefined}
        onPointerMove={patchExportOverlay === true ? onBoxPointerMove : undefined}
        onPointerUp={patchExportOverlay === true ? onBoxPointerUp : undefined}
        onPointerCancel={patchExportOverlay === true ? onBoxPointerUp : undefined}
      >
        <div style={{ width: '10em', height: '5em', marginBottom: '.5em' }}>
          <Lottie
            loop
            animationData={loadingLottie}
            play
            style={{ width: '170%', height: '210%', marginLeft: '-40%', marginTop: '-35%', pointerEvents: 'none' }}
          />
        </div>

        <div style={{ marginBottom: '.2em', textAlign: 'center' }}>
          {text}...
        </div>

        <div style={{ marginBottom: '.5em', fontSize: '.9em', color: 'var(--gray-11)', textAlign: 'center' }}>
          {t('Elapsed: {{seconds}} seconds', { seconds: (elapsedMs / 1000).toFixed(1) })}
        </div>

        {(progress != null) && (
          <div style={{ marginBottom: '.5em', fontSize: '1.3em' }}>
            {`${(progress * 100).toFixed(1)} %`}
          </div>
        )}

        <div>
          <Button onClick={onAbortClick} style={{ fontSize: '1.1em', padding: '.2em 1em' }}><Trans>Abort</Trans></Button>
        </div>
      </motion.div>
    </div>
  );
}

export default memo(Working);
