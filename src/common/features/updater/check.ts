import semver from 'semver';

import { pickChecksumAsset } from './checksums.js';
import type { LatestRelease, UpdateAsset, UpdateCheckResult } from './types.js';

// Fork-only: pure decisions for the update check. Network I/O and dialogs live in the main process
// (`src/main/features/updater/`), so everything here is exercised without a socket.

// The update package this build can install. The release workflow publishes
// `${productName}-${version}-win-x64.zip`, whose root is the packaged app, so a zip is the only thing
// an in-place update can consume (there is no 7z extractor on a stock Windows install). Matching by
// suffix keeps older unversioned releases installable too.
export const windowsUpdateAssetSuffix = '-win-x64.zip';

export function stripTagPrefix(tag: string) {
  const trimmed = tag.trim();
  return /^[vV]/.test(trimmed) ? trimmed.slice(1) : trimmed;
}

// Reads a GitHub `/releases/latest` payload.
//
// Defensive on purpose: a release without assets, notes or a page URL still yields a usable
// object, because a partial answer is better than a crash in a dialog. Only a payload that does
// not even name a tag is rejected, since there is nothing to compare then.
export function parseLatestReleasePayload(body: unknown, options: {
  fallbackPageUrl?: (tag: string) => string;
} = {}): LatestRelease | undefined {
  if (typeof body !== 'object' || body === null) return undefined;

  const {
    tag_name: rawTag, assets: rawAssets, html_url: rawPageUrl, body: rawNotes,
  } = body as Record<string, unknown>;
  if (typeof rawTag !== 'string' || rawTag.trim() === '') return undefined;
  const tag = rawTag.trim();

  const assets: UpdateAsset[] = [];
  if (Array.isArray(rawAssets)) {
    for (const entry of rawAssets) {
      if (typeof entry !== 'object' || entry === null) continue;
      const { name, browser_download_url: url, size } = entry as Record<string, unknown>;
      if (typeof name !== 'string' || name === '' || typeof url !== 'string' || url === '') continue;
      assets.push({ name, url, size: typeof size === 'number' && Number.isFinite(size) ? size : 0 });
    }
  }

  const pageUrl = typeof rawPageUrl === 'string' && rawPageUrl !== ''
    ? rawPageUrl
    : (options.fallbackPageUrl?.(tag) ?? '');

  return {
    tag,
    version: stripTagPrefix(tag),
    pageUrl,
    notes: typeof rawNotes === 'string' ? rawNotes : '',
    assets,
  };
}

// The package an update would install, or undefined when the release ships none.
//
// Matched by suffix rather than by exact name so a product-name change cannot silently turn every
// future release into "no installable package".
export function pickWindowsX64ZipAsset(assets: readonly UpdateAsset[]) {
  return assets.find((asset) => asset.name.toLowerCase().endsWith(windowsUpdateAssetSuffix));
}

// Classifies one check.
//
// `release === undefined` means the repository answered 404: nothing has ever been published. That
// is reported as its own status, not as a failure, and certainly not as an update - an empty
// repository (or a renamed/mistyped one) must never make the app offer a download.
export function classifyUpdateCheck({ currentVersion, release }: {
  currentVersion: string;
  release?: LatestRelease | undefined;
}): UpdateCheckResult {
  if (release == null) return { status: 'noRelease' };

  if (!semver.valid(release.version)) return { status: 'failed', reason: 'malformedTag', detail: release.version };
  if (!semver.valid(currentVersion)) return { status: 'failed', reason: 'malformedTag', detail: currentVersion };

  // Covers both "same version" and "this build is newer than the newest release" (a local or
  // unreleased build): neither has anything to install.
  if (!semver.lt(currentVersion, release.version)) return { status: 'upToDate', version: release.version };

  const asset = pickWindowsX64ZipAsset(release.assets);
  if (asset == null) return { status: 'failed', reason: 'noAsset' };

  // The checksum index travels with the release, so it is looked up here rather than at download
  // time: a release without one can still be offered, it just cannot be installed automatically.
  const checksum = pickChecksumAsset(release.assets);

  return {
    status: 'available',
    version: release.version,
    tag: release.tag,
    pageUrl: release.pageUrl,
    notes: release.notes,
    asset,
    ...(checksum != null && { checksum }),
  };
}
