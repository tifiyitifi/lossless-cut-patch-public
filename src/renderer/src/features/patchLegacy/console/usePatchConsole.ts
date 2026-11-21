import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { legacyPatchCommands, parsePatchCommand } from '../../../../../common/features/patchCommand';
import { allPatchActions } from '../../../../../common/features/patchData';
import usePatchIntentRunner from '../actions/usePatchIntentRunner';
import usePatchCommandLabels from './usePatchCommandLabels';

export interface ConsoleEntry {
  id: number;
  kind: 'input' | 'output' | 'error';
  text: string;
}

export interface PatchConsole {
  entries: ConsoleEntry[];
  /** Command history, oldest first. */
  history: string[];
  execute: (input: string) => void;
  clear: () => void;
}

/** Console state + execution. Legacy codes and action ids both resolve to a patch intent. */
export default function usePatchConsole(): PatchConsole {
  const { t } = useTranslation();
  const runIntent = usePatchIntentRunner();
  const labels = usePatchCommandLabels();
  const [entries, setEntries] = useState<ConsoleEntry[]>([]);
  const [history, setHistory] = useState<string[]>([]);
  const nextIdRef = useRef(1);

  const append = useCallback((kind: ConsoleEntry['kind'], text: string) => {
    const id = nextIdRef.current;
    nextIdRef.current += 1;
    setEntries((previous) => [...previous, { id, kind, text }]);
  }, []);

  const printHelp = useCallback(() => {
    append('output', t('Legacy codes:'));
    for (const command of legacyPatchCommands) {
      append('output', t('{{command}} — {{description}}', { command: command.code, description: labels.intents[command.intent] }));
    }
    append('output', t('Actions:'));
    for (const action of allPatchActions) {
      append('output', t('{{command}} — {{description}}', { command: action, description: labels.intents[action] }));
    }
  }, [append, labels, t]);

  const execute = useCallback((input: string) => {
    const text = input.trim();
    if (text.length === 0) return;

    append('input', text);
    setHistory((previous) => [...previous, text]);

    const result = parsePatchCommand(text);
    if (!result.ok) {
      append('error', result.error === 'empty'
        ? t('Empty command')
        : t('Unknown command: {{command}}', { command: result.name }));
      return;
    }

    const { intent, name } = result.command;

    if (intent === 'help') { printHelp(); return; }
    if (intent === 'clear') { setEntries([]); return; }

    const outcome = runIntent(intent, result.command.args);
    if (!outcome.ok) {
      append('error', t('Not available yet: {{command}}', { command: name }));
      return;
    }
    append('output', t('Done: {{command}}', { command: name }));
  }, [append, printHelp, runIntent, t]);

  const clear = useCallback(() => setEntries([]), []);

  return { entries, history, execute, clear };
}
