import { resolvePatchDirNames } from '../../../common/features/patchWork/index.js';
import type { PatchDirNames } from '../../../common/features/patchWork/index.js';
import * as patchConfig from '../patch/patchConfig.js';

/**
The folder names the app is configured to use (main process).

The setting is read on every use instead of being cached: the working-directory dialog applies a
new name immediately, and the next job has to write into the new folder. `resolvePatchDirNames`
falls back to `.losslesscut_work` / `losslesscut_finished` for an invalid value, so a hand-edited
`patch-config.json` never leaves the app without a work area.
*/
export default function getConfiguredPatchDirNames(): PatchDirNames {
  return resolvePatchDirNames({
    workDir: patchConfig.getPatchSetting('workDirName'),
    finishedDir: patchConfig.getPatchSetting('finishedDirName'),
  });
}
