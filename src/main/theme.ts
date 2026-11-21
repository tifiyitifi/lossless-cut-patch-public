// eslint-disable-next-line import-js/no-extraneous-dependencies
import { nativeTheme } from 'electron';

/**
The background colour of the app's windows (fork-owned).

The main window has always painted itself with the current theme before the renderer draws
anything, so a dark theme does not start as a white flash. The results windows and the deletion check
are separate windows with their own background, so they use the same value instead of a hardcoded
colour. `nativeTheme` follows the `theme` setting (main sets `nativeTheme.themeSource`), which is also
what `prefers-color-scheme` reports to their renderers.
*/
export const getBackgroundColor = () => (nativeTheme.shouldUseDarkColors ? '#333' : '#fff');
