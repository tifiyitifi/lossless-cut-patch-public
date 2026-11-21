import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import { patchPrivacyLockChangedChannel } from '../../../../common/features/patchPrivacyLock';
import type { PatchHistoryLockResult, PatchHistoryLockStatus } from '../../../../common/features/patchPrivacyLock';

const { ipcRenderer } = window.require('electron');

/**
The renderer side of the work-history privacy lock (fork-owned).

The lock state itself lives in the main process: the idle watcher and the missing-file watcher must
lock even when no window is focused, and every window has to agree. This provider only caches the
status, sends the password actions, and refreshes when the main process announces a change (an idle
lock, a deleted password file, an unlock from another window).
*/

const disabledStatus: PatchHistoryLockStatus = {
  enabled: false,
  unlocked: true,
  filePath: '',
  isDefaultPassword: false,
  events: [],
};

export interface PatchPrivacyLockContextType {
  status: PatchHistoryLockStatus;
  loading: boolean;
  refresh: () => Promise<PatchHistoryLockStatus>;
  unlock: (password: string) => Promise<PatchHistoryLockResult>;
  lock: () => Promise<PatchHistoryLockResult>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<PatchHistoryLockResult>;
  setPassword: (newPassword: string) => Promise<PatchHistoryLockResult>;
}

const PatchPrivacyLockContext = createContext<PatchPrivacyLockContextType | undefined>(undefined);

export function PatchPrivacyLockProvider({ children, enabled = true }: { children: ReactNode, enabled?: boolean }) {
  const [status, setStatus] = useState<PatchHistoryLockStatus>(disabledStatus);
  const [loading, setLoading] = useState(enabled);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const refresh = useCallback(async () => {
    if (!enabled) return disabledStatus;
    try {
      const next = await window.electron.patchPrivacyLockStatus();
      if (mountedRef.current) {
        setStatus(next);
        setLoading(false);
      }
      return next;
    } catch (err) {
      console.error('Failed to read the work-history lock status', err);
      if (mountedRef.current) setLoading(false);
      return disabledStatus;
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    // The status lives in the main process; reading it is the effect's whole purpose.
    // eslint-disable-next-line react/set-state-in-effect -- external status read
    refresh().catch(() => undefined);
  }, [enabled, refresh]);

  // The main process locks on idle or restores the default password when the file was deleted.
  // Both announce themselves, so an open dialog collapses without a poll of its own.
  useEffect(() => {
    if (!enabled) return undefined;
    const onChanged = () => { refresh().catch(() => undefined); };
    ipcRenderer.on(patchPrivacyLockChangedChannel, onChanged);
    return () => { ipcRenderer.off(patchPrivacyLockChangedChannel, onChanged); };
  }, [enabled, refresh]);

  const runAction = useCallback(async (action: () => Promise<PatchHistoryLockResult>): Promise<PatchHistoryLockResult> => {
    try {
      const result = await action();
      // A failed action can still carry a status (a write failure sets `writeFailed`), and the
      // settings must show that warning, not only the inline error.
      if (result.status != null && mountedRef.current) setStatus(result.status);
      return result;
    } catch (err) {
      console.error('The work-history lock action failed', err);
      return { ok: false, reason: 'unavailable' };
    }
  }, []);

  const unlock = useCallback((password: string) => runAction(() => window.electron.patchPrivacyLockUnlock(password)), [runAction]);
  const lock = useCallback(() => runAction(() => window.electron.patchPrivacyLockLock()), [runAction]);
  const changePassword = useCallback((currentPassword: string, newPassword: string) => (
    runAction(() => window.electron.patchPrivacyLockChangePassword({ currentPassword, newPassword }))
  ), [runAction]);
  const setPassword = useCallback((newPassword: string) => runAction(() => window.electron.patchPrivacyLockSetPassword(newPassword)), [runAction]);

  const value = useMemo<PatchPrivacyLockContextType>(() => ({
    status: enabled ? status : disabledStatus,
    loading: enabled ? loading : false,
    refresh,
    unlock,
    lock,
    changePassword,
    setPassword,
  }), [changePassword, enabled, loading, lock, refresh, setPassword, status, unlock]);

  return (
    <PatchPrivacyLockContext.Provider value={value}>
      {children}
    </PatchPrivacyLockContext.Provider>
  );
}

/** The lock status of the surrounding patch shell, or `undefined` outside it (base mode). */
export function usePatchPrivacyLock() {
  return useContext(PatchPrivacyLockContext);
}
