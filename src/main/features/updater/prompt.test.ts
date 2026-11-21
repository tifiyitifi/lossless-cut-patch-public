// eslint-disable-next-line import-js/no-extraneous-dependencies
import { describe, expect, it } from 'vitest';

import type { UpdateCheckResult } from '../../../common/features/updater/index.js';
import {
  buildCannotSavePrompt,
  buildDownloadFailedPrompt,
  buildInstallBlockedPrompt,
  buildInstallConfirmPrompt,
  buildNetworkDisabledPrompt,
  buildPreviousUpdatePrompt,
  buildUpdatePrompt,
} from './prompt.js';

// A translation function that exposes the key and its options, so the test asserts the mapping
// without depending on any locale being loaded.
const t = (key: string, options?: Record<string, unknown>) => (options == null ? key : `${key} ${JSON.stringify(options)}`);

const available: UpdateCheckResult = {
  status: 'available',
  version: '3.70.2-patch.2',
  tag: 'v3.70.2-patch.2',
  pageUrl: 'https://example.test/releases/tag/v3.70.2-patch.2',
  notes: '',
  asset: { name: 'LosslessCut-Patch-win-x64.zip', url: 'https://example.test/z', size: 1 },
};

describe('buildUpdatePrompt', () => {
  it('offers the GitHub release page for a new version', () => {
    const prompt = buildUpdatePrompt({ result: available, currentVersion: '3.70.2-patch.1', t });
    expect(prompt.buttons).toStrictEqual(['Open GitHub release', 'Close']);
    expect(prompt.openReleaseUrl).toBe(available.pageUrl);
    expect(prompt.message).toContain('3.70.2-patch.2');
  });

  it('offers to download and install when the release publishes checksums', () => {
    const prompt = buildUpdatePrompt({
      result: { ...available, checksum: { name: 'SHA256SUMS.txt', url: 'https://example.test/sums', size: 1 } },
      currentVersion: '3.70.2-patch.1',
      t,
    });
    expect(prompt.buttons).toStrictEqual(['Download and install', 'Open GitHub release', 'Close']);
    expect(prompt.installAction).toBe(true);
    expect(prompt.openReleaseUrl).toBe(available.pageUrl);
    expect(prompt.openReleaseIndex).toBe(1);
  });

  it('has no release page to open when up to date', () => {
    const prompt = buildUpdatePrompt({
      result: { status: 'upToDate', version: '3.70.2-patch.1' },
      currentVersion: '3.70.2-patch.1',
      t,
    });
    expect(prompt.buttons).toStrictEqual(['OK']);
    expect(prompt.openReleaseUrl).toBeUndefined();
    expect(prompt.message).toContain('3.70.2-patch.1');
  });

  it('explains an empty release repository instead of offering an update', () => {
    const prompt = buildUpdatePrompt({ result: { status: 'noRelease' }, currentVersion: '3.70.2-patch.1', t });
    expect(prompt.buttons).toStrictEqual(['OK']);
    expect(prompt.openReleaseUrl).toBeUndefined();
    expect(prompt.message).toBe('No releases have been published on GitHub yet, so there is nothing to update to.');
  });

  it('covers a build without a configured release repository', () => {
    const prompt = buildUpdatePrompt({ result: { status: 'notConfigured' }, currentVersion: '3.70.2-patch.1', t });
    expect(prompt.message).toBe('Update checks are not configured in this build.');
  });

  it.each([
    ['network', 'GitHub could not be reached.'],
    ['timeout', 'GitHub did not respond in time.'],
    ['malformedTag', 'The version information from GitHub could not be read.'],
    ['malformedRelease', 'The release information from GitHub could not be read.'],
    ['noAsset', 'The latest release has no Windows x64 package, so it cannot be installed as an update.'],
  ] as const)('explains the %s failure', (reason, expected) => {
    const prompt = buildUpdatePrompt({
      result: { status: 'failed', reason },
      currentVersion: '3.70.2-patch.1',
      t,
    });
    expect(prompt.detail).toBe(expected);
    expect(prompt.buttons).toStrictEqual(['OK']);
    expect(prompt.openReleaseUrl).toBeUndefined();
  });

  it('keeps the HTTP status in the message', () => {
    const prompt = buildUpdatePrompt({
      result: { status: 'failed', reason: 'http', detail: '403' },
      currentVersion: '3.70.2-patch.1',
      t,
    });
    expect(prompt.detail).toContain('403');
  });
});

