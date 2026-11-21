import { useCallback, useState } from 'react';

import {
  defaultLabelSeparator, defaultMergedNameRule, parseLabelSeparator, parseMergedNameRule,
} from '../../../../common/features/patchData/mergedName';
import patchConfig from './patchConfigApi';

/**
The merged result's naming rule of the current session (fork-owned).

Stored in `patch-config.json`: the `{token}` rule is patch-only, so it must not show up in the
upstream `config.json` (nor in the generated user-settings docs) and base mode keeps its own
`cutMergedFileTemplate`. A hand-edited or older value falls back to the default instead of
breaking the merge.
*/
export default function useMergedNameRule() {
  const [rule, setRuleState] = useState<string>(() => parseMergedNameRule(patchConfig.getPatchSetting('mergedNameRule')));
  const [labelSeparator, setLabelSeparatorState] = useState<string>(() => parseLabelSeparator(patchConfig.getPatchSetting('labelSeparator')));

  const setRule = useCallback((value: string) => {
    setRuleState(value);
    patchConfig.setPatchSetting('mergedNameRule', value);
  }, []);

  const setLabelSeparator = useCallback((value: string) => {
    setLabelSeparatorState(value);
    patchConfig.setPatchSetting('labelSeparator', value);
  }, []);

  return {
    rule,
    setRule,
    labelSeparator,
    setLabelSeparator,
    defaultRule: defaultMergedNameRule,
    defaultLabelSeparator,
  };
}
