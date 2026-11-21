// Fork-only: the checksum index a fork release publishes next to the archives.
//
// The update package is downloaded from an unauthenticated GitHub asset, so the checksum file is
// what makes it trustworthy: the release workflow hashes both archives with SHA256 and publishes
// `SHA256SUMS.txt`, and the updater refuses a package whose digest does not match. Nothing here
// touches the network or the file system - the main process reads the two files and passes their
// contents in.

import type { UpdateAsset } from './types.js';

/** File name of the checksum index, as published by `.github/workflows/release-win.yml`. */
export const checksumAssetName = 'SHA256SUMS.txt';

const sha256Pattern = /^[0-9a-f]{64}$/;

export function isSha256Hex(value: string): boolean {
  return sha256Pattern.test(value);
}

/** The checksum asset of a release, or undefined when the release publishes none. */
export function pickChecksumAsset(assets: readonly UpdateAsset[]): UpdateAsset | undefined {
  return assets.find((asset) => asset.name.toLowerCase() === checksumAssetName.toLowerCase());
}

// One `sha256sum`-style line: `<64 hex><whitespace><name>`, with an optional `*` before a name in
// binary mode. `sha256sum` writes two spaces; a single space is accepted too, because the file is
// hand-edited often enough to matter.
const checksumLinePattern = /^([0-9a-fA-F]{64})\s+\*?(.+)$/;

// The digest `SHA256SUMS.txt` gives for `assetName`, lower-cased, or undefined when the file does
// not mention it.
//
// A missing entry is deliberately not an error of its own: the caller decides what to do (our
// updater refuses to install without a digest), and a parser that threw would only hide which of
// "file truncated" and "entry absent" happened.
export function parseChecksumFile(text: string, assetName: string): string | undefined {
  const wanted = assetName.trim().toLowerCase();
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === '') continue;
    const match = checksumLinePattern.exec(line);
    if (match == null) continue;
    const [, digest = '', name = ''] = match;
    if (name.trim().toLowerCase() !== wanted) continue;
    return digest.toLowerCase();
  }
  return undefined;
}
