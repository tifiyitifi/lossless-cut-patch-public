import type { KeyboardEventHandler } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { legacyPatchCommands, patchFlowIntents } from '../../../../../common/features/patchCommand';
import type { PatchIntent } from '../../../../../common/features/patchCommand';
import { allPatchActions, defaultPatchKeyBindings, getPatchKeyLabelForAction } from '../../../../../common/features/patchData';
import usePatchIntentRunner from '../actions/usePatchIntentRunner';
import usePatchCommandLabels from './usePatchCommandLabels';

interface PaletteItem {
  name: string;
  intent: PatchIntent;
  label: string;
  hint: string | undefined;
}

/** `Ctrl+Shift+P` command palette: searchable list of actions and legacy codes. */
export default function CommandPalette({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const runIntent = usePatchIntentRunner();
  const labels = usePatchCommandLabels();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const items = useMemo<PaletteItem[]>(() => {
    // Intents that a legacy code already covers are not repeated as separate entries.
    const legacyIntents = new Set(legacyPatchCommands.map((command) => command.intent));
    return [
      ...allPatchActions.map((action): PaletteItem => ({
        name: action,
        intent: action,
        label: labels.intents[action],
        hint: getPatchKeyLabelForAction(defaultPatchKeyBindings, action),
      })),
      ...legacyPatchCommands.map((command): PaletteItem => ({
        name: command.code,
        intent: command.intent,
        label: labels.intents[command.intent],
        hint: command.code,
      })),
      ...patchFlowIntents
        .filter((intent) => !legacyIntents.has(intent))
        .map((intent): PaletteItem => ({
          name: intent,
          intent,
          label: labels.intents[intent],
          hint: undefined,
        })),
    ];
  }, [labels]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle === '') return items;
    return items.filter((item) => item.name.toLowerCase().includes(needle) || item.label.toLowerCase().includes(needle));
  }, [items, query]);

  const run = useCallback((item: PaletteItem | undefined) => {
    if (item == null) return;
    runIntent(item.intent);
    onClose();
  }, [onClose, runIntent]);

  const onKeyDown = useCallback<KeyboardEventHandler<HTMLInputElement>>((event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setSelected((index) => Math.min(index + 1, filtered.length - 1));
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setSelected((index) => Math.max(index - 1, 0));
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      run(filtered[selected]);
    }
  }, [filtered, onClose, run, selected]);

  return (
    <div
      role="presentation"
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}
      style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', justifyContent: 'center', alignItems: 'flex-start', paddingTop: '12vh', background: 'rgba(0, 0, 0, .35)' }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('Command palette')}
        style={{ width: 'min(560px, 92vw)', maxHeight: '70vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--gray-2)', border: '1px solid var(--gray-7)', borderRadius: '8px', boxShadow: '0 8px 32px rgba(0, 0, 0, .4)' }}
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => { setQuery(event.target.value); setSelected(0); }}
          onKeyDown={onKeyDown}
          placeholder={t('Type a command')}
          spellCheck={false}
          style={{ border: 'none', borderBottom: '1px solid var(--gray-6)', background: 'transparent', color: 'inherit', padding: '.6em .8em', fontSize: '1em', outline: 'none' }}
        />
        <div style={{ overflow: 'auto' }}>
          {filtered.length === 0 && <div style={{ padding: '.6em .8em', opacity: 0.6 }}>{t('No matching commands.')}</div>}
          {filtered.map((item, index) => (
            <button
              key={`${item.name}:${item.intent}`}
              type="button"
              onMouseEnter={() => setSelected(index)}
              onClick={() => run(item)}
              style={{ display: 'flex', alignItems: 'center', gap: '.6em', width: '100%', textAlign: 'left', border: 'none', cursor: 'pointer', padding: '.4em .8em', fontSize: '.9em', color: 'inherit', background: index === selected ? 'var(--accent-5)' : 'transparent' }}
            >
              <span style={{ flexGrow: 1 }}>{item.label}</span>
              <span style={{ opacity: 0.55, fontFamily: 'monospace', fontSize: '.85em' }}>{item.hint}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
