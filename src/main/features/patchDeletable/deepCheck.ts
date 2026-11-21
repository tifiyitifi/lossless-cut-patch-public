/**
Decode a whole file to prove it plays (fork-owned, main process).

The check panel's fast status comes from the container header and ffprobe, which proves the file is
*shaped* like a video, not that its frames decode. A damaged file can carry a perfectly readable
header. This is the other half: FFmpeg decodes every video and audio packet to the null muxer, which
touches the whole file and reports the first packet it could not decode. It is slow by design (a
multi-gigabyte file takes as long as it takes to read and decode it), so it only ever runs when the
user asks for it, reports progress, and can be cancelled.

Only video and audio are mapped: a broken subtitle or an attached font would fail the decode without
being what the user calls "cannot play".
*/

/** The progress of one run, as the panel shows it. */
export interface PatchDeepCheckProgress {
  /** 0..1, `undefined` while the duration is unknown. */
  ratio?: number | undefined;
  /** Seconds of media decoded so far. */
  seconds?: number | undefined;
}

export type PatchDeepCheckStatus =
  /** Every packet decoded. */
  | 'ok'
  /** FFmpeg stopped on a damaged packet. */
  | 'failed'
  /** The user (or the closing window) stopped it. */
  | 'canceled'
  /** FFmpeg could not even start (no bundled binary, permission denied, ...). */
  | 'unavailable';

export interface PatchDeepCheckResult {
  status: PatchDeepCheckStatus;
  /** The first FFmpeg error, for `failed`. */
  message?: string | undefined;
  /** Where the decode stopped, for `failed`. */
  atSeconds?: number | undefined;
}

/**
The FFmpeg arguments of a full decode.

`-xerror` stops at the first error instead of printing thousands of them, `-map 0:v:0?` / `-map 0:a?`
cover the streams a player uses, and the null muxer writes nothing to disk.
*/
export function getDeepCheckArgs(path: string): string[] {
  return [
    '-v', 'error',
    '-nostdin',
    '-xerror',
    '-progress', 'pipe:1',
    '-nostats',
    '-i', path,
    '-map', '0:v:0?',
    '-map', '0:a?',
    '-f', 'null',
    '-',
  ];
}

/** Read one `-progress` line (`out_time_us=…`, `progress=end`, …). */
export function parseDeepCheckProgressLine(line: string, durationSeconds: number | undefined): PatchDeepCheckProgress | undefined {
  const match = /^out_time_us=(-?\d+)\s*$/.exec(line);
  if (match == null) return undefined;
  const microseconds = Number(match[1]);
  if (!Number.isFinite(microseconds) || microseconds < 0) return undefined;
  const seconds = microseconds / 1_000_000;
  if (durationSeconds == null || !Number.isFinite(durationSeconds) || durationSeconds <= 0) return { seconds };
  return { seconds, ratio: Math.min(1, seconds / durationSeconds) };
}

/**
The first meaningful line of FFmpeg's error output.

FFmpeg prefixes many messages with the component that failed (`[mov,mp4 @ 0x…]`); the prefix means
nothing to the user, so it is dropped. A message longer than a tooltip is cut, not wrapped.
*/
export function summarizeDeepCheckFailure(stderr: string): string | undefined {
  const line = stderr
    .split(/\r?\n/u)
    .map((entry) => entry.trim())
    .find((entry) => entry !== '');
  if (line == null) return undefined;
  const withoutComponent = line.replace(/^\[[^\]]*\]\s*/u, '');
  const message = withoutComponent === '' ? line : withoutComponent;
  return message.length > 200 ? `${message.slice(0, 200)}…` : message;
}

export interface PatchDeepCheckDeps {
  /**
  Run FFmpeg and stream its stdout lines (the progress report).

  Resolves with the exit code and the collected stderr; a cancelled run resolves with
  `canceled: true` instead of throwing.
  */
  run: (args: readonly string[], { onLine }: { onLine: (line: string) => void }) => Promise<{ exitCode: number, stderr: string, canceled: boolean }>;
}

/** Decode the whole file and say whether it did. */
export async function runPatchDeepCheck(
  { path, durationSeconds, onProgress }: {
    path: string;
    durationSeconds: number | undefined;
    onProgress?: ((progress: PatchDeepCheckProgress) => void) | undefined;
  },
  deps: PatchDeepCheckDeps,
): Promise<PatchDeepCheckResult> {
  let lastSeconds: number | undefined;
  let outcome: Awaited<ReturnType<PatchDeepCheckDeps['run']>>;
  try {
    outcome = await deps.run(getDeepCheckArgs(path), {
      onLine: (line) => {
        const progress = parseDeepCheckProgressLine(line, durationSeconds);
        if (progress == null) return;
        lastSeconds = progress.seconds;
        onProgress?.(progress);
      },
    });
  } catch (err) {
    return { status: 'unavailable', message: err instanceof Error ? err.message : String(err) };
  }

  if (outcome.canceled) return { status: 'canceled' };
  if (outcome.exitCode === 0) return { status: 'ok' };
  return { status: 'failed', message: summarizeDeepCheckFailure(outcome.stderr), atSeconds: lastSeconds };
}
