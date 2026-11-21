import App from '../../App';
import { PatchConsoleProvider } from '../patchConsole/PatchConsoleProvider';
import { PatchExportRunProvider } from '../patchExportRun/PatchExportRunProvider';
import { PatchNoticeProvider } from '../patchNotice/PatchNoticeProvider';
import { PatchPracticeProvider } from '../patchPractice/PatchPracticeProvider';
import { PatchPrivacyLockProvider } from '../patchPrivacyLock/PatchPrivacyLockProvider';
import { PatchResultsOverviewProvider } from '../patchResultsOverview/PatchResultsOverviewProvider';
import { PatchWorkProvider } from '../patchWork/PatchWorkProvider';

/**
Patch-mode shell (step 1: base parity).

Patch mode starts from the untouched upstream `App` so every base feature (menus, shortcuts,
batch list, timeline, segments, export, merge, settings) is available by construction. Patch
layers are added step by step on top of this shell; see `ai-tmp/patch-mode-steps.md`.

The shell always stays mounted (only `patchMode` changes), so switching between patch and base
mode keeps the current session (open file, segments, batch list).

`playerMode` marks the player window: the same app, used as a viewer for the cut results.
`mergedMode` is its merged-result window (one file, no merge key), and `inspectMode` is its check
player (one source, opened by the detached-source check).
*/
export default function PatchApp({ patchMode, playerMode = false, mergedMode = false, inspectMode = false }: { patchMode: boolean, playerMode?: boolean, mergedMode?: boolean, inspectMode?: boolean }) {
  return (
    <PatchNoticeProvider>
      {/* patch: the export run is outermost so the work-directory dialog can see a running export
          (the folder names must not change while it writes into the work area). */}
      <PatchExportRunProvider>
        <PatchPrivacyLockProvider enabled={patchMode}>
          <PatchWorkProvider enabled={patchMode}>
            <PatchResultsOverviewProvider>
              <PatchConsoleProvider>
                <PatchPracticeProvider>
                  <App patchMode={patchMode} playerMode={playerMode} mergedMode={mergedMode} inspectMode={inspectMode} />
                </PatchPracticeProvider>
              </PatchConsoleProvider>
            </PatchResultsOverviewProvider>
          </PatchWorkProvider>
        </PatchPrivacyLockProvider>
      </PatchExportRunProvider>
    </PatchNoticeProvider>
  );
}
