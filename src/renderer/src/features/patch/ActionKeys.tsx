import { Fragment } from 'react';
import { useTranslation } from 'react-i18next';

import Kbd from '../../components/Kbd';
import { splitKeyboardKeys } from '../../util';
import type { KeyBinding } from '../../../../common/types';

/**
The keys of one action as key caps (fork-owned).

Patch mode can bind more than one key to the same action: `Shift+Alt+Left` marks the in point
exactly like `I`, and both stay bound. Every binding of the action is therefore shown, joined by
"or", so the help never hides a key that works.

The keys are never hardcoded: they follow the user's bindings (and the patch-mode remap).
*/
export default function ActionKeys({ keyBindings, action }: { keyBindings: readonly KeyBinding[], action: string }) {
  const { t } = useTranslation();
  const keysList = keyBindings.filter((binding) => binding.action === action).map((binding) => binding.keys);

  if (keysList.length === 0) {
    return <kbd>{t('Unbound')}</kbd>;
  }

  return (
    <>
      {keysList.map((keys, comboIndex) => {
        const split = splitKeyboardKeys(keys);
        return (
          <Fragment key={keys}>
            {comboIndex > 0 && <span style={{ fontSize: '.8em', margin: '0 .2em' }}>{t('or')}</span>}
            {split.map((key, i) => (
              <Fragment key={key}>
                <Kbd code={key} />
                {i < split.length - 1 && <span style={{ fontSize: '.7em', marginLeft: '-.2em', marginRight: '-.2em' }}>{' + '}</span>}
              </Fragment>
            ))}
          </Fragment>
        );
      })}
    </>
  );
}
