// eslint-disable-next-line import-js/no-extraneous-dependencies
import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { getUpdaterPaths, recordPendingUpdate } from './install.js';
import type { AvailableUpdate, UpdateFlowEnvironment } from './flow.js';
import { installUpdate, reportPreviousUpdate, runUpdateCheck } from './flow.js';

const packageBytes = Buffer.from('the windows x64 package');
const packageDigest = createHash('sha256').update(packageBytes).digest('hex');

const t = (key: string, options?: Record<string, unknown>) => (options == null ? key : `${key} ${JSON.stringify(options)}`);

const available: AvailableUpdate = {
  status: 'available',
  version: '3.70.2-patch.2',
  tag: 'v3.70.2-patch.2',
  pageUrl: 'https://example.test/releases/tag/v3.70.2-patch.2',
  notes: '',
  asset: { name: 'LosslessCut-Patch-win-x64.zip', url: 'https://example.test/z', size: packageBytes.length },
  checksum: { name: 'SHA256SUMS.txt', url: 'https://example.test/sums', size: 129 },
};

const releaseResponse = () => Response.json({
  tag_name: 'v3.70.2-patch.2',
  html_url: available.pageUrl,
  body: '',
  assets: [
    { name: 'LosslessCut-Patch-win-x64.zip', browser_download_url: available.asset.url, size: packageBytes.length },
    { name: 'SHA256SUMS.txt', browser_download_url: available.checksum!.url, size: 129 },
  ],
}, { status: 200 });

const fetchFor = (overrides: Record<string, () => Response> = {}) => async (url: string): Promise<Response> => {
  const override = overrides[url];
  if (override != null) return override();
  if (url === available.asset.url) return new Response(new Uint8Array(packageBytes), { status: 200 });
  if (url === available.checksum!.url) return new Response(`${packageDigest}  LosslessCut-Patch-win-x64.zip`, { status: 200 });
  return releaseResponse();
};

interface Harness {
  env: UpdateFlowEnvironment;
  prompts: string[];
  launches: number;
  quits: number;
  opened: string[];
  dir: string;
}

const harness = async ({
  answers = [0, 0],
  canWrite = true,
  freeBytes = 10_000_000_000,
  flush = true,
  fetchImpl,
  currentVersion = '3.70.2-patch.1',
}: {
  answers?: number[];
  canWrite?: boolean;
  freeBytes?: number;
  flush?: boolean;
  fetchImpl?: (url: string) => Promise<Response>;
  currentVersion?: string;
} = {}): Promise<Harness> => {
  const dir = await mkdtemp(join(tmpdir(), 'llc-update-flow-'));
  const shipped = join(dir, 'patch_update.ps1');
  await writeFile(shipped, 'Write-Output ok', 'utf8');

  const state: Harness = {
    dir,
    prompts: [],
    launches: 0,
    quits: 0,
    opened: [],
    env: {
      currentVersion,
      userDataDir: join(dir, 'userData'),
      installDir: join(dir, 'app'),
      shippedScriptPath: shipped,
      isPackaged: true,
      windowsStore: false,
      networkingDisabled: false,
      t,
      showPrompt: async (prompt) => {
        state.prompts.push(prompt.title);
        return answers.shift() ?? 1;
      },
      openExternal: async (url) => { state.opened.push(url); },
      setProgress: () => undefined,
      flushRenderer: async () => flush,
      quit: () => { state.quits += 1; },
      log: { info: () => undefined, error: () => undefined },
      fetchImpl: fetchImpl ?? fetchFor(),
      latestReleaseUrl: 'https://example.test/latest',
      freeBytes: async () => freeBytes,
      canWrite: async () => canWrite,
      launch: () => { state.launches += 1; },
    },
  };
  await mkdir(state.env.installDir, { recursive: true });
  return state;
};

const cleanup = async (h: Harness) => { await rm(h.dir, { recursive: true, force: true }); };

describe('runUpdateCheck', () => {
  it('explains that updates need network access when networking is off', async () => {
    const h = await harness();
    try {
      await runUpdateCheck({ env: { ...h.env, networkingDisabled: true } });
      expect(h.prompts).toStrictEqual(['Check for updates']);
      expect(h.launches).toBe(0);
    } finally {
      await cleanup(h);
    }
  });

  it('says the build is up to date when the release is not newer', async () => {
    const h = await harness({ currentVersion: '3.70.2-patch.9' });
    try {
      await runUpdateCheck({ env: h.env });
      expect(h.prompts).toStrictEqual(['Check for updates']);
      expect(h.launches).toBe(0);
    } finally {
      await cleanup(h);
    }
  });

  it('still offers the release page when the release publishes no checksums', async () => {
    const h = await harness();
    try {
      await runUpdateCheck({
        env: {
          ...h.env,
          fetchImpl: async () => Response.json({
            tag_name: 'v3.70.2-patch.2',
            html_url: available.pageUrl,
            assets: [{ name: 'LosslessCut-Patch-win-x64.zip', browser_download_url: 'https://example.test/z', size: 1 }],
          }, { status: 200 }),
        },
      });
      expect(h.prompts).toStrictEqual(['Update available']);
      expect(h.opened).toStrictEqual([available.pageUrl]);
      expect(h.launches).toBe(0);
    } finally {
      await cleanup(h);
    }
  });

  it('installs when the user picks the install button', async () => {
    const h = await harness();
    try {
      await runUpdateCheck({ env: h.env });
      expect(h.prompts).toStrictEqual(['Update available', 'Install update']);
      expect(h.launches).toBe(1);
      expect(h.quits).toBe(1);
    } finally {
      await cleanup(h);
    }
  });

  it('does nothing when the user closes the dialog', async () => {
    const h = await harness({ answers: [2] });
    try {
      await runUpdateCheck({ env: h.env });
      expect(h.prompts).toStrictEqual(['Update available']);
      expect(h.launches).toBe(0);
    } finally {
      await cleanup(h);
    }
  });
});

