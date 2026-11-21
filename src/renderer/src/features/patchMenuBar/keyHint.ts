import { pickDisplayKeyBinding } from '../../../../common/features/patchKeys';
import type { KeyBinding } from '../../../../common/types';

/**
The key a patch-mode context menu shows for the menu-bar toggle (fork-owned, pure).

The context menus are native menus, so a hint has to be a plain string instead of the `<ActionKeys>`
key caps the dialogs use. This picks the binding; the caller formats it (the renderer's key-name
formatter needs a `window`). `bindings` must already be the *effective* ones (resolved for patch
mode): a switched-off default must not advertise a key that cannot run.
*/
export function pickMenuBarKey(
  bindings: readonly KeyBinding[],
  { preferMetaKey }: { preferMetaKey: boolean },
): string | undefined {
  return pickDisplayKeyBinding(bindings, 'togglePatchMenuBar', { preferMetaKey })?.keys;
}
