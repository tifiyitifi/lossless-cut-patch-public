import type { SweetAlertOptions } from 'sweetalert2';

import { primaryColor } from '../../colors';

/*
 * The fork's SweetAlert button styling (fork-owned).
 *
 * A pure module on purpose: the dialogs that use it import `swal.ts` (and with it the i18n backend
 * and `window`), so the colour decision lives here where it can be unit tested.
 */

/**
Make the deny button a non-destructive second choice.

SweetAlert2 paints a deny button red, which is right for a "do it anyway" that discards or
replaces something. A deny button that only opens another folder - or offers some other harmless
alternative - must not warn the user: it gets the confirm button's colour (the theme's primary
colour, see `colors.ts` / `swal2.scss`), so the two choices read as equals and only `Cancel`
stays neutral.

The caller still asks for the button itself (`showDenyButton: true`, `denyButtonText`).
*/
export default function withNonDestructiveDeny(options: SweetAlertOptions): SweetAlertOptions {
  return { ...options, denyButtonColor: primaryColor };
}
