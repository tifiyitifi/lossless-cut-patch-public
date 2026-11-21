// Fork-only: the network half of installing an update (see `common/features/updater/` for the pure
// decisions). Nothing here touches Electron, so the whole download is exercisable with an injected
// fetch against a real temporary directory.

import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { sanitizeAssetFileName } from '../../../common/features/updater/install.js';
import type { DownloadFailure, UpdateAsset } from '../../../common/features/updater/types.js';

export type FetchImpl = (url: string, init?: RequestInit) => Promise<Response>;

/** Raised when a transfer produces no package this build may install. */
export class UpdateDownloadError extends Error {
  readonly reason: DownloadFailure;

  readonly detail: string | undefined;

  constructor(reason: DownloadFailure, detail?: string) {
    super(`update download failed: ${reason}${detail === undefined ? '' : ` (${detail})`}`);
    this.name = 'UpdateDownloadError';
    this.reason = reason;
    this.detail = detail;
  }
}

export interface DownloadProgress {
  received: number;
  /** Advertised byte count, or 0 when the release carried none. */
  total: number;
}

const isAbortError = (error: unknown) => error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError');

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

// A rendered error page is not a checksum file; refuse anything large enough to be a package.
const maxTextBytes = 1024 * 1024;

// Reads the checksum index of a release.
//
// Small enough to be read whole, and capped: a proxy answering with an HTML page instead of the
// file must not end up parsed as one.
export async function fetchUpdateText({
  asset,
  fetchImpl = fetch,
  timeoutMs = 30_000,
}: {
  asset: UpdateAsset;
  fetchImpl?: FetchImpl;
  timeoutMs?: number;
}): Promise<string> {
  let response: Response;
  try {
    response = await fetchImpl(asset.url, {
      headers: { accept: 'text/plain' },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw new UpdateDownloadError(isAbortError(error) ? 'cancelled' : 'network', errorMessage(error));
  }

  if (!response.ok) throw new UpdateDownloadError('http', `${response.status}`);

  let text: string;
  try {
    text = await response.text();
  } catch (error) {
    throw new UpdateDownloadError(isAbortError(error) ? 'cancelled' : 'network', errorMessage(error));
  }

  if (text.length > maxTextBytes) throw new UpdateDownloadError('http', 'checksum file too large');
  return text;
}

// Downloads one release asset into `targetDir`, verifying it on the way.
//
// The digest is computed from the bytes as they arrive, so nothing is written twice and a tampered
// transfer never exists on disk under its final name. A package that fails either the size or the
// digest check is deleted rather than left for the updater to find.
//
// `signal` is the user's cancel; `timeoutMs` is the backstop for a stalled transfer (a 380 MB
// download legitimately takes minutes, so the deadline is per download, not per chunk).
export async function downloadUpdatePackage({
  asset,
  expectedSha256,
  targetDir,
  fetchImpl = fetch,
  onProgress,
  signal,
  timeoutMs = 30 * 60_000,
}: {
  asset: UpdateAsset;
  expectedSha256?: string | undefined;
  targetDir: string;
  fetchImpl?: FetchImpl;
  onProgress?: ((progress: DownloadProgress) => void) | undefined;
  signal?: AbortSignal | undefined;
  timeoutMs?: number;
}): Promise<{ path: string; bytes: number }> {
  const fileName = sanitizeAssetFileName(asset.name);
  if (fileName === undefined) throw new UpdateDownloadError('name', asset.name);

  const finalPath = join(targetDir, fileName);
  const partPath = `${finalPath}.part`;

  try {
    await mkdir(targetDir, { recursive: true });
  } catch (error) {
    throw new UpdateDownloadError('storage', errorMessage(error));
  }

  const timeout = AbortSignal.timeout(timeoutMs);
  const combined = signal === undefined ? timeout : AbortSignal.any([signal, timeout]);

  let received = 0;
  const hash = createHash('sha256');

  let response: Response;
  try {
    response = await fetchImpl(asset.url, {
      headers: { accept: 'application/octet-stream' },
      signal: combined,
    });
  } catch (error) {
    throw new UpdateDownloadError(isAbortError(error) ? 'cancelled' : 'network', errorMessage(error));
  }
  if (!response.ok) throw new UpdateDownloadError('http', `${response.status}`);
  if (response.body == null) throw new UpdateDownloadError('network', 'empty body');

  try {
    const hashChunks = async function* hashChunks(source: AsyncIterable<Buffer>) {
      for await (const chunk of source) {
        received += chunk.length;
        // Fail as soon as the transfer outgrows what the release promised, instead of writing an
        // unbounded file because a header was wrong.
        if (asset.size > 0 && received > asset.size) {
          throw new UpdateDownloadError('size', `${received} > ${asset.size}`);
        }
        hash.update(chunk);
        onProgress?.({ received, total: asset.size });
        yield chunk;
      }
    };

    await pipeline(
      Readable.fromWeb(response.body),
      hashChunks,
      createWriteStream(partPath),
    );

    if (asset.size > 0 && received !== asset.size) {
      throw new UpdateDownloadError('size', `${received} != ${asset.size}`);
    }

    const digest = hash.digest('hex');
    if (expectedSha256 === undefined) {
      throw new UpdateDownloadError('checksum', 'no published checksum');
    }
    if (digest !== expectedSha256.toLowerCase()) {
      throw new UpdateDownloadError('checksum', digest);
    }

    await rename(partPath, finalPath);
    return { path: finalPath, bytes: received };
  } catch (error) {
    await unlink(partPath).catch(() => undefined);
    if (error instanceof UpdateDownloadError) throw error;
    if (isAbortError(error)) throw new UpdateDownloadError('cancelled', errorMessage(error));
    // Whatever is left is a write that could not happen (no space, no permission, a lock).
    throw new UpdateDownloadError('storage', errorMessage(error));
  }
}
