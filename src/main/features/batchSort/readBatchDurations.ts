/**
Read many durations for the batch sort (patch, fork-owned, no Electron imports so it is unit
testable).

Two sources, in this order:

1. the container header (`readShallowDuration`), which starts no process. mp4/mov/mkv/webm - the
   formats a video batch is made of - are answered in about a millisecond each;
2. ffprobe, for the formats the header reader declines (or a file it cannot parse).

Concurrency matters more than anything else here: the expensive part of an ffprobe call is starting
the process, so a few running at once turn a batch of hundreds into a couple of seconds instead of
tens. The caller passes the batch in chunks so it can show progress and stop when the user picks
another sort.
*/

export interface BatchDurationSources {
  /** Cheap container read; returns `undefined` when it cannot answer. */
  shallow: (path: string) => Promise<number | undefined>;
  /** Process-based fallback (ffprobe). */
  probe: (path: string) => Promise<number | undefined>;
  /** How many files are read at once. */
  concurrency?: number | undefined;
}

/**
A request above this is refused (the extra paths are left out) - the renderer never asks for more,
and a runaway call must not start thousands of processes.
*/
export const maxBatchDurationPaths = 5000;

/** Run `worker` over `items` with at most `concurrency` in flight. */
async function mapWithConcurrency<T>(items: readonly T[], concurrency: number, worker: (item: T) => Promise<void>) {
  let nextIndex = 0;
  const run = async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      // eslint-disable-next-line no-await-in-loop
      await worker(items[index]!);
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, run));
}

/** One entry per path: the duration in seconds, or `null` when neither source could read it. */
export async function readBatchDurations(paths: readonly string[], sources: BatchDurationSources): Promise<Record<string, number | null>> {
  const { shallow, probe, concurrency = 8 } = sources;
  const durations: Record<string, number | null> = {};

  // At least one worker: a zero (or negative) value from a caller would otherwise read nothing and
  // silently report every path as unreadable.
  const workers = Math.max(1, Math.trunc(Number.isFinite(concurrency) ? concurrency : 8));

  await mapWithConcurrency(paths.slice(0, maxBatchDurationPaths), workers, async (path) => {
    const shallowValue = await shallow(path).catch(() => undefined);
    const value = shallowValue ?? await probe(path).catch(() => undefined);
    // A zero duration is "unknown" for a sort (see common/features/batchSort), so it is reported as
    // unreadable rather than as a real value of zero.
    durations[path] = value != null && Number.isFinite(value) && value > 0 ? value : null;
  });

  return durations;
}
