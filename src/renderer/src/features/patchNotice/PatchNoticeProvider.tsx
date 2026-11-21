import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import type { PatchNoticeId } from '../../../../common/features/patchNotice';
import { isNoticeSuppressed, suppressNotice, unsuppressNotice } from '../../../../common/features/patchNotice';

import patchConfig from './patchConfigApi';

/**
Suppressible patch-mode notices (fork-owned).

The user can silence an informational notice for good: in a batch run the export-finished
message appears once per file, which is noise. A notice that carries a warning is never
silenced - see `shouldShowExportFinishedNotice` in `common/features/patchNotice`.

The state lives in `patch-config.json` (`suppressedNotices`), so it survives a restart and stays
out of the base mode's `config.json`.
*/
export interface PatchNoticeContextType {
  /** The ids of the notices the user has silenced. */
  suppressedNotices: readonly string[];
  /** Is this notice silenced? */
  isSuppressed: (id: PatchNoticeId) => boolean;
  /** Silence a notice. */
  suppress: (id: PatchNoticeId) => void;
  /** Un-silence a notice (the "show it again" switch in the settings). */
  unsuppress: (id: PatchNoticeId) => void;
}

const PatchNoticeContext = createContext<PatchNoticeContextType | undefined>(undefined);

export function PatchNoticeProvider({ children }: { children: ReactNode }) {
  const [suppressedNotices, setSuppressedNotices] = useState<readonly string[]>(() => patchConfig.getPatchSetting('suppressedNotices') ?? []);

  const isSuppressed = useCallback((id: PatchNoticeId) => isNoticeSuppressed(suppressedNotices, id), [suppressedNotices]);

  const suppress = useCallback((id: PatchNoticeId) => {
    setSuppressedNotices((current) => {
      const next = suppressNotice(current, id);
      // An empty list is written as "unset", so the config file stays free of empty leftovers.
      patchConfig.setPatchSetting('suppressedNotices', next.length > 0 ? next : undefined);
      return next;
    });
  }, []);

  const unsuppress = useCallback((id: PatchNoticeId) => {
    setSuppressedNotices((current) => {
      const next = unsuppressNotice(current, id);
      patchConfig.setPatchSetting('suppressedNotices', next.length > 0 ? next : undefined);
      return next;
    });
  }, []);

  const value = useMemo<PatchNoticeContextType>(() => ({ suppressedNotices, isSuppressed, suppress, unsuppress }), [isSuppressed, suppress, suppressedNotices, unsuppress]);

  return <PatchNoticeContext.Provider value={value}>{children}</PatchNoticeContext.Provider>;
}

/** The patch notice state. Returns `undefined` outside the patch shell (base mode). */
export function usePatchNotice() {
  return useContext(PatchNoticeContext);
}
