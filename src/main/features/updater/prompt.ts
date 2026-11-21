import type { DownloadFailure, UpdateCheckResult } from '../../../common/features/updater/index.js';
import type { PendingUpdate } from '../../../common/features/updater/pending.js';
import type { UpdateInstallBlocker } from '../../../common/features/updater/install.js';

// Fork-only: turns an update result into one dialog description. The translation function is a
// parameter so the mapping is testable and so every string still goes through i18n (`t` in the
// main process, keys in locales/en/translation.json).

export type UpdateTranslate = (key: string, options?: Record<string, unknown>) => string;

export interface UpdatePrompt {
  type: 'info' | 'warning' | 'error' | 'question';
  title: string;
  message: string;
  detail?: string;
  buttons: string[];
  /** The first button starts the verified download and install; the caller runs that flow. */
  installAction?: boolean;
  /** Set when one button opens a page instead of only dismissing the dialog. */
  openReleaseUrl?: string;
  /** Index of the button that opens `openReleaseUrl` (defaults to the first one). */
  openReleaseIndex?: number;
}

type FailedCheck = Extract<UpdateCheckResult, { status: 'failed' }>;

const failureDescribe: Record<FailedCheck['reason'], (detail: string | undefined, t: UpdateTranslate) => string> = {
  network: (_detail, t) => t('GitHub could not be reached.'),
  timeout: (_detail, t) => t('GitHub did not respond in time.'),
  http: (detail, t) => t('GitHub responded with an error ({{status}}).', { status: detail ?? '' }),
  malformedTag: (_detail, t) => t('The version information from GitHub could not be read.'),
  malformedRelease: (_detail, t) => t('The release information from GitHub could not be read.'),
  noAsset: (_detail, t) => t('The latest release has no Windows x64 package, so it cannot be installed as an update.'),
};

export function buildUpdatePrompt({ result, currentVersion, t }: {
  result: UpdateCheckResult;
  currentVersion: string;
  t: UpdateTranslate;
}): UpdatePrompt {
  if (result.status === 'available') {
    // Only a release that publishes its checksums can be installed in place: without a digest the
    // updater would have to trust whatever arrived. Such a release still gets the manual path.
    if (result.checksum != null) {
      return {
        type: 'info',
        title: t('Update available'),
        message: t('LosslessCut-Patch {{version}} is available.', { version: result.version }),
        detail: t('Download and install it now, or open the GitHub release page and install it by hand.'),
        buttons: [t('Download and install'), t('Open GitHub release'), t('Close')],
        installAction: true,
        openReleaseUrl: result.pageUrl,
        openReleaseIndex: 1,
      };
    }

    return {
      type: 'info',
      title: t('Update available'),
      message: t('LosslessCut-Patch {{version}} is available for download from GitHub.', { version: result.version }),
      detail: t('Download it from the GitHub release page.'),
      buttons: [t('Open GitHub release'), t('Close')],
      openReleaseUrl: result.pageUrl,
    };
  }

  if (result.status === 'upToDate') {
    return {
      type: 'info',
      title: t('Check for updates'),
      message: t('You already have the latest version ({{version}}).', { version: currentVersion }),
      buttons: [t('OK')],
    };
  }

  if (result.status === 'noRelease') {
    return {
      type: 'info',
      title: t('Check for updates'),
      message: t('No releases have been published on GitHub yet, so there is nothing to update to.'),
      buttons: [t('OK')],
    };
  }

  if (result.status === 'notConfigured') {
    return {
      type: 'info',
      title: t('Check for updates'),
      message: t('Update checks are not configured in this build.'),
      buttons: [t('OK')],
    };
  }

  return {
    type: 'warning',
    title: t('Could not check for updates'),
    message: t('Could not check for updates from GitHub.'),
    detail: failureDescribe[result.reason](result.detail, t),
    buttons: [t('OK')],
  };
}

// The last chance to say no: after this the app closes and replaces its own files.
//
// The wording names what is *not* touched (videos and project files) and what is (the program
// files), because "the app will restart" alone reads like a restart the user can undo.
export function buildInstallConfirmPrompt({ version, t }: { version: string; t: UpdateTranslate }): UpdatePrompt {
  return {
    type: 'question',
    title: t('Install update'),
    message: t('Install LosslessCut-Patch {{version}} now?', { version }),
    detail: t('The app will close, replace its program files and start again. Your videos and project files are not touched, but save any open work first.'),
    buttons: [t('Download and install'), t('Cancel')],
  };
}

