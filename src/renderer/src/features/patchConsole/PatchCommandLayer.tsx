import { useCallback, useEffect, useMemo, useRef } from 'react';

import type { KeyBinding, KeyboardAction } from '../../../../common/types';
import { getBaseActionForIntent } from '../../../../common/features/patchCommand';
import type { PatchIntent } from '../../../../common/features/patchCommand';

import useUserSettings from '../../hooks/useUserSettings';
import CommandAliasSettingsDialog from './CommandAliasSettingsDialog';
import CommandConsole from './CommandConsole';
import CommandHelpDialog from './CommandHelpDialog';
import { usePatchConsole } from './PatchConsoleProvider';
import { usePatchPractice } from '../patchPractice/PatchPracticeProvider';
import { usePatchWork } from '../patchWork/PatchWorkProvider';
import { buildBaseActionNames } from './baseActionNames';
import { isEditableTarget, isModifierOnlyEvent, matchesKeyBinding } from '../patch/keyMatch';

const consoleShortcutAction: KeyboardAction = 'togglePatchCommandConsole';

/**
Everything the patch command console needs, mounted by the `App` seam while `patchMode` is on
(fork-owned). The panel state itself lives in `PatchConsoleProvider`, mounted in the patch shell.

`baseActions` is the app's own action map, which is what makes the console able to run any base
feature by name (patch intents are translated through `patchIntentToBaseAction`).
*/
export default function PatchCommandLayer({ keyBindingByAction, baseActions }: {
  keyBindingByAction: Record<string, KeyBinding>,
  baseActions: Record<string, () => void>,
}) {
  const patchConsole = usePatchConsole();
  const patchPractice = usePatchPractice();
  const patchWork = usePatchWork();
  const { commandAliases, setCommandAliases, commandConsolePosition, setCommandConsolePosition } = useUserSettings();

  const toggleCommandConsole = patchConsole?.toggleCommandConsole;
  const shortcutKeys = keyBindingByAction[consoleShortcutAction]?.keys;
  const consoleRootRef = useRef<HTMLDivElement | null>(null);

  const baseActionNames = useMemo(() => buildBaseActionNames(baseActions), [baseActions]);
  const baseActionNamesList = useMemo(() => [...baseActionNames.values()], [baseActionNames]);

  // The upstream keyboard hook only dispatches while `document.body` has focus, so the console
  // listens on its own (capture phase) and stays usable right after clicking the landing drop box.
  useEffect(() => {
    if (toggleCommandConsole == null) return undefined;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat) return;
      // Never react to a bare modifier press: `ShiftLeft` alone must not open the console (it would
      // steal Shift from every other shortcut).
      if (isModifierOnlyEvent(e.code)) return;
      // Ignore typing in other fields, but keep the shortcut working while the console's own input
      // has focus, so the same shortcut closes it again.
      const isConsoleInput = consoleRootRef.current?.contains(e.target as Node) === true;
      if (isEditableTarget(e.target) && !isConsoleInput) return;
      if (!matchesKeyBinding(e, shortcutKeys)) return;
      e.preventDefault();
      e.stopPropagation();
      toggleCommandConsole();
    };
    document.addEventListener('keydown', onKeyDown, { capture: true });
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [shortcutKeys, toggleCommandConsole]);

  const onExecute = useCallback((intent: PatchIntent) => {
    if (patchConsole == null) return false;
    if (intent === 'toggle-batch-files-list') {
      patchConsole.toggleBatchFilesList();
      return true;
    }
    if (intent === 'toggle-command-custom-settings') {
      patchConsole.toggleCommandCustomSettings();
      return true;
    }
    if (intent === 'toggle-work-settings') {
      patchWork?.toggleWorkSettings();
      return patchWork != null;
    }
    if (intent === 'open-workpath-list') {
      patchWork?.toggleWorkPathList();
      return patchWork != null;
    }
    if (intent === 'clear-empty-work-dirs') {
      if (patchWork == null) return false;
      patchWork.clearEmptyWorkDirs().catch((err: unknown) => {
        console.error('Failed to clear empty work folders', err);
      });
      return true;
    }
    if (intent === 'help') {
      patchConsole.setCommandHelpVisible(true);
      return true;
    }
    if (intent === 'toggle-keyboard-practice') {
      patchPractice?.toggle();
      return patchPractice != null;
    }
    // Patch intents go through the mapping; a raw base action name is already the action itself.
    const baseAction = getBaseActionForIntent(intent) ?? baseActionNames.get(intent.toLowerCase());
    if (baseAction == null) return false;
    const run = baseActions[baseAction];
    if (run == null) return false;
    run();
    return true;
  }, [baseActionNames, baseActions, patchConsole, patchPractice, patchWork]);

  if (patchConsole == null) return null;

  return (
    <>
      <CommandConsole
        isShown={patchConsole.commandConsoleVisible}
        onHide={() => patchConsole.setCommandConsoleVisible(false)}
        userAliases={commandAliases}
        onExecute={onExecute}
        position={commandConsolePosition}
        setPosition={setCommandConsolePosition}
        baseActionNames={baseActionNames}
        rootRef={consoleRootRef}
      />
      <CommandAliasSettingsDialog
        isShown={patchConsole.commandCustomSettingsVisible}
        onHide={() => patchConsole.setCommandCustomSettingsVisible(false)}
        userAliases={commandAliases}
        setUserAliases={setCommandAliases}
        reservedNames={baseActionNamesList}
      />
      <CommandHelpDialog
        isShown={patchConsole.commandHelpVisible}
        onHide={() => patchConsole.setCommandHelpVisible(false)}
        userAliases={commandAliases}
        baseActionNames={baseActionNamesList}
      />
    </>
  );
}
