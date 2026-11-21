import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import type { KeyBinding, KeyboardAction } from '../../../../common/types';
import { resolveGuideIdForAction, shouldShowPracticePopup } from '../../../../common/features/patchPractice';

import useUserSettings from '../../hooks/useUserSettings';
import { findMatchingKeyBinding, isEditableTarget, isModifierOnlyEvent, matchesKeyBinding } from '../patch/keyMatch';
import PracticePanel from './PracticePanel';
import { usePatchPractice } from './PatchPracticeProvider';
import { buildActionLabels, buildGuideCopy } from './practiceCopy';
import type { PracticePreviewControl } from './practicePreview';

/** The console shortcut is the escape hatch: it must keep working, or `tkp` could never be typed. */
const consoleShortcutAction: KeyboardAction = 'togglePatchCommandConsole';

/**
Keyboard practice mode (fork-owned).

While practice mode is on, a bound key no longer runs silently the first time its guide is seen:
the guide's notes open instead and the preview is paused. The notes are then *modal* — only bare
Enter (run the pending action), bare Escape (cancel it), a click outside or one of the panel's
buttons resolves them, so nothing runs behind the notes and they keep showing the action they
were opened for. Once the notes are gone, the keys of that guide run normally until another guide
is entered.

The listener runs in the capture phase so it can pre-empt the upstream keyboard hook, which only
dispatches while `document.body` has focus and is therefore not usable from the patch layers.
*/
export default function KeyboardPracticeLayer({ keyBindings, getKeyboardAction, preview, disabledActions }: {
  keyBindings: KeyBinding[],
  getKeyboardAction: (action: KeyboardAction) => (() => boolean) | (() => void),
  preview: PracticePreviewControl,
  /** Actions the window has disabled (the results viewer): do not promise them in the notes. */
  disabledActions?: readonly string[] | undefined,
}) {
  const { t } = useTranslation();
  const practice = usePatchPractice();
  const {
    keyboardPracticePopupMode: popupMode,
    setKeyboardPracticePopupMode: setPopupMode,
    keyboardPracticePosition: position,
    setKeyboardPracticePosition: setPosition,
  } = useUserSettings();

  const panelRef = useRef<HTMLDivElement | null>(null);
  /** The action whose notes are opening. Set synchronously, before React re-renders. */
  const openingActionRef = useRef<KeyboardAction | undefined>(undefined);
  /** Was the preview playing when the notes opened? Restored when the notes resolve. */
  const wasPlayingRef = useRef(false);

  const enabled = practice?.enabled ?? false;
  const panel = practice?.panel;

  const labels = useMemo(() => buildActionLabels(t), [t]);
  const guides = useMemo(() => buildGuideCopy(t), [t]);

  const runAction = useCallback((action: KeyboardAction) => {
    getKeyboardAction(action)();
  }, [getKeyboardAction]);

  const pressAction = useCallback((action: KeyboardAction) => {
    if (practice == null) return;
    // The viewer has disabled this action (it would cut or export): show no notes for a key that
    // cannot do anything.
    if (disabledActions?.includes(action) === true) {
      runAction(action);
      return;
    }
    if (shouldShowPracticePopup(popupMode, action, practice.currentGuideId)) {
      openingActionRef.current = action;
      practice.setCurrentGuideId(resolveGuideIdForAction(action));
      wasPlayingRef.current = preview.isPlaying();
      preview.pause();
      practice.setPanel({ guideId: resolveGuideIdForAction(action), action });
      return;
    }
    runAction(action);
  }, [disabledActions, popupMode, practice, preview, runAction]);

  const runPendingAction = useCallback(() => {
    if (panel == null) return;
    const { action } = panel;
    openingActionRef.current = undefined;
    practice?.setPanel(undefined);
    // Put the preview back *first*, so a play/pause action toggles from the state it had before the
    // notes opened instead of from the pause the notes introduced.
    preview.restore(wasPlayingRef.current);
    runAction(action);
  }, [panel, practice, preview, runAction]);

  const cancelPendingAction = useCallback(() => {
    openingActionRef.current = undefined;
    practice?.setPanel(undefined);
    preview.restore(wasPlayingRef.current);
  }, [practice, preview]);

  const disablePractice = useCallback(() => {
    preview.restore(wasPlayingRef.current);
    practice?.setEnabled(false);
  }, [practice, preview]);

  useEffect(() => {
    if (!enabled) {
      openingActionRef.current = undefined;
      return undefined;
    }

    const consoleKeys = keyBindings.find((binding) => binding.action === consoleShortcutAction)?.keys;

    const onKeyDown = (e: KeyboardEvent) => {
      if (isModifierOnlyEvent(e.code)) return;

      // Never hijack typing, and never fight an open dialog.
      const isInsidePanel = panelRef.current?.contains(e.target as Node) === true;
      if (isEditableTarget(e.target) && !isInsidePanel) return;
      if (e.target instanceof Element && e.target.closest('[role="dialog"]') != null) return;

      // The console shortcut stays live, even while the notes are open: it is the escape hatch.
      if (matchesKeyBinding(e, consoleKeys)) return;

      // The panel state commits a frame after the first press. An auto-repeat that arrives in that
      // gap must not fall through to the real action behind the notes that are about to open.
      if (panel == null && openingActionRef.current != null && e.repeat) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      if (panel != null) {
        const isBare = !e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey;
        if (!e.repeat && isBare && e.code === 'Enter') {
          e.preventDefault();
          e.stopPropagation();
          runPendingAction();
          return;
        }
        if (!e.repeat && isBare && e.code === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          cancelPendingAction();
          return;
        }

        const pressedBinding = findMatchingKeyBinding(e, keyBindings);

        // Pressing the key that opened the notes again is the same as Enter: run it and close.
        if (!e.repeat && pressedBinding != null && pressedBinding.action === panel.action) {
          e.preventDefault();
          e.stopPropagation();
          runPendingAction();
          return;
        }

        // The notes are modal: swallow every other shortcut — modifier combinations and key
        // repeats included — so nothing runs behind them and the notes keep showing the action they
        // were opened for. Keys without a binding (Ctrl+C, F5, ...) are left alone.
        if (pressedBinding != null) {
          e.preventDefault();
          e.stopPropagation();
        }
        return;
      }

      if (e.repeat) return;

      const binding = findMatchingKeyBinding(e, keyBindings);
      if (binding == null) return;

      e.preventDefault();
      e.stopPropagation();
      pressAction(binding.action);
    };

    document.addEventListener('keydown', onKeyDown, { capture: true });
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [cancelPendingAction, enabled, keyBindings, panel, pressAction, runPendingAction]);

  // Clicking anywhere outside the panel closes it and runs the pending action (the user's rule).
  useEffect(() => {
    if (panel == null) return undefined;
    const onPointerDown = (e: PointerEvent) => {
      if (panelRef.current?.contains(e.target as Node) === true) return;
      // Swallow the click: it is the "done, run it" confirmation, not a click on the app.
      e.stopPropagation();
      runPendingAction();
    };
    document.addEventListener('pointerdown', onPointerDown, { capture: true });
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [panel, runPendingAction]);

  if (practice == null || panel == null) return null;

  return (
    <PracticePanel
      state={panel}
      keyBindings={keyBindings}
      labels={labels}
      guides={guides}
      popupMode={popupMode}
      setPopupMode={setPopupMode}
      onRun={runPendingAction}
      onDisable={disablePractice}
      onClose={cancelPendingAction}
      position={position}
      setPosition={setPosition}
      rootRef={panelRef}
    />
  );
}