const blockerDescribe: Record<UpdateInstallBlocker, (t: UpdateTranslate) => string> = {
  notPackaged: (t) => t('This build cannot replace itself. Download the new version from the GitHub release page.'),
  storeBuild: (t) => t('This build is installed from the Microsoft Store, which updates it for you.'),
  noChecksum: (t) => t('The release publishes no checksum file, so the package cannot be verified automatically.'),
  unsafePath: (t) => t('The installation folder contains a character the updater cannot handle. Replace the folder by hand.'),
  installDirNotWritable: (t) => t('The installation folder is read-only. Move the app to a folder you can write to, or replace it by hand.'),
  noFreeSpace: (t) => t('There is not enough free space next to the running app to unpack the update.'),
};

/** Why the automatic install is not offered, with the manual path still available. */
export function buildInstallBlockedPrompt({ blocker, pageUrl, t }: {
  blocker: UpdateInstallBlocker;
  pageUrl: string;
  t: UpdateTranslate;
}): UpdatePrompt {
  return {
    type: 'warning',
    title: t('Cannot install this update automatically'),
    message: blockerDescribe[blocker](t),
    buttons: [t('Open GitHub release'), t('Close')],
    openReleaseUrl: pageUrl,
  };
}

const downloadFailureDescribe: Record<DownloadFailure, (detail: string | undefined, t: UpdateTranslate) => string> = {
  http: (detail, t) => t('GitHub responded with an error ({{status}}).', { status: detail ?? '' }),
  network: (_detail, t) => t('GitHub could not be reached.'),
  name: (_detail, t) => t('The release names its package in a way this build cannot save.'),
  size: (_detail, t) => t('The download was incomplete. Nothing was installed.'),
  checksum: (_detail, t) => t('The downloaded package does not match the checksum the release published. Nothing was installed.'),
  storage: (_detail, t) => t('The package could not be written to disk.'),
  cancelled: (_detail, t) => t('The download was cancelled. Nothing was installed.'),
};

/** Why a download produced no installable package. */
export function buildDownloadFailedPrompt({ failure, detail, t }: {
  failure: DownloadFailure;
  detail?: string | undefined;
  t: UpdateTranslate;
}): UpdatePrompt {
  return {
    type: failure === 'cancelled' ? 'info' : 'error',
    title: failure === 'cancelled' ? t('Download cancelled') : t('Could not download the update'),
    message: downloadFailureDescribe[failure](detail, t),
    buttons: [t('OK')],
  };
}

// What became of the last hand-off, shown once at startup.
//
// The not-applied branch is the important one: the app is running on the old files and the user has
// to be told, because otherwise the update simply "did nothing" and there is nothing to act on.
export function buildPreviousUpdatePrompt({ pending, runningVersion, applied, t }: {
  pending: PendingUpdate;
  runningVersion: string;
  /** Whether the running build is the version that was handed over. */
  applied: boolean;
  t: UpdateTranslate;
}): UpdatePrompt {
  if (applied) {
    return {
      type: 'info',
      title: t('Update finished'),
      message: t('LosslessCut-Patch was updated to {{version}}.', { version: pending.to }),
      buttons: [t('OK')],
    };
  }

  return {
    type: 'warning',
    title: t('The last update did not finish'),
    message: t('LosslessCut-Patch is still running version {{version}}.', { version: runningVersion }),
    detail: t('The downloaded package was kept in the updates folder, so you can try again or install it by hand. The updater log is there too.'),
    buttons: [t('OK')],
  };
}

// The renderer could not save its work, so the app must not close.
//
// Reachable only in patch mode: the project file is written with a debounce, so the update asks the
// renderer for a last save before it quits. A refusal here means the update waits.
export function buildCannotSavePrompt(t: UpdateTranslate): UpdatePrompt {
  return {
    type: 'warning',
    title: t('Update not started'),
    message: t('Your work could not be saved, so the update was not started.'),
    detail: t('Save or export what you are working on, then check for updates again.'),
    buttons: [t('OK')],
  };
}

export function buildNetworkDisabledPrompt(t: UpdateTranslate): UpdatePrompt {
  return {
    type: 'info',
    title: t('Check for updates'),
    message: t('Update checks need network access, which is disabled in this build.'),
    buttons: [t('OK')],
  };
}
