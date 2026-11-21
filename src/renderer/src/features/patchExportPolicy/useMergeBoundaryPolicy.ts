import { useCallback, useState } from 'react';

import { parseMergeBoundaryGuard, parseMergeBoundaryPolicy } from '../../../../common/features/patchExportPolicy';
import type { MergeBoundaryGuard, MergeBoundaryPolicy } from '../../../../common/features/patchExportPolicy';
import patchConfig from './patchConfigApi';

/**
The A/B/C merge boundary policy of the current session (fork-owned).

Stored in `patch-config.json`: it is a patch-mode workflow choice, so it must not show up in the
upstream `config.json` (nor in the generated user-settings docs). A hand-edited or older value
falls back to the default instead of breaking the export.
*/
export default function useMergeBoundaryPolicy() {
  const [policy, setPolicyState] = useState<MergeBoundaryPolicy>(() => (
    parseMergeBoundaryPolicy(patchConfig.getPatchSetting('mergeBoundaryPolicy'))
  ));
  const [guard, setGuardState] = useState<MergeBoundaryGuard>(() => (
    parseMergeBoundaryGuard(patchConfig.getPatchSetting('mergeBoundaryGuard'))
  ));
  // Absent in an older store: the tail fix is on by default.
  const [tailToSourceEnd, setTailToSourceEndState] = useState<boolean>(() => (

    patchConfig.getPatchSetting('tailToSourceEnd')
  ));

  const setPolicy = useCallback((value: MergeBoundaryPolicy) => {
    setPolicyState(value);
    patchConfig.setPatchSetting('mergeBoundaryPolicy', value);
  }, []);

  const setGuard = useCallback((value: MergeBoundaryGuard) => {
    setGuardState(value);
    patchConfig.setPatchSetting('mergeBoundaryGuard', value);
  }, []);

  const setTailToSourceEnd = useCallback((value: boolean) => {
    setTailToSourceEndState(value);
    patchConfig.setPatchSetting('tailToSourceEnd', value);
  }, []);

  return { policy, guard, setPolicy, setGuard, tailToSourceEnd, setTailToSourceEnd };
}
