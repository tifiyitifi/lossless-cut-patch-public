import { usePatchSession } from '../session/patchSessionContext';
import usePatchActions from '../actions/usePatchActions';
import usePatchKeyboard from './usePatchKeyboard';

/**
 * Hosts the global patch keyboard layer. Rendered inside PatchSessionProvider (not inside a dockview
 * panel) so shortcuts keep working even when the player panel is unmounted / collapsed.
 *
 * The action table itself lives in `usePatchActions`, shared with the console and the palette; the
 * bindings come from the session so the key-binding editor takes effect immediately.
 */
export default function PatchKeyboard() {
  const { patchKeyBindings } = usePatchSession();
  const handlers = usePatchActions();
  usePatchKeyboard({ bindings: patchKeyBindings, handlers });

  return null;
}
