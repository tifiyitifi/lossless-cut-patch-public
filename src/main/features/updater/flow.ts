// Fork-only: the update flow, from the check to the hand-over.
//
// Everything Electron-shaped is injected (dialogs, the progress bar, the quit, the renderer flush),
// so the whole sequence - including the refusals - is exercisable without a window, a network or a
// running app. `src/main/index.ts` only wires the real implementations in.

import { access, constants, statfs, unlink, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';

import { parseChecksumFile } from '../../../common/features/updater/checksums.js';
import { buildUpdaterCommand, planPortableUpdate } from '../../../common/features/updater/install.js';
import type { UpdateInstallBlocker } from '../../../common/features/updater/install.js';
import type { PendingUpdate } from '../../../common/features/updater/pending.js';
import { pendingUpdateOutcome } from '../../../common/features/updater/pending.js';
import type { UpdateCheckResult } from '../../../common/features/updater/types.js';
import { checkForUpdate } from './check.js';
import type { FetchImpl } from './download.js';
import { downloadUpdatePackage, fetchUpdateText, UpdateDownloadError } from './download.js';
import {
  clearPendingUpdate,
  getUpdaterPaths,
  launchUpdater,
  prepareUpdaterScript,
  readPendingUpdateFile,
  recordPendingUpdate,
} from './install.js';
import {
  buildCannotSavePrompt,
  buildDownloadFailedPrompt,
  buildInstallBlockedPrompt,
  buildInstallConfirmPrompt,
  buildNetworkDisabledPrompt,
  buildPreviousUpdatePrompt,
  buildUpdatePrompt,
} from './prompt.js';
import type { UpdatePrompt, UpdateTranslate } from './prompt.js';

export type AvailableUpdate = Extract<UpdateCheckResult, { status: 'available' }>;

export interface UpdateFlowEnvironment {
  currentVersion: string;
  userDataDir: string;
  /** The folder the running executable lives in; the updater swaps this one. */
  installDir: string;
  /** Path of the updater script the running build ships. */
  shippedScriptPath: string;
  isPackaged: boolean;
  windowsStore: boolean;
  networkingDisabled: boolean;
  t: UpdateTranslate;
  /** Shows one dialog, returns the index of the button the user chose. */
  showPrompt: (prompt: UpdatePrompt) => Promise<number>;
  openExternal: (url: string) => Promise<void>;
  /** Taskbar progress, 0..1, or undefined to clear it. */
  setProgress: (fraction: number | undefined) => void;
  /** Asks the renderer to save its work; false means it could not. */
  flushRenderer: () => Promise<boolean>;
  quit: () => void;
  log: { info: (...args: unknown[]) => void; error: (...args: unknown[]) => void };
  /** Overrides, for tests and a local end-to-end run. */
  fetchImpl?: FetchImpl | undefined;
  latestReleaseUrl?: string | undefined;
  freeBytes?: ((dir: string) => Promise<number>) | undefined;
  canWrite?: ((dir: string) => Promise<boolean>) | undefined;
  launch?: typeof launchUpdater | undefined;
  now?: (() => Date) | undefined;
}

/** Free space on the volume that holds `dir`, in bytes. */
export async function freeBytesAt(dir: string): Promise<number> {
  try {
    const stats = await statfs(dir);
    return stats.bavail * stats.bsize;
  } catch {
    return 0;
  }
}

// Whether the installation folder accepts a write.
//
// A probe file rather than `access(W_OK)`: on Windows the latter only looks at the read-only
// attribute, so it happily calls `Program Files` writable and the swap would fail later, after the
// app had already closed.
export async function probeWritable(dir: string): Promise<boolean> {
  const probe = join(dir, '.losslesscut-patch-write-probe');
  try {
    await writeFile(probe, 'ok', 'utf8');
    await unlink(probe);
    return true;
  } catch {
    await unlink(probe).catch(() => undefined);
    return false;
  }
}

/** Whether the folder accepts writes, consulting the access check first. */
export async function canWriteDir(dir: string): Promise<boolean> {
  try {
    await access(dir, constants.W_OK);
    return await probeWritable(dir);
  } catch {
    return false;
  }
}

/** Whether `filePath` resolves to something inside `directory`. */
export function isInside(filePath: string, directory: string): boolean {
  const relativePath = relative(resolve(directory), resolve(filePath));
  return relativePath !== '' && !relativePath.startsWith('..') && !isAbsolute(relativePath);
}

async function showBlocked({ blocker, pageUrl, env }: {
  blocker: UpdateInstallBlocker;
  pageUrl: string;
  env: UpdateFlowEnvironment;
}): Promise<void> {
  const prompt = buildInstallBlockedPrompt({ blocker, pageUrl, t: env.t });
  const choice = await env.showPrompt(prompt);
  if (prompt.openReleaseUrl != null && choice === 0) await env.openExternal(prompt.openReleaseUrl);
}

async function reportDownloadFailure({ error, env }: { error: unknown; env: UpdateFlowEnvironment }) {
  if (error instanceof UpdateDownloadError) {
    env.log.error('Update download failed', error.reason, error.detail);
    await env.showPrompt(buildDownloadFailedPrompt({ failure: error.reason, detail: error.detail, t: env.t }));
    return;
  }
  env.log.error('Update download failed', error);
  await env.showPrompt(buildDownloadFailedPrompt({ failure: 'network', t: env.t }));
}

// Downloads, verifies and hands the package to the updater.
//
// The order is deliberate: confirm, download, verify, save the user's work, *then* check the
// machine. Nothing is replaced before the app knows it can finish, and the renderer's save happens
// after the download so a slow network cannot hold unsaved work hostage.
export async function installUpdate({ result, env }: {
  result: AvailableUpdate;
  env: UpdateFlowEnvironment;
}): Promise<void> {
  const confirm = buildInstallConfirmPrompt({ version: result.version, t: env.t });
  if (await env.showPrompt(confirm) !== 0) return;

  const checksumAsset = result.checksum;
  if (checksumAsset == null) {
    await showBlocked({ blocker: 'noChecksum', pageUrl: result.pageUrl, env });
    return;
  }

  const paths = getUpdaterPaths(env.userDataDir);

  let expectedSha256: string | undefined;
  try {
    const text = await fetchUpdateText({
      asset: checksumAsset,
      ...(env.fetchImpl !== undefined && { fetchImpl: env.fetchImpl }),
    });
    expectedSha256 = parseChecksumFile(text, result.asset.name);
  } catch (error) {
    await reportDownloadFailure({ error, env });
    return;
  }

  if (expectedSha256 === undefined) {
    env.log.error('Release checksum file does not list the update package', checksumAsset.name, result.asset.name);
    await env.showPrompt(buildDownloadFailedPrompt({ failure: 'checksum', t: env.t }));
    return;
  }

  env.setProgress(0);
  let packagePath: string;
  try {
    const downloaded = await downloadUpdatePackage({
      asset: result.asset,
      expectedSha256,
      targetDir: paths.updatesDir,
      ...(env.fetchImpl !== undefined && { fetchImpl: env.fetchImpl }),
      onProgress: ({ received, total }) => env.setProgress(total > 0 ? received / total : undefined),
    });
    packagePath = downloaded.path;
  } catch (error) {
    await reportDownloadFailure({ error, env });
    return;
  } finally {
    env.setProgress(undefined);
  }

  // The download is done; from here the only thing that can still say no is the machine.
  if (!await env.flushRenderer()) {
    await env.showPrompt(buildCannotSavePrompt(env.t));
    return;
  }

  const freeBytesFn = env.freeBytes ?? freeBytesAt;
  const canWriteFn = env.canWrite ?? canWriteDir;

  const plan = planPortableUpdate({
    isPackaged: env.isPackaged,
    windowsStore: env.windowsStore,
    checksumAvailable: true,
    installDir: env.installDir,
    packagePath,
    packageSize: result.asset.size,
    freeBytes: await freeBytesFn(env.installDir),
    canWriteInstallDir: await canWriteFn(env.installDir),
    scriptPath: paths.scriptPath,
    updatesDir: paths.updatesDir,
    logPath: paths.logPath,
  });

  if (plan.kind === 'blocked') {
    env.log.info('Update cannot be installed automatically', plan.blocker);
    await showBlocked({ blocker: plan.blocker, pageUrl: result.pageUrl, env });
    return;
  }

  const command = buildUpdaterCommand({
    scriptPath: plan.scriptPath,
    packagePath: plan.packagePath,
    installDir: plan.installDir,
    logPath: plan.logPath,
  });
  if (command == null) {
    await showBlocked({ blocker: 'unsafePath', pageUrl: result.pageUrl, env });
    return;
  }

  try {
    await prepareUpdaterScript({
      shippedScriptPath: env.shippedScriptPath,
      scriptPath: plan.scriptPath,
    });
    await recordPendingUpdate({
      pendingPath: paths.pendingPath,
      from: env.currentVersion,
      to: result.version,
      packagePath: plan.packagePath,
      startedAt: (env.now?.() ?? new Date()).toISOString(),
    });
  } catch (error) {
    // The record is what makes the next launch able to report the outcome. Without it the update
    // could still land, but a failure would be silent, so it is treated as "cannot install".
    env.log.error('Could not prepare the update hand-over', error);
    await showBlocked({ blocker: 'installDirNotWritable', pageUrl: result.pageUrl, env });
    return;
  }

  env.log.info('Handing the update to the updater', plan.packagePath);
  (env.launch ?? launchUpdater)({ command });
  env.quit();
}

/** The check plus its dialog, and the install flow when the user asked for it. */
export async function runUpdateCheck({ env }: { env: UpdateFlowEnvironment }): Promise<void> {
  if (env.networkingDisabled) {
    await env.showPrompt(buildNetworkDisabledPrompt(env.t));
    return;
  }

  const result = await checkForUpdate({
    currentVersion: env.currentVersion,
    ...(env.fetchImpl !== undefined && { fetchImpl: env.fetchImpl }),
    ...(env.latestReleaseUrl !== undefined && { latestReleaseUrl: env.latestReleaseUrl }),
  });

  if (result.status === 'failed') {
    env.log.error('Update check from GitHub failed', result.reason, result.detail);
  } else {
    env.log.info('Update check from GitHub', result.status);
  }

  const prompt = buildUpdatePrompt({ result, currentVersion: env.currentVersion, t: env.t });
  const choice = await env.showPrompt(prompt);

  if (prompt.installAction === true && choice === 0 && result.status === 'available') {
    await installUpdate({ result, env });
    return;
  }

  if (prompt.openReleaseUrl != null && choice === (prompt.openReleaseIndex ?? 0)) {
    await env.openExternal(prompt.openReleaseUrl);
  }
}

// Reports what became of the last hand-over, once.
//
// Called at startup, after the window exists. A completed update deletes the package it installed;
// a failed one keeps it, because a manual retry is exactly what a user who was told "it did not
// finish" will look for.
export async function reportPreviousUpdate({ env }: { env: UpdateFlowEnvironment }): Promise<void> {
  const paths = getUpdaterPaths(env.userDataDir);
  let pending: PendingUpdate | undefined;
  try {
    pending = await readPendingUpdateFile(paths.pendingPath);
  } catch (error) {
    env.log.error('Could not read the pending update record', error);
    return;
  }
  if (pending === undefined) return;

  await clearPendingUpdate(paths.pendingPath);
  const applied = pendingUpdateOutcome({ runningVersion: env.currentVersion, pending }) === 'applied';
  await env.showPrompt(buildPreviousUpdatePrompt({ pending, runningVersion: env.currentVersion, applied, t: env.t }));

  if (applied && pending.packagePath !== '' && isInside(pending.packagePath, paths.updatesDir)) {
    await unlink(pending.packagePath).catch((error: unknown) => {
      env.log.error('Could not delete the installed update package', error);
    });
  }
}
