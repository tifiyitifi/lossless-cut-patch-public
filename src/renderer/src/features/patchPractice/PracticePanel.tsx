import { useCallback, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { FaMouse } from 'react-icons/fa';

import type { KeyBinding, KeyboardAction, ModifierKey } from '../../../../common/types';
import { findPracticeGuide, guideRelatedActions, practicePopupModes } from '../../../../common/features/patchPractice';
import type { PracticeGuideId, PracticePopupMode } from '../../../../common/features/patchPractice';

import Kbd from '../../components/Kbd';
import useUserSettings from '../../hooks/useUserSettings';
import { getModifier } from '../../hooks/useTimelineScroll';
import { splitKeyboardKeys } from '../../util';
import type { ActionLabels, GuideCopy } from './practiceCopy';

export interface PracticePanelState {
  guideId: string;
  /** The action whose key opened (or last ran in) this guide. */
  action: KeyboardAction;
}

export interface PracticePosition { x: number, y: number }

/** Keep the panel inside the window, leaving the drag handle reachable. */
function clampPosition(position: PracticePosition) {
  const maxX = Math.max(0, window.innerWidth - 120);
  const maxY = Math.max(0, window.innerHeight - 60);
  return { x: Math.min(Math.max(0, position.x), maxX), y: Math.min(Math.max(0, position.y), maxY) };
}

function Keys({ keys }: { keys: string }) {
  const split = splitKeyboardKeys(keys);
  return (
    <>
      {split.map((key, i) => (
        <span key={key}>
          <Kbd code={key} />
          {i < split.length - 1 && <span style={{ fontSize: '.7em', margin: '0 .15em' }}>+</span>}
        </span>
      ))}
    </>
  );
}

/** One mouse-wheel row: the user's own modifier plus the wheel, then what it does. */
function WheelRow({ modifier, label }: { modifier?: ModifierKey, label: string }) {
  return (
    <tr>
      <td style={{ paddingRight: '1em', whiteSpace: 'nowrap', verticalAlign: 'top' }}>
        {modifier != null && (
          <>
            <kbd>{getModifier(modifier)}</kbd>
            <span style={{ margin: '0 .2em' }}>+</span>
          </>
        )}
        <FaMouse style={{ verticalAlign: 'middle' }} />
      </td>
      <td style={{ color: 'var(--gray-11)' }}>{label}</td>
    </tr>
  );
}

/**
The practice-mode notes panel (fork-owned).

Deliberately not a modal dialog: it stays on screen while the user keeps pressing keys, so the
notes for the current guide act as a reference. It is dragged like the command console and its
position is remembered.
*/
export default function PracticePanel({ state, keyBindings, labels, guides, popupMode, setPopupMode, onRun, onDisable, onClose, position, setPosition, rootRef }: {
  state: PracticePanelState,
  keyBindings: KeyBinding[],
  labels: ActionLabels,
  guides: GuideCopy,
  popupMode: PracticePopupMode,
  setPopupMode: (mode: PracticePopupMode) => void,
  /** Run the action that opened the panel. */
  onRun: () => void,
  onDisable: () => void,
  onClose: () => void,
  position: PracticePosition | undefined,
  setPosition: (value: PracticePosition) => void,
  /** Exposed so the key listener can tell "typing in the panel" from "typing elsewhere". */
  rootRef: RefObject<HTMLDivElement | null>,
}) {
  const { t } = useTranslation();
  const { mouseWheelZoomModifierKey, mouseWheelFrameSeekModifierKey, mouseWheelKeyframeSeekModifierKey } = useUserSettings();
  const panelRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ pointerId: number, offsetX: number, offsetY: number } | undefined>(undefined);
  const [dragged, setDragged] = useState<PracticePosition | undefined>(position);
  const [rulesOpen, setRulesOpen] = useState(true);

  const guide = findPracticeGuide(state.guideId);
  const copy = guide == null
    ? {
      title: labels[state.action] ?? state.action,
      body: t('No notes for this shortcut yet. Open the keyboard shortcuts menu to see every action and its keys.'),
    }
    : guides[state.guideId as PracticeGuideId];

  const bindingsFor = useCallback((action: KeyboardAction) => keyBindings.filter((binding) => binding.action === action), [keyBindings]);

  // Only shortcuts that actually have a key are worth listing. The guide's own triggers are always
  // included, so a key the user binds to one of them shows up here instead of only in "You pressed".
  const related = useMemo(() => (guide == null ? [] : guideRelatedActions(guide)).filter((action) => bindingsFor(action).length > 0), [bindingsFor, guide]);

  // Enter / Escape are the panel's own controls while it is open, which temporarily shadows whatever
  // they are bound to (in patch mode Enter is full screen by default). Both lines below make that
  // visible instead of silently stealing the key. Only the bare key counts: `Shift+Enter` etc. keep working.
  const confirmShadowed = useMemo(() => keyBindings.find((binding) => binding.keys === 'Enter')?.action, [keyBindings]);
  const cancelShadowed = useMemo(() => keyBindings.find((binding) => binding.keys === 'Escape')?.action, [keyBindings]);

  const onHandlePointerDown = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    const panel = panelRef.current;
    if (panel == null) return;
    const rect = panel.getBoundingClientRect();
    dragRef.current = { pointerId: e.pointerId, offsetX: e.clientX - rect.left, offsetY: e.clientY - rect.top };
    e.currentTarget.setPointerCapture(e.pointerId);
  }, []);

  const onHandlePointerMove = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (drag == null || drag.pointerId !== e.pointerId) return;
    setDragged(clampPosition({ x: e.clientX - drag.offsetX, y: e.clientY - drag.offsetY }));
  }, []);

  const onHandlePointerUp = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (drag == null || drag.pointerId !== e.pointerId) return;
    dragRef.current = undefined;
    const panel = panelRef.current;
    if (panel == null) return;
    const rect = panel.getBoundingClientRect();
    setPosition(clampPosition({ x: rect.left, y: rect.top }));
  }, [setPosition]);

  // Default: centered, so the notes are the first thing the user looks at. Dragging pins it where
  // it was left (the drag start already accounts for the centering transform).
  const panelStyle = dragged == null
    ? { left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }
    : { left: dragged.x, top: dragged.y };

  return (
    <div
      ref={(node) => {
        panelRef.current = node;
        // eslint-disable-next-line no-param-reassign
        rootRef.current = node;
      }}
      style={{
        position: 'fixed',
        ...panelStyle,
        zIndex: 1000,
        width: '30em',
        maxWidth: '90vw',
        maxHeight: '80vh',
        overflow: 'auto',
        padding: '.6em .8em 1em',
        border: '.1em solid var(--gray-6)',
        borderRadius: '.5em',
        background: 'var(--gray-1)',
        color: 'var(--gray-12)',
        boxShadow: '0 0 1em .3em var(--black-a2)',
      }}
    >
      <div
        onPointerDown={onHandlePointerDown}
        onPointerMove={onHandlePointerMove}
        onPointerUp={onHandlePointerUp}
        style={{ display: 'flex', alignItems: 'center', gap: '.5em', marginBottom: '.4em', cursor: 'move', userSelect: 'none', touchAction: 'none' }}
      >
        <span style={{ fontWeight: 500 }}>{t('Keyboard practice')}</span>
        <span style={{ flexGrow: 1 }} />
        <span style={{ color: 'var(--gray-11)', fontSize: '.85em' }}>{t('Drag to move')}</span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '.4em', marginBottom: '.6em', color: 'var(--gray-11)', fontSize: '.9em' }}>
        <span>{t('You pressed')}</span>
        {bindingsFor(state.action).map((binding) => <Keys key={binding.keys} keys={binding.keys} />)}
        <span>{labels[state.action] ?? state.action}</span>
      </div>

      <div style={{ fontSize: '1.15em', fontWeight: 500, marginBottom: '.2em' }}>{copy.title}</div>
      <div style={{ marginBottom: '.7em' }}>{copy.body}</div>

      {related.length > 0 && (
        <>
          <div style={{ fontSize: '.9em', color: 'var(--gray-11)', marginBottom: '.2em' }}>{t('Related shortcuts')}</div>
          <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '.7em' }}>
            <tbody>
              {related.map((action) => (
                <tr key={action}>
                  <td style={{ paddingRight: '1em', whiteSpace: 'nowrap', verticalAlign: 'top' }}>
                    {bindingsFor(action).map((binding, i) => (
                      <span key={binding.keys}>
                        {i > 0 && <span style={{ color: 'var(--gray-11)' }}>{' / '}</span>}
                        <Keys keys={binding.keys} />
                      </span>
                    ))}
                  </td>
                  <td style={{ color: 'var(--gray-11)' }}>{labels[action] ?? action}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {/* The transport guide also covers the wheel, which is the same "move around" job. */}
      {guide?.id === 'transport' && (
        <>
          <div style={{ fontSize: '.9em', color: 'var(--gray-11)', marginBottom: '.2em' }}>{t('Mouse wheel')}</div>
          <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '.7em' }}>
            <tbody>
              <WheelRow label={t('Pan timeline')} />
              <WheelRow modifier={mouseWheelZoomModifierKey} label={t('Zoom in/out timeline')} />
              <WheelRow modifier={mouseWheelFrameSeekModifierKey} label={t('Seek one frame')} />
              <WheelRow modifier={mouseWheelKeyframeSeekModifierKey} label={t('Seek one key frame')} />
            </tbody>
          </table>
        </>
      )}

      <div style={{ color: 'var(--gray-11)', fontSize: '.85em', marginBottom: '.5em' }}>
        <div>{t('Click outside, press Enter or the same key again to run the action; Escape cancels. While these notes are open, other keys are ignored.')}</div>
        {confirmShadowed != null && (
          <div>{t('While these notes are open, Enter confirms instead of running "{{action}}".', { action: labels[confirmShadowed] ?? confirmShadowed })}</div>
        )}
        {cancelShadowed != null && (
          <div>{t('While these notes are open, Escape cancels instead of running "{{action}}".', { action: labels[cancelShadowed] ?? cancelShadowed })}</div>
        )}
      </div>

      <div style={{ display: 'flex', gap: '.5em', flexWrap: 'wrap', marginBottom: '.5em' }}>
        <button type="button" onClick={onRun} style={{ padding: '.4em .8em', cursor: 'pointer' }}>{t('Run this action')}</button>
        <button type="button" onClick={onClose} style={{ padding: '.4em .8em', cursor: 'pointer' }}>{t('Close')}</button>
        <button type="button" onClick={onDisable} style={{ padding: '.4em .8em', cursor: 'pointer' }}>{t('Turn off practice mode')}</button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '.2em', color: 'var(--gray-11)', fontSize: '.85em' }}>
        {practicePopupModes.map((mode) => (
          <label key={mode} htmlFor={`practice-popup-mode-${mode}`} style={{ display: 'flex', alignItems: 'center', gap: '.4em', cursor: 'pointer' }}>
            <input id={`practice-popup-mode-${mode}`} type="radio" name="practicePopupMode" checked={popupMode === mode} onChange={() => setPopupMode(mode)} />
            {t(mode === 'per-guide' ? 'Show notes when entering a group' : 'Show notes on every key press')}
          </label>
        ))}
      </div>

      <details open={rulesOpen} onToggle={(e) => setRulesOpen(e.currentTarget.open)} style={{ marginTop: '.6em', color: 'var(--gray-11)', fontSize: '.85em' }}>
        <summary style={{ cursor: 'pointer' }}>{t('How practice mode works')}</summary>
        <ul style={{ margin: '.3em 0 0', paddingLeft: '1.2em', lineHeight: 1.5 }}>
          <li>{t('Every key belongs to a group of related shortcuts.')}</li>
          <li>{t('The first key you press in a group shows these notes instead of running the action.')}</li>
          <li>{t('After that the keys of that group run normally; press a key from another group and come back to see the notes again.')}</li>
          <li>{t('You can choose whether notes appear once per group or on every key press.')}</li>
          <li>{t('Turn practice mode off with the same command, or with the button above.')}</li>
        </ul>
      </details>
    </div>
  );
}