describe('buildNetworkDisabledPrompt', () => {
  it('says networking is disabled', () => {
    const prompt = buildNetworkDisabledPrompt(t);
    expect(prompt.message).toBe('Update checks need network access, which is disabled in this build.');
    expect(prompt.buttons).toStrictEqual(['OK']);
  });
});

describe('buildInstallConfirmPrompt', () => {
  it('names the version and warns that the app restarts', () => {
    const prompt = buildInstallConfirmPrompt({ version: '3.70.2-patch.2', t });
    expect(prompt.message).toContain('3.70.2-patch.2');
    expect(prompt.buttons).toStrictEqual(['Download and install', 'Cancel']);
    expect(prompt.detail).toContain('save any open work');
  });
});

describe('buildInstallBlockedPrompt', () => {
  it.each([
    ['notPackaged', 'cannot replace itself'],
    ['storeBuild', 'Microsoft Store'],
    ['noChecksum', 'no checksum file'],
    ['unsafePath', 'character the updater cannot handle'],
    ['installDirNotWritable', 'read-only'],
    ['noFreeSpace', 'not enough free space'],
  ] as const)('explains the %s blocker', (blocker, expected) => {
    const prompt = buildInstallBlockedPrompt({ blocker, pageUrl: 'https://example.test/r', t });
    expect(prompt.type).toBe('warning');
    expect(prompt.message).toContain(expected);
    expect(prompt.openReleaseUrl).toBe('https://example.test/r');
  });
});

describe('buildDownloadFailedPrompt', () => {
  it.each([
    ['network', 'GitHub could not be reached.'],
    ['name', 'cannot save'],
    ['size', 'incomplete'],
    ['checksum', 'does not match the checksum'],
    ['storage', 'could not be written to disk'],
  ] as const)('explains the %s failure', (failure, expected) => {
    const prompt = buildDownloadFailedPrompt({ failure, t });
    expect(prompt.type).toBe('error');
    expect(prompt.message).toContain(expected);
    expect(prompt.buttons).toStrictEqual(['OK']);
  });

  it('keeps the HTTP status', () => {
    expect(buildDownloadFailedPrompt({ failure: 'http', detail: '429', t }).message).toContain('429');
  });

  it('treats a user cancel as information, not as an error', () => {
    const prompt = buildDownloadFailedPrompt({ failure: 'cancelled', t });
    expect(prompt.type).toBe('info');
    expect(prompt.message).toBe('The download was cancelled. Nothing was installed.');
  });
});

describe('buildPreviousUpdatePrompt', () => {
  const pending = { from: '3.70.2-patch.1', to: '3.70.2-patch.2', packagePath: 'p', startedAt: '' };

  it('reports a finished update', () => {
    const prompt = buildPreviousUpdatePrompt({ pending, runningVersion: '3.70.2-patch.2', applied: true, t });
    expect(prompt.type).toBe('info');
    expect(prompt.message).toContain('3.70.2-patch.2');
  });

  it('reports an unfinished update with what to do about it', () => {
    const prompt = buildPreviousUpdatePrompt({ pending, runningVersion: '3.70.2-patch.1', applied: false, t });
    expect(prompt.type).toBe('warning');
    expect(prompt.message).toContain('3.70.2-patch.1');
    expect(prompt.detail).toContain('updates folder');
  });
});

describe('buildCannotSavePrompt', () => {
  it('says the update did not start because the work could not be saved', () => {
    const prompt = buildCannotSavePrompt(t);
    expect(prompt.type).toBe('warning');
    expect(prompt.message).toContain('could not be saved');
    expect(prompt.buttons).toStrictEqual(['OK']);
  });
});
