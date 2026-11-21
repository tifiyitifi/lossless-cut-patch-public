/**
Permanent switch for the old multi-panel patch UI.

The v1 UI is frozen in `../patchLegacy/`: it is not imported, not type-checked, not linted and
not bundled. This flag documents the intent; enabling the legacy UI would require wiring the
import back and re-including the directory in the build, which is deliberately not supported.

Do not delete `patchLegacy/` unless the user explicitly asks for its removal after the new
patch mode is complete.
*/
// eslint-disable-next-line import/prefer-default-export -- a named flag documents the intent better
export const patchLegacyUiEnabled = false;
