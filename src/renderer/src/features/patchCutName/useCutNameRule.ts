import { useCallback, useState } from 'react';

import {
  defaultCutLabelSeparator, defaultCutNameRule, parseCutLabelSeparator, parseCutNameRule,
} from '../../../../common/features/patchData/cutName';
import patchConfig from './patchConfigApi';

/**
The cut results' naming rule of the current session (fork-owned).

Its own rule (`cutNameRule`), not the merged result's `mergedNameRule`: the cut results and the
file they are merged into are two different files, and giving them the same rule is what makes
them collide in the work area. Stored in `patch-config.json` because the `{token}` syntax is
patch-only; base mode keeps the upstream `outSegTemplate`. A hand-edited or older value falls back
to the default instead of breaking the export.
*/
export default function useCutNameRule() {
  const [rule, setRuleState] = useState<string>(() => parseCutNameRule(patchConfig.getPatchSetting('cutNameRule')));
  const [labelSeparator, setLabelSeparatorState] = useState<string>(
    () => parseCutLabelSeparator(patchConfig.getPatchSetting('cutLabelSeparator')),
  );

  const setRule = useCallback((value: string) => {
    setRuleState(value);
    patchConfig.setPatchSetting('cutNameRule', value);
  }, []);

  const setLabelSeparator = useCallback((value: string) => {
    setLabelSeparatorState(value);
    patchConfig.setPatchSetting('cutLabelSeparator', value);
  }, []);

  return {
    rule,
    setRule,
    labelSeparator,
    setLabelSeparator,
    defaultRule: defaultCutNameRule,
    defaultLabelSeparator: defaultCutLabelSeparator,
  };
}
