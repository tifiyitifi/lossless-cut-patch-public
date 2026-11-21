import { useCallback } from 'react';

import type { PatchIntent } from '../../../../../common/features/patchCommand';
import { isPatchSegmentOperation, isPatchFileOperation, isPatchExportFormat, isPatchImportFormat, needsPatchFileOperationParams } from '../../../../../common/features/patchData';
import type { PatchAction } from '../../../../../common/features/patchData';
import { usePatchSession } from '../session/patchSessionContext';
import { usePatchUi } from '../ui/patchUiContext';
import usePatchActions from './usePatchActions';

export type PatchIntentResult = { ok: true } | { ok: false, reason: 'unavailable' };

/**
 * Run a `PatchIntent` (from the console or the palette).
 *
 * Action intents go through `usePatchActions`. Flow intents map onto the session's flow operations.
 * Anything not implemented yet reports `unavailable` instead of throwing, so the console can
 * explain what happened.
 */
export default function usePatchIntentRunner(): (intent: PatchIntent, args?: string[]) => PatchIntentResult {
  const actions = usePatchActions();
  const { openFileOperation } = usePatchUi();
  const {
    importSrcTxtDialog, openRelativeFile, merge, cutAndMerge, applySourcePostAction, finishCurrentFile,
    availableViews, setPlayerView, runSegmentOperation, runFileOperation,
  } = usePatchSession();

  return useCallback((intent: PatchIntent, args: string[] = []): PatchIntentResult => {
    const handler = actions[intent as PatchAction];
    if (handler != null) {
      handler();
      return { ok: true };
    }

    switch (intent) {
      case 'import-src-txt': {
        importSrcTxtDialog().catch((err: unknown) => { console.error(err); });
        return { ok: true };
      }
      // `skip-file` drops the current file without exporting; moving / deleting the source is
      // configured through `sourcePostAction` and applied by `finish-and-next`.
      case 'skip-file': {
        openRelativeFile(1);
        return { ok: true };
      }
      case 'merge': {
        merge().catch((err: unknown) => { console.error(err); });
        return { ok: true };
      }
      case 'cut-and-merge': {
        cutAndMerge().catch((err: unknown) => { console.error(err); });
        return { ok: true };
      }
      case 'post-process-cut':
      case 'post-process-merge': {
        applySourcePostAction().catch((err: unknown) => { console.error(err); });
        return { ok: true };
      }
      case 'finish-and-next': {
        finishCurrentFile().catch((err: unknown) => { console.error(err); });
        return { ok: true };
      }
      // The legacy "open clip / merged video" shortcuts select the matching player view.
      case 'open-clips': {
        if (!availableViews.includes('cut')) return { ok: false, reason: 'unavailable' };
        setPlayerView('cut');
        return { ok: true };
      }
      case 'open-merged': {
        if (!availableViews.includes('merge')) return { ok: false, reason: 'unavailable' };
        setPlayerView('merge');
        return { ok: true };
      }
      case 'help':
      case 'clear': {
        return { ok: true };
      }
      default: {
        if (isPatchSegmentOperation(intent)) {
          runSegmentOperation(intent).catch((err: unknown) => { console.error(err); });
          return { ok: true };
        }
        if (isPatchFileOperation(intent)) {
          // A format argument (e.g. `export srt`) skips the parameter dialog.
          const [firstArg] = args;
          if (intent === 'export-cut-list' && firstArg != null && isPatchExportFormat(firstArg)) {
            runFileOperation(intent, { format: firstArg }).catch((err: unknown) => { console.error(err); });
            return { ok: true };
          }
          if (intent === 'import-cut-list' && firstArg != null && isPatchImportFormat(firstArg)) {
            runFileOperation(intent, { importFormat: firstArg }).catch((err: unknown) => { console.error(err); });
            return { ok: true };
          }
          // html5ify / decimate / convert-batch / export-cut-list need parameters first.
          if (needsPatchFileOperationParams(intent)) openFileOperation(intent);
          else runFileOperation(intent).catch((err: unknown) => { console.error(err); });
          return { ok: true };
        }
        return { ok: false, reason: 'unavailable' };
      }
    }
  }, [actions, applySourcePostAction, availableViews, cutAndMerge, finishCurrentFile, importSrcTxtDialog, merge, openFileOperation, openRelativeFile, runFileOperation, runSegmentOperation, setPlayerView]);
}
