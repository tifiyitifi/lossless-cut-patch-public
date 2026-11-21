import type { MouseEventHandler } from 'react';
import { useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import type { PatchPlayerView } from '../../../../../common/features/patchMerge';
import { usePatchSession } from '../session/patchSessionContext';

/** The `V` view-candidates overlay (used when `patchViewSwitchStyle` is `candidates`). */
export default function ViewSwitchOverlay({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const { playerView, availableViews, setPlayerView } = usePatchSession();

  const viewLabels: Record<PatchPlayerView, string> = {
    source: t('Source video'),
    cut: t('Cut clips'),
    merge: t('Predicted merge video'),
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // The overlay owns the keyboard while open.
      event.stopPropagation();
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [onClose]);

  const onBackdropMouseDown = useCallback<MouseEventHandler<HTMLDivElement>>((event) => {
    if (event.target === event.currentTarget) onClose();
  }, [onClose]);

  const choose = useCallback((view: PatchPlayerView) => {
    setPlayerView(view);
    onClose();
  }, [onClose, setPlayerView]);

  return (
    <div
      role="presentation"
      onMouseDown={onBackdropMouseDown}
      style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', justifyContent: 'center', alignItems: 'flex-start', paddingTop: '14vh', background: 'rgba(0, 0, 0, .3)' }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('Switch view')}
        style={{ minWidth: '240px', display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--gray-2)', border: '1px solid var(--gray-7)', borderRadius: '8px', boxShadow: '0 8px 32px rgba(0, 0, 0, .4)' }}
      >
        {availableViews.map((view) => (
          <button
            key={view}
            type="button"
            onClick={() => choose(view)}
            style={{ display: 'flex', alignItems: 'center', gap: '.5em', border: 'none', cursor: 'pointer', padding: '.5em .9em', textAlign: 'left', fontSize: '.95em', color: 'inherit', background: view === playerView ? 'var(--accent-5)' : 'transparent' }}
          >
            <span style={{ width: '1em' }}>{view === playerView ? '▸' : ''}</span>
            <span>{viewLabels[view]}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
