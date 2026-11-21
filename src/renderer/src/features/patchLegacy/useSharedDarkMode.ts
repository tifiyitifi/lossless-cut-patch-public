import { useState } from 'react';

const remote = window.require('@electron/remote');
const { configStore } = remote.require('./index.js');

/** Read the shared darkMode setting (upstream config). */
export default function useSharedDarkMode(): boolean {
  const [darkMode] = useState<boolean>(() => configStore.get('darkMode') ?? true);
  return darkMode;
}
