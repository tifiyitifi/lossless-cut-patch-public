// eslint-disable-next-line import-js/no-extraneous-dependencies
import { describe, expect, it } from 'vitest';

import {
  classifyUpdateCheck, parseLatestReleasePayload, pickWindowsX64ZipAsset, stripTagPrefix,
} from './check.js';
import type { LatestRelease } from './types.js';

const windowsZip = {
  name: 'LosslessCut-Patch-win-x64.zip',
  url: 'https://example.test/LosslessCut-Patch-win-x64.zip',
  size: 123,
};

const release = (overrides: Partial<LatestRelease> = {}): LatestRelease => ({
  tag: 'v3.70.2-patch.2',
  version: '3.70.2-patch.2',
  pageUrl: 'https://example.test/releases/tag/v3.70.2-patch.2',
  notes: '',
  assets: [windowsZip],
  ...overrides,
});

describe('stripTagPrefix', () => {
  it('drops one leading v', () => {
    expect(stripTagPrefix('v3.70.2')).toBe('3.70.2');
    expect(stripTagPrefix('V3.70.2')).toBe('3.70.2');
    expect(stripTagPrefix('3.70.2')).toBe('3.70.2');
  });
});

describe('parseLatestReleasePayload', () => {
  it('reads the tag, notes, page and assets', () => {
    const parsed = parseLatestReleasePayload({
      tag_name: 'v3.70.2-patch.2',
      html_url: 'https://example.test/r',
      body: 'notes',
      assets: [
        { name: 'LosslessCut-Patch-win-x64.zip', browser_download_url: 'https://example.test/z', size: 123 },
        { name: 'LosslessCut-Patch-win-x64.7z', browser_download_url: 'https://example.test/7z', size: 456 },
      ],
    });

    expect(parsed).toStrictEqual({
      tag: 'v3.70.2-patch.2',
      version: '3.70.2-patch.2',
      pageUrl: 'https://example.test/r',
      notes: 'notes',
      assets: [
        { name: 'LosslessCut-Patch-win-x64.zip', url: 'https://example.test/z', size: 123 },
        { name: 'LosslessCut-Patch-win-x64.7z', url: 'https://example.test/7z', size: 456 },
      ],
    });
  });

  it('rejects a payload that does not name a tag', () => {
    expect(parseLatestReleasePayload({})).toBeUndefined();
    expect(parseLatestReleasePayload({ tag_name: ' '.repeat(3) })).toBeUndefined();
    expect(parseLatestReleasePayload(null)).toBeUndefined();
    expect(parseLatestReleasePayload('nope')).toBeUndefined();
  });

  it('skips malformed assets instead of failing the whole release', () => {
    const parsed = parseLatestReleasePayload({
      tag_name: 'v1.0.0',
      assets: [null, { name: 'no-url' }, { browser_download_url: 'no-name' }, { name: 'ok.zip', browser_download_url: 'u' }],
    });
    expect(parsed?.assets).toStrictEqual([{ name: 'ok.zip', url: 'u', size: 0 }]);
  });

  it('builds a page URL when GitHub did not send one', () => {
    const parsed = parseLatestReleasePayload(
      { tag_name: 'v1.0.0' },
      { fallbackPageUrl: (tag) => `https://example.test/releases/tag/${tag}` },
    );
    expect(parsed?.pageUrl).toBe('https://example.test/releases/tag/v1.0.0');
  });
});

describe('pickWindowsX64ZipAsset', () => {
  it('ignores the 7z and picks the zip', () => {
    const picked = pickWindowsX64ZipAsset([
      { name: 'LosslessCut-Patch-win-x64.7z', url: 'a', size: 1 },
      { name: 'LosslessCut-Patch-win-x64.zip', url: 'b', size: 2 },
      { name: 'SHA256SUMS.txt', url: 'c', size: 3 },
    ]);
    expect(picked?.url).toBe('b');
  });

  it('picks a versioned Windows zip so older builds can still update', () => {
    const picked = pickWindowsX64ZipAsset([
      { name: 'LosslessCut-Patch-3.70.2-patch.0.2-win-x64.7z', url: 'a', size: 1 },
      { name: 'LosslessCut-Patch-3.70.2-patch.0.2-win-x64.zip', url: 'b', size: 2 },
    ]);
    expect(picked?.url).toBe('b');
  });

  it('is undefined when only other artifacts are published', () => {
    expect(pickWindowsX64ZipAsset([{ name: 'LosslessCut-Patch-win-x64.7z', url: 'a', size: 1 }])).toBeUndefined();
  });
});

describe('classifyUpdateCheck', () => {
  it('treats an empty repository as "nothing published", never as an update', () => {
    expect(classifyUpdateCheck({ currentVersion: '3.70.2-patch.1', release: undefined }))
      .toStrictEqual({ status: 'noRelease' });
  });

  it('reports the published version when it matches the running build', () => {
    expect(classifyUpdateCheck({ currentVersion: '3.70.2-patch.1', release: release({ tag: 'v3.70.2-patch.1', version: '3.70.2-patch.1' }) }))
      .toStrictEqual({ status: 'upToDate', version: '3.70.2-patch.1' });
  });

  it('treats a newer local build as up to date', () => {
    expect(classifyUpdateCheck({ currentVersion: '3.70.2-patch.9', release: release() }))
      .toStrictEqual({ status: 'upToDate', version: '3.70.2-patch.2' });
  });

  it('offers the next fork patch release', () => {
    const result = classifyUpdateCheck({ currentVersion: '3.70.2-patch.1', release: release() });
    expect(result).toMatchObject({ status: 'available', version: '3.70.2-patch.2', asset: windowsZip });
  });

  it('carries the checksum index when the release publishes one', () => {
    const sums = { name: 'SHA256SUMS.txt', url: 'https://example.test/sums', size: 129 };
    const result = classifyUpdateCheck({
      currentVersion: '3.70.2-patch.1',
      release: release({ assets: [windowsZip, sums] }),
    });
    expect(result).toMatchObject({ status: 'available', checksum: sums });
  });

  it('leaves the checksum out when the release publishes none', () => {
    const result = classifyUpdateCheck({ currentVersion: '3.70.2-patch.1', release: release() });
    expect(result).not.toHaveProperty('checksum');
  });

  it('offers a plain upstream version over a fork patch release', () => {
    const result = classifyUpdateCheck({
      currentVersion: '3.70.2-patch.1',
      release: release({ tag: 'v3.71.0', version: '3.71.0', assets: [windowsZip] }),
    });
    expect(result).toMatchObject({ status: 'available', version: '3.71.0' });
  });

  it('fails with noAsset when the release ships no zip', () => {
    const result = classifyUpdateCheck({
      currentVersion: '3.70.2-patch.1',
      release: release({ assets: [{ name: 'LosslessCut-Patch-win-x64.7z', url: 'a', size: 1 }] }),
    });
    expect(result).toStrictEqual({ status: 'failed', reason: 'noAsset' });
  });

  it('fails when the published tag is not a version', () => {
    expect(classifyUpdateCheck({ currentVersion: '3.70.2-patch.1', release: release({ tag: 'nightly', version: 'nightly' }) }))
      .toStrictEqual({ status: 'failed', reason: 'malformedTag', detail: 'nightly' });
  });

  it('fails when the running build has no readable version', () => {
    expect(classifyUpdateCheck({ currentVersion: 'dev', release: release() }))
      .toStrictEqual({ status: 'failed', reason: 'malformedTag', detail: 'dev' });
  });
});
