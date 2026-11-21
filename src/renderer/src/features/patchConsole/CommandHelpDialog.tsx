import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { isUnwiredIntent, legacyPatchCommands, patchFlowIntents } from '../../../../common/features/patchCommand';
import type { PatchIntent, PatchUserAlias } from '../../../../common/features/patchCommand';

import * as Dialog from '../../components/Dialog';
import { defaultPatchWorkDirName } from '../../../../common/features/patchWork';
import { usePatchWork } from '../patchWork/PatchWorkProvider';
import { getCommandCandidates } from './commandCandidates';
import getCommandDescription from './commandDescriptions';

const monospace = { fontFamily: 'monospace' } as const;

/**
The `help` popup (fork-owned): what the console can be typed with.

Three sections: the console's own commands (built-in names, their compiled-in short names and the
user's aliases), every base action the console can run by name, and the patch flow intents that
are recognised but still wait for their patch step.
*/
export default function CommandHelpDialog({ isShown, onHide, userAliases, baseActionNames }: {
  isShown: boolean,
  onHide: () => void,
  userAliases: readonly PatchUserAlias[],
  baseActionNames: readonly string[],
}) {
  const { t } = useTranslation();
  const workDirName = usePatchWork()?.dirNames.workDir ?? defaultPatchWorkDirName;
  const consoleCommands = useMemo(() => getCommandCandidates(userAliases), [userAliases]);

  // Flow intents / legacy codes that have no base action behind them yet.
  const unwired = useMemo(() => {
    const fromFlow = patchFlowIntents.filter((intent) => isUnwiredIntent(intent as PatchIntent));
    const fromLegacy = legacyPatchCommands.filter((command) => isUnwiredIntent(command.intent)).map((command) => command.code);
    return [...new Set([...fromFlow, ...fromLegacy])];
  }, []);

  return (
    <Dialog.Root open={isShown} onOpenChange={(open) => !open && onHide()}>
      <Dialog.Portal>
        <Dialog.Overlay />
        <Dialog.Content style={{ width: '46em' }} aria-describedby={undefined}>
          <Dialog.Title>{t('Command help')}</Dialog.Title>

          <div style={{ marginBottom: '.4em', fontWeight: 500 }}>{t('Console commands')}</div>
          <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '1em' }}>
            <tbody>
              {consoleCommands.map((command) => (
                <tr key={command.intent}>
                  <td style={{ ...monospace, paddingRight: '1em' }}>{command.name}</td>
                  <td style={{ ...monospace, color: 'var(--gray-11)', paddingRight: '1em' }}>{command.names.slice(1).join(', ')}</td>
                  <td style={{ color: 'var(--gray-11)' }}>{getCommandDescription(t, command.intent, workDirName)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div style={{ marginBottom: '.4em', fontWeight: 500 }}>{t('Base commands')}</div>
          <div style={{ marginBottom: '.5em', color: 'var(--gray-11)', fontSize: '.9em' }}>{t('Type any base action name to run it.')}</div>
          <div style={{ maxHeight: '12em', overflow: 'auto', ...monospace, fontSize: '.9em', lineHeight: 1.5, color: 'var(--gray-11)', marginBottom: '1em' }}>
            {baseActionNames.join('  ')}
          </div>

          {unwired.length > 0 && (
            <>
              <div style={{ marginBottom: '.4em', fontWeight: 500 }}>{t('Not wired up yet')}</div>
              <div style={{ color: 'var(--gray-11)', fontSize: '.9em' }}>{unwired.join(', ')}</div>
            </>
          )}

          <Dialog.CloseButton />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
