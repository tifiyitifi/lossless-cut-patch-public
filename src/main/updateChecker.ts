// eslint-disable-next-line import-js/no-extraneous-dependencies
import electron from 'electron';

import logger from './logger.js';
import { checkForUpdate } from './features/updater/index.js';

const { app } = electron;

// The newest published fork version, or undefined when there is nothing newer (or nothing could
// be asked).
//
// patch: delegates to `features/updater` so the startup check and the manual "Check for updates"
// item share one network path and one definition of "nothing published". The menu only needs the
// version string to offer "Download {{version}}"; the full result (assets, reasons) is used by the
// manual check. It never asks upstream: a fork build must not be offered the official release as
// an "update".
export async function checkNewVersion() {
  const result = await checkForUpdate({ currentVersion: app.getVersion() });
  if (result.status === 'available') return result.version;
  if (result.status === 'failed') {
    logger.error('Failed to check the newest fork version from GitHub', result.reason, result.detail);
  }
  return undefined;
}
