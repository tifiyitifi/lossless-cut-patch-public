import { useSyncExternalStore } from 'react';

/**
Whether the app is in dark mode, for a window that is not part of `App` (fork-owned).

The check panel is a renderer of its own: it never mounts `App`, so it has no `darkMode` from
`useUserSettingsRoot` and no Radix `<Theme>` around it. The answer is the same one the main window
uses, without reading the config again: the main process sets `nativeTheme.themeSource` from the
`theme` setting, and Chromium reports that to every renderer as `prefers-color-scheme` (the same
reason `useUserSettingsRoot` can use `darkModeMediaQuery`). So the effective theme - an explicit
light/dark choice as well as `system` - is already resolved here, and switching it in the main
window updates this window live instead of on the next focus.
*/

const darkModeMediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

function subscribe(onChange: () => void) {
  darkModeMediaQuery.addEventListener('change', onChange);
  return () => { darkModeMediaQuery.removeEventListener('change', onChange); };
}

export default function useAppTheme() {
  return useSyncExternalStore(subscribe, () => darkModeMediaQuery.matches);
}
