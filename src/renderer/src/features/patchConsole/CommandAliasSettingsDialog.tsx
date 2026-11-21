import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { addUserAlias, removeUserAlias, validateAlias } from '../../../../common/features/patchCommand';
import type { AliasValidationError, PatchIntent, PatchUserAlias } from '../../../../common/features/patchCommand';

import * as Dialog from '../../components/Dialog';
import { defaultPatchWorkDirName } from '../../../../common/features/patchWork';
import { usePatchWork } from '../patchWork/PatchWorkProvider';
import { getCommandCandidates } from './commandCandidates';
import getCommandDescription from './commandDescriptions';

/**
Editor for the user's extra console short names (fork-owned).

Built-in commands are listed read-only: their names can never be changed, the user can only add
more names that point at them. Aliases live in the config (`commandAliases`).
*/
export default function CommandAliasSettingsDialog({ isShown, onHide, userAliases, setUserAliases, reservedNames }: {
  isShown: boolean,
  onHide: () => void,
  userAliases: readonly PatchUserAlias[],
  setUserAliases: (aliases: PatchUserAlias[]) => void,
  /** Upstream action names (only known at runtime), which a user alias may not shadow either. */
  reservedNames: readonly string[],
}) {
  const { t } = useTranslation();
  const workDirName = usePatchWork()?.dirNames.workDir ?? defaultPatchWorkDirName;
  const [newAlias, setNewAlias] = useState('');
  const [newIntent, setNewIntent] = useState<PatchIntent>('toggle-batch-files-list');

  const builtinCommands = useMemo(() => getCommandCandidates([]), []);

  const getValidationMessage = useCallback((error: AliasValidationError) => {
    switch (error) {
      case 'empty': {
        return t('Type a short name');
      }
      case 'tooLong': {
        return t('The short name is too long');
      }
      case 'invalidCharacters': {
        return t('Use lower-case letters, digits, - and _ only');
      }
      case 'reserved': {
        return t('This name is already used by a built-in command');
      }
      case 'duplicate': {
        return t('You already use this short name');
      }
      default: {
        return undefined;
      }
    }
  }, [t]);

  const validationError = useMemo(() => (newAlias.trim() === '' ? undefined : validateAlias(newAlias, userAliases, reservedNames)), [newAlias, reservedNames, userAliases]);
  const canAdd = newAlias.trim() !== '' && validationError == null;

  const onAdd = useCallback(() => {
    if (!canAdd) return;
    setUserAliases(addUserAlias(userAliases, newAlias, newIntent, reservedNames));
    setNewAlias('');
  }, [canAdd, newAlias, newIntent, reservedNames, setUserAliases, userAliases]);

  const onRemove = useCallback((alias: string) => {
    setUserAliases(removeUserAlias(userAliases, alias));
  }, [setUserAliases, userAliases]);

  return (
    <Dialog.Root open={isShown} onOpenChange={(open) => !open && onHide()}>
      <Dialog.Portal>
        <Dialog.Overlay />
        <Dialog.Content style={{ width: '40em' }} aria-describedby={undefined}>
          <Dialog.Title>{t('Command console aliases')}</Dialog.Title>
          <Dialog.Description>{t('Add your own short names for the built-in commands. Built-in names cannot be changed.')}</Dialog.Description>

          <div style={{ marginBottom: '.4em', fontWeight: 500 }}>{t('Built-in commands')}</div>
          <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '1em' }}>
            <tbody>
              {builtinCommands.map((command) => (
                <tr key={command.intent}>
                  <td style={{ fontFamily: 'monospace', paddingRight: '1em' }}>{command.name}</td>
                  <td style={{ fontFamily: 'monospace', color: 'var(--gray-11)', paddingRight: '1em' }}>{command.names.slice(1).join(', ')}</td>
                  <td style={{ color: 'var(--gray-11)' }}>{getCommandDescription(t, command.intent, workDirName)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div style={{ marginBottom: '.4em', fontWeight: 500 }}>{t('Your short names')}</div>
          {userAliases.length === 0 && <div style={{ color: 'var(--gray-11)', marginBottom: '.5em' }}>{t('You have not added any short name yet')}</div>}
          {userAliases.length > 0 && (
            <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '.5em' }}>
              <tbody>
                {userAliases.map((entry) => (
                  <tr key={entry.alias}>
                    <td style={{ fontFamily: 'monospace', paddingRight: '1em' }}>{entry.alias}</td>
                    <td style={{ fontFamily: 'monospace', color: 'var(--gray-11)', paddingRight: '1em' }}>{entry.intent}</td>
                    <td style={{ textAlign: 'right' }}>
                      <button type="button" onClick={() => onRemove(entry.alias)} style={{ background: 'transparent', border: 'none', color: 'inherit', cursor: 'pointer', textDecoration: 'underline' }}>
                        {t('Remove')}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <div style={{ display: 'flex', gap: '.5em', alignItems: 'center', marginTop: '.5em' }}>
            <input
              value={newAlias}
              onChange={(e) => setNewAlias(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') onAdd(); }}
              placeholder={t('New short name')}
              spellCheck={false}
              style={{ flexGrow: 1, padding: '.4em .5em', background: 'transparent', border: '.1em solid var(--gray-7)', borderRadius: '.3em', color: 'inherit', font: 'inherit' }}
            />
            <select
              value={newIntent}
              onChange={(e) => setNewIntent(e.target.value as PatchIntent)}
              style={{ padding: '.4em .5em', background: 'transparent', border: '.1em solid var(--gray-7)', borderRadius: '.3em', color: 'inherit', font: 'inherit' }}
            >
              {builtinCommands.map((command) => <option key={command.intent} value={command.intent}>{command.name}</option>)}
            </select>
            <button type="button" disabled={!canAdd} onClick={onAdd} style={{ padding: '.4em .8em', cursor: canAdd ? 'pointer' : 'default' }}>
              {t('Add')}
            </button>
          </div>

          {validationError != null && <div style={{ marginTop: '.4em', color: 'var(--red-11)' }}>{getValidationMessage(validationError)}</div>}

          <Dialog.CloseButton />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
