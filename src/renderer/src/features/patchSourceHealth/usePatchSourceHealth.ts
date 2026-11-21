import { useEffect, useRef, useState } from 'react';
import i18n from 'i18next';

import mainApi from '../../mainApi';
import getSwal from '../../swal';

/**
Probe the source video for a damaged head GOP once per file (fork-owned).

The main process runs a header-only ffprobe and returns the verdict; a damaged file is announced
once with a toast and the export dialog shows the same line again. Base mode never probes.

The result is stored together with the path it belongs to, so switching files resets it without
a state write inside the effect. Returns whether the *current* file is damaged.
*/
export default function usePatchSourceHealth({ patchMode, filePath }: { patchMode: boolean, filePath: string | undefined }) {
  const [health, setHealth] = useState<{ path: string, damaged: boolean } | undefined>(undefined);
  const scannedPathRef = useRef<string | undefined>(undefined);

  const damaged = health != null && health.path === filePath && health.damaged;

  useEffect(() => {
    if (!patchMode || filePath == null) {
      // The next file must be probed again, even if it is the one that was just closed.
      scannedPathRef.current = undefined;
      return undefined;
    }

    // One probe per file: the same path comes back after a rename or an export.
    if (scannedPathRef.current === filePath) return undefined;
    scannedPathRef.current = filePath;

    let cancelled = false;
    mainApi.patchScanSourceHealth({ path: filePath })
      .then((result) => {
        if (cancelled) return;
        const isDamaged = result.health === 'damaged-head-gop';
        setHealth({ path: filePath, damaged: isDamaged });
        if (isDamaged) {
          console.warn('Source video has decode errors at its head', filePath, result.detail);
          getSwal().toast.fire({
            icon: 'warning',
            text: i18n.t('The beginning of this video is damaged (decode errors). No cut can repair those frames; they will stutter or look broken in every player.'),
          });
        }
      })
      .catch((err) => {
        // A probe that cannot run says nothing about the file; stay quiet.
        console.error('Failed to scan the source video', err);
      });

    return () => {
      cancelled = true;
    };
  }, [filePath, patchMode]);

  return damaged;
}
