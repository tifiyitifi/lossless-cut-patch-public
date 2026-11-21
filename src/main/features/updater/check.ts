import {
  forkGithubUrl, forkReleaseOwner, forkReleaseRepoName, isForkReleaseConfigured,
} from '../../../common/constants.js';
import { classifyUpdateCheck, parseLatestReleasePayload } from '../../../common/features/updater/index.js';
import type { UpdateCheckResult } from '../../../common/features/updater/index.js';

// Fork-only: the network half of the update check (see `common/features/updater/` for the pure
// half). Nothing here touches Electron, so it is exercisable with an injected fetch.

export type FetchImpl = (url: string, init?: RequestInit) => Promise<Response>;

export const latestReleaseApiUrl = () => `https://api.github.com/repos/${forkReleaseOwner}/${forkReleaseRepoName}/releases/latest`;

const forkRepoUrl = () => forkGithubUrl;

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

const isTimeout = (error: unknown) => error instanceof Error && error.name === 'TimeoutError';

// Runs one update check against this fork's newest published release.
//
// A 404 is the empty-repository answer: GitHub returns it both for a repository with no releases
// and for a repository that does not exist (a typo or a rename). Either way there is nothing to
// install, so it is reported as `noRelease` rather than as an update or as a crash.
export async function checkForUpdate({
  currentVersion,
  fetchImpl = fetch,
  latestReleaseUrl = latestReleaseApiUrl(),
  timeoutMs = 15_000,
}: {
  currentVersion: string;
  fetchImpl?: FetchImpl;
  latestReleaseUrl?: string;
  timeoutMs?: number;
}): Promise<UpdateCheckResult> {
  // patch: a fork without its own release repository skips the check entirely; asking upstream
  // would offer the official build as an "update" over this fork.
  if (!isForkReleaseConfigured()) return { status: 'notConfigured' };

  let response: Response;
  try {
    response = await fetchImpl(latestReleaseUrl, {
      headers: {
        accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    return {
      status: 'failed',
      reason: isTimeout(error) ? 'timeout' : 'network',
      detail: errorMessage(error),
    };
  }

  if (response.status === 404) return { status: 'noRelease' };
  if (!response.ok) return { status: 'failed', reason: 'http', detail: `${response.status}` };

  let body: unknown;
  try {
    body = await response.json();
  } catch (error) {
    return { status: 'failed', reason: 'malformedRelease', detail: errorMessage(error) };
  }

  const release = parseLatestReleasePayload(body, {
    fallbackPageUrl: (tag) => `${forkRepoUrl()}/releases/tag/${tag}`,
  });
  if (release == null) return { status: 'failed', reason: 'malformedRelease' };

  return classifyUpdateCheck({ currentVersion, release });
}