describe('installUpdate', () => {
  it('refuses when the user cancels the confirmation', async () => {
    const h = await harness({ answers: [1] });
    try {
      await installUpdate({ result: available, env: h.env });
      expect(h.prompts).toStrictEqual(['Install update']);
      expect(h.launches).toBe(0);
    } finally {
      await cleanup(h);
    }
  });

  it('keeps the package and reports a checksum mismatch instead of installing it', async () => {
    const h = await harness({
      fetchImpl: fetchFor({
        [available.checksum!.url]: () => new Response(`${'b'.repeat(64)}  LosslessCut-Patch-win-x64.zip`, { status: 200 }),
      }),
    });
    try {
      await installUpdate({ result: available, env: h.env });
      expect(h.prompts).toStrictEqual(['Install update', 'Could not download the update']);
      expect(h.launches).toBe(0);
      expect(h.quits).toBe(0);
      // The failed package is deleted, so the next attempt starts from a clean folder.
      await expect(readdir(getUpdaterPaths(h.env.userDataDir).updatesDir)).resolves.toStrictEqual([]);
    } finally {
      await cleanup(h);
    }
  });

  it('refuses a release whose checksum file does not list the package', async () => {
    const h = await harness({
      fetchImpl: fetchFor({
        [available.checksum!.url]: () => new Response(`${'b'.repeat(64)}  other.zip`, { status: 200 }),
      }),
    });
    try {
      await installUpdate({ result: available, env: h.env });
      expect(h.prompts).toStrictEqual(['Install update', 'Could not download the update']);
      expect(h.launches).toBe(0);
    } finally {
      await cleanup(h);
    }
  });

  it('does not close the app when the renderer cannot save', async () => {
    const h = await harness({ flush: false });
    try {
      await installUpdate({ result: available, env: h.env });
      expect(h.prompts).toStrictEqual(['Install update', 'Update not started']);
      expect(h.launches).toBe(0);
      expect(h.quits).toBe(0);
    } finally {
      await cleanup(h);
    }
  });

  it('refuses a read-only installation folder before the app closes', async () => {
    const h = await harness({ canWrite: false });
    try {
      await installUpdate({ result: available, env: h.env });
      expect(h.prompts).toStrictEqual(['Install update', 'Cannot install this update automatically']);
      expect(h.launches).toBe(0);
      expect(h.quits).toBe(0);
    } finally {
      await cleanup(h);
    }
  });

  it('refuses when there is no room for the unpacked build', async () => {
    const h = await harness({ freeBytes: 1024 });
    try {
      await installUpdate({ result: available, env: h.env });
      expect(h.prompts).toStrictEqual(['Install update', 'Cannot install this update automatically']);
      expect(h.launches).toBe(0);
    } finally {
      await cleanup(h);
    }
  });
});

describe('reportPreviousUpdate', () => {
  it('says nothing when there is no hand-off to report', async () => {
    const h = await harness();
    try {
      await reportPreviousUpdate({ env: h.env });
      expect(h.prompts).toStrictEqual([]);
    } finally {
      await cleanup(h);
    }
  });

  it('reports a finished update and deletes the package it installed', async () => {
    const h = await harness({ currentVersion: '3.70.2-patch.2' });
    try {
      const paths = getUpdaterPaths(h.env.userDataDir);
      await mkdir(paths.updatesDir, { recursive: true });
      const packagePath = join(paths.updatesDir, 'LosslessCut-Patch-win-x64.zip');
      await writeFile(packagePath, 'zip', 'utf8');
      await recordPendingUpdate({
        pendingPath: paths.pendingPath,
        from: '3.70.2-patch.1',
        to: '3.70.2-patch.2',
        packagePath,
      });

      await reportPreviousUpdate({ env: h.env });

      expect(h.prompts).toStrictEqual(['Update finished']);
      await expect(readdir(paths.updatesDir)).resolves.toStrictEqual([]);
    } finally {
      await cleanup(h);
    }
  });

  it('reports an unfinished update and keeps the package for a manual retry', async () => {
    const h = await harness({ currentVersion: '3.70.2-patch.1' });
    try {
      const paths = getUpdaterPaths(h.env.userDataDir);
      await mkdir(paths.updatesDir, { recursive: true });
      const packagePath = join(paths.updatesDir, 'LosslessCut-Patch-win-x64.zip');
      await writeFile(packagePath, 'zip', 'utf8');
      await recordPendingUpdate({
        pendingPath: paths.pendingPath,
        from: '3.70.2-patch.1',
        to: '3.70.2-patch.2',
        packagePath,
      });

      await reportPreviousUpdate({ env: h.env });

      expect(h.prompts).toStrictEqual(['The last update did not finish']);
      await expect(readdir(paths.updatesDir)).resolves.toStrictEqual(['LosslessCut-Patch-win-x64.zip']);
    } finally {
      await cleanup(h);
    }
  });
});
