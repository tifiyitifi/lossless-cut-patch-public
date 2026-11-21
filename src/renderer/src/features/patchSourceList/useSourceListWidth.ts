import { useCallback, useState } from 'react';

import { clampSourceListWidth, defaultSourceListWidth } from '../../../../common/features/patchData/sourceList';
import patchConfig from './patchConfigApi';

/**
The source list's width (patch, fork-owned).

Stored in the patch settings (`patch-config.json`), not in the upstream config: the panel layout is
patch furniture, and base mode must keep its fixed sidebar (which is why the store is not even
opened when this is disabled).

The stored value is clamped whenever it is read or written (`clampSourceListWidth`): the file is
plain text, and a `0` there would leave a panel that looks empty but is still "open" - no command
could bring it back, because nothing knows it is broken.
*/
export default function useSourceListWidth(enabled: boolean) {
  const [width, setWidthState] = useState(() => (enabled ? clampSourceListWidth(patchConfig.getPatchSetting('sourceListWidth')) : defaultSourceListWidth));

  /** While the user drags: rendered size only, nothing is written. */
  const setWidth = useCallback((next: number) => {
    setWidthState(clampSourceListWidth(next));
  }, []);

  /** On release: the value the next start reads. Written once per drag, not once per pixel. */
  const commitWidth = useCallback((next: number) => {
    if (!enabled) return;
    const clamped = clampSourceListWidth(next);
    setWidthState(clamped);
    patchConfig.setPatchSetting('sourceListWidth', clamped);
  }, [enabled]);

  return { width, setWidth, commitWidth };
}
