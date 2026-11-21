import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent, RefObject } from 'react';
import { useTranslation } from 'react-i18next';

import { parsePatchCommand } from '../../../../common/features/patchCommand';
import type { PatchIntent, PatchUserAlias } from '../../../../common/features/patchCommand';

import { completeCommandInput, filterCommandCandidates, getCommandCandidates, getCommandCompletionTerm, getCommandHint, getCommandQuery } from './commandCandidates';
import type { BaseActionNames } from './baseActionNames';

export interface ConsolePosition { x: number, y: number }

/** Keep the panel inside the window, leaving the drag handle reachable. */
function clampPosition(position: ConsolePosition) {
  const maxX = Math.max(0, window.innerWidth - 120);
  const maxY = Math.max(0, window.innerHeight - 60);
  return { x: Math.min(Math.max(0, position.x), maxX), y: Math.min(Math.max(0, position.y), maxY) };
}

/**
The console panel. The parent only mounts it while the console is open, so its input always
starts empty and a dragged position always starts from the remembered one.
*/
function CommandConsolePanel({ onHide, userAliases, onExecute, position, setPosition, baseActionNames, rootRef }: {
  onHide: () => void,
  userAliases: readonly PatchUserAlias[],
  /** Returns false when the command is understood but not available in this build. */
  onExecute: (intent: PatchIntent) => boolean,
  position: ConsolePosition | undefined,
  setPosition: (value: ConsolePosition) => void,
  baseActionNames: BaseActionNames,
  /** Exposed so the shortcut can still toggle the console closed while its input has focus. */
  rootRef: RefObject<HTMLDivElement | null>,
}) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ pointerId: number, offsetX: number, offsetY: number } | undefined>(undefined);
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [dragged, setDragged] = useState<ConsolePosition | undefined>(position);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Not a modal: clicking anywhere outside the panel closes it.
  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      if (panelRef.current?.contains(e.target as Node) === true) return;
      onHide();
    };
    document.addEventListener('pointerdown', onPointerDown, { capture: true });
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [onHide]);

  const candidates = useMemo(() => filterCommandCandidates(getCommandCandidates(userAliases), input), [input, userAliases]);
  const hint = useMemo(() => getCommandHint(input, getCommandCandidates(userAliases)), [input, userAliases]);

  const onInputChange = useCallback((value: string) => {
    setInput(value);
    setError(undefined);
  }, []);

  // Tab completes to the best candidate; there is no visible list (type `help` for the reference).
  const onTab = useCallback(() => {
    const [best] = candidates;
    if (best == null) return;
    // Complete the term the user is typing, not the canonical name: for a multi-word command
    // (`clear empty` → `clear empty work dirs`) the canonical name would eat the typed words.
    onInputChange(completeCommandInput(input, getCommandCompletionTerm(input, best)));
  }, [candidates, input, onInputChange]);

  const submit = useCallback(() => {
    const run = (intent: PatchIntent) => {
      if (onExecute(intent)) onHide();
      else setError(t('This command is not available yet'));
    };
    const result = parsePatchCommand(input, userAliases, baseActionNames);
    if (result.ok) {
      run(result.command.intent);
      return;
    }
    if (result.error === 'empty') {
      onHide();
      return;
    }
    // Not an exact command: accept a unique candidate instead of failing on a half-typed name.
    if (candidates.length === 1) {
      const [candidate] = candidates;
      if (candidate != null) {
        run(candidate.intent);
        return;
      }
    }
    setError(t('Unknown command: {{name}}', { name: getCommandQuery(input) }));
  }, [baseActionNames, candidates, input, onExecute, onHide, t, userAliases]);

  const onKeyDown = useCallback((e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      onTab();
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      submit();
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      onHide();
    }
  }, [onHide, onTab, submit]);

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

  // Default: bottom center. Once dragged, the remembered top-left corner wins.
  const panelStyle = dragged == null
    ? { left: '50%', bottom: '1.5em', transform: 'translateX(-50%)' }
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
        width: '34em',
        maxWidth: '90vw',
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
        <span style={{ fontWeight: 500 }}>{t('Command console')}</span>
        <span style={{ flexGrow: 1 }} />
        <span style={{ color: 'var(--gray-11)', fontSize: '.85em' }}>{t('Drag to move')}</span>
      </div>

      {/* The grey completion hint is drawn by a mirror span behind a transparent input. */}
      <div style={{ position: 'relative', fontSize: '1.1em' }}>
        <span aria-hidden style={{ position: 'absolute', inset: 0, padding: '.4em .5em', whiteSpace: 'pre', pointerEvents: 'none', color: 'var(--gray-9)' }}>
          <span style={{ color: 'transparent' }}>{input}</span>
          {hint}
        </span>
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => onInputChange(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={t('Type a command, then press Enter')}
          spellCheck={false}
          style={{ position: 'relative', width: '100%', boxSizing: 'border-box', padding: '.4em .5em', background: 'transparent', border: '.1em solid var(--gray-7)', borderRadius: '.3em', color: 'inherit', font: 'inherit' }}
        />
      </div>

      {error != null && <div style={{ marginTop: '.4em', color: 'var(--red-11)' }}>{error}</div>}

      <div style={{ marginTop: '.4em', color: 'var(--gray-11)', fontSize: '.85em' }}>{t('Type help for the command list')}</div>
    </div>
  );
}

/**
Patch command console (fork-owned).

A small floating panel, opened with the `togglePatchCommandConsole` binding (Shift+Space by
default). It sits at the bottom of the window and can be dragged anywhere; the position is
remembered in the config. Enter runs the command, Tab completes it, Escape closes.

It is deliberately not a modal dialog: the panel stays usable while the video plays, and the
upstream keyboard hook is inert while the input has focus (`useKeyboard` only dispatches when
`document.body` is focused), so typing here never triggers the app's own shortcuts.
*/
export default function CommandConsole({ isShown, onHide, userAliases, onExecute, position, setPosition, baseActionNames, rootRef }: {
  isShown: boolean,
  onHide: () => void,
  userAliases: readonly PatchUserAlias[],
  /** Returns false when the command is understood but not available in this build. */
  onExecute: (intent: PatchIntent) => boolean,
  position: ConsolePosition | undefined,
  setPosition: (value: ConsolePosition) => void,
  baseActionNames: BaseActionNames,
  rootRef: RefObject<HTMLDivElement | null>,
}) {
  if (!isShown) return null;
  return <CommandConsolePanel onHide={onHide} userAliases={userAliases} onExecute={onExecute} position={position} setPosition={setPosition} baseActionNames={baseActionNames} rootRef={rootRef} />;
}
