import type { KeyboardEventHandler } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { usePatchUi } from '../ui/patchUiContext';
import usePatchConsole from './usePatchConsole';
import type { ConsoleEntry } from './usePatchConsole';

const entryColors: Record<ConsoleEntry['kind'], string | undefined> = {
  input: 'var(--cyan-11)',
  output: undefined,
  error: 'var(--red-11)',
};

/** Column 2, row 2: command console. Accepts legacy codes and patch action ids. */
export default function ConsolePanel() {
  const { t } = useTranslation();
  const { focusedPanelId } = usePatchUi();
  const { entries, history, execute } = usePatchConsole();
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const historyIndexRef = useRef<number | undefined>(undefined);

  // Autofocus the prompt when the panel becomes the active one (e.g. after `:`).
  useEffect(() => {
    if (focusedPanelId === 'console') inputRef.current?.focus();
  }, [focusedPanelId]);

  // Keep the newest output visible.
  useEffect(() => {
    const log = logRef.current;
    if (log != null) log.scrollTop = log.scrollHeight;
  }, [entries]);

  const onKeyDown = useCallback<KeyboardEventHandler<HTMLInputElement>>((event) => {
    // Modified keys are owned by the app-level shortcuts (Alt+Arrow panel navigation,
    // Ctrl+Shift+P palette); the console only handles plain keys.
    if (event.altKey || event.ctrlKey || event.metaKey) return;

    if (event.key === 'Enter') {
      event.preventDefault();
      execute(value);
      setValue('');
      historyIndexRef.current = undefined;
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      const { current } = historyIndexRef;
      const index = current == null ? history.length - 1 : Math.max(0, current - 1);
      const previous = history[index];
      if (previous != null) {
        setValue(previous);
        historyIndexRef.current = index;
      }
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      const { current } = historyIndexRef;
      if (current == null) return;
      const index = current + 1;
      if (index >= history.length) {
        setValue('');
        historyIndexRef.current = undefined;
      } else {
        setValue(history[index] ?? '');
        historyIndexRef.current = index;
      }
    }
  }, [execute, history, value]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', fontFamily: 'monospace', fontSize: '.85em' }}>
      <div ref={logRef} style={{ flexGrow: 1, minHeight: 0, overflow: 'auto', padding: '.3em .5em' }}>
        {entries.length === 0 && (
          <div style={{ opacity: 0.5 }}>{t('Type a command, e.g. xc or cut. Type help for the list.')}</div>
        )}
        {entries.map((entry) => (
          <div
            key={entry.id}
            style={{
              color: entryColors[entry.kind],
              whiteSpace: 'pre-wrap',
            }}
          >
            {entry.kind === 'input' ? `> ${entry.text}` : entry.text}
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: '.3em', alignItems: 'center', borderTop: '1px solid var(--gray-6)', padding: '.25em .5em', flexShrink: 0 }}>
        <span style={{ opacity: 0.6 }}>:</span>
        <input
          ref={inputRef}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder={t('Command')}
          spellCheck={false}
          style={{ flexGrow: 1, background: 'transparent', border: 'none', color: 'inherit', fontFamily: 'inherit', fontSize: 'inherit', outline: 'none' }}
        />
      </div>
    </div>
  );
}
