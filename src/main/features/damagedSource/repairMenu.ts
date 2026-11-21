import { getSourceRepairCopy } from '../../../common/features/damagedSource/index.js';
import type { SourceRepairMenuAction, SourceRepairMenuState } from '../../../common/features/damagedSource/index.js';

/**
The native Tools > Repair menu (fork-owned, main process).

The state belongs to a window (which file is open, what the user chose), but the application menu
is one object for the whole app, so the focused window reports its state here and the menu is
rebuilt from it (`updateMenu` in `index.ts`). Menu items only send intents back to the window
(`SourceRepairMenuAction`); they never write settings themselves.
*/

/** The shape the builder returns. Electron's `MenuItemConstructorOptions`, kept local so the builder is testable without electron. */
export interface RepairMenuItem {
  label?: string;
  type?: 'normal' | 'radio' | 'checkbox' | 'separator';
  checked?: boolean;
  enabled?: boolean;
  click?: () => void;
  submenu?: RepairMenuItem[];
}

let currentState: SourceRepairMenuState | undefined;

/** Remember what the focused window is looking at, then rebuild the menu (`updateMenu`). */
export function setSourceRepairMenuState(state: SourceRepairMenuState | undefined) {
  currentState = state;
}

export function getSourceRepairMenuState() {
  return currentState;
}

/**
Build the `Repair` submenu.

With one kind of damage the problem list is informational (a disabled, checked checkbox): the
playback switch is per file, not per problem, so pretending each problem could be switched on
its own would be a lie. When a second kind arrives this list grows and the switch stays the same.
*/
export function buildSourceRepairMenuItems({ state, t, onAction }: {
  state: SourceRepairMenuState | undefined;
  t: (key: string) => string;
  onAction: (action: SourceRepairMenuAction) => void;
}): RepairMenuItem[] {
  if (state == null) return [{ label: t('No file is open'), enabled: false }];
  if (!state.hasDamage) return [{ label: t('No damage detected in this file'), enabled: false }];

  return [
    {
      label: t('Play this file as stored'),
      type: 'radio',
      checked: !state.repair,
      click: () => onAction({ type: 'playback', repair: false }),
    },
    {
      label: t('Repair this file'),
      type: 'radio',
      checked: state.repair,
      click: () => onAction({ type: 'playback', repair: true }),
    },
    { type: 'separator' },
    {
      label: t('Repair resolution'),
      enabled: state.repair,
      submenu: [
        {
          label: t('Smooth (800 pixels wide)'),
          type: 'radio',
          checked: state.quality === 'smooth',
          enabled: state.repair,
          click: () => onAction({ type: 'quality', quality: 'smooth' }),
        },
        {
          label: t('Original resolution'),
          type: 'radio',
          checked: state.quality === 'original',
          enabled: state.repair,
          click: () => onAction({ type: 'quality', quality: 'original' }),
        },
      ],
    },
    {
      label: t('Repair problem'),
      submenu: state.kinds.map((kind) => {
        const copy = getSourceRepairCopy(kind, t);
        // Informational: the problem was found in the file, not switched on by the playback repair.
        // Following `state.repair` would render "no problem" whenever the user plays the file as stored.
        return { label: copy.title, type: 'checkbox', checked: true, enabled: false };
      }),
    },
    { type: 'separator' },
    {
      label: t('Repair exported clips too'),
      type: 'checkbox',
      checked: state.exportRepair,
      click: () => onAction({ type: 'export', repair: !state.exportRepair }),
    },
  ];
}
