import { useCallback, useEffect, useRef, useState } from 'react';

import { parseRememberedPlaybackRate, planPlaybackRateToggle } from '../../../../common/features/patchTransport/playbackRate';
import patchConfig from './patchConfigApi';

/**
The last non-1x playback speed the user chose, remembered across restarts (fork-owned).

Stored in `patch-config.json` (`rememberedPlaybackRate`), because the `Z` toggle is
patch behaviour and must not show up in the upstream `config.json`. A hand-edited or
older value falls back to 1x instead of breaking playback.

Writes are debounced: holding a speed key fires many rate changes in a row, and only
the final one is worth persisting. The toggle (`Z`) writes immediately, because it is
a single deliberate press and the remembered rate is exactly what it just established.
*/
export default function usePlaybackRateMemory() {
  const [rememberedRate, setRememberedRate] = useState<number>(() => (
    parseRememberedPlaybackRate(patchConfig.getPatchSetting('rememberedPlaybackRate'))
  ));
  const rememberedRateRef = useRef(rememberedRate);
  const writeTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const persist = useCallback((rate: number) => {
    rememberedRateRef.current = rate;
    setRememberedRate(rate);
    patchConfig.setPatchSetting('rememberedPlaybackRate', rate);
  }, []);

  const remember = useCallback((rate: number) => {
    // 1x is not a speed worth remembering: toggling back to it must keep the way back open.
    // A garbage rate is not either (the parser falls it back to 1x).
    if (rate === 1 || parseRememberedPlaybackRate(rate) !== rate) return;
    rememberedRateRef.current = rate;
    setRememberedRate(rate);
    if (writeTimerRef.current != null) clearTimeout(writeTimerRef.current);
    writeTimerRef.current = setTimeout(() => {
      patchConfig.setPatchSetting('rememberedPlaybackRate', rememberedRateRef.current);
    }, 300);
  }, []);

  const toggle = useCallback((currentRate: number, applyRate: (rate: number) => void) => {
    const plan = planPlaybackRateToggle({ currentRate, rememberedRate: rememberedRateRef.current });
    applyRate(plan.rate);
    if (plan.rememberedRate !== rememberedRateRef.current) {
      if (writeTimerRef.current != null) {
        clearTimeout(writeTimerRef.current);
        writeTimerRef.current = undefined;
      }
      persist(plan.rememberedRate);
    }
  }, [persist]);

  useEffect(() => () => {
    if (writeTimerRef.current != null) clearTimeout(writeTimerRef.current);
    // Flush a debounced write: the app may be closing while the timer is still pending.
    if (rememberedRateRef.current !== 1) patchConfig.setPatchSetting('rememberedPlaybackRate', rememberedRateRef.current);
  }, []);

  return { rememberedRate, remember, toggle };
}
