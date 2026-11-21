/**
The ffmpeg children this process started (fork-owned, plain bookkeeping).

Windows keeps a file locked while a process has it open, so a job can only move a file while
nothing of ours is reading it. Two kinds of reader matter: the ones `runFfmpegProcess` starts
(waveform slices, thumbnails, frame captures, exports) and the preview player's own ffmpeg, which
is started outside that helper because it streams the source into a `MediaSource`. Both register
here, with the files they read (their `-i` arguments), so a finish job can stop exactly the
readers of the files it is about to move - another window may be exporting at the same time, and
aborting every ffmpeg of the app would kill that export.

No Electron import on purpose: the registry is plain data and is unit tested.
*/
import { normalizeManifestPath } from '../common/features/patchExport/manifest.js';

/** What the registry needs from a child: aborting it has to make it go away. */
export interface TrackedFfmpegChild {
  abortController: AbortController;
  /** The files the child reads (its `-i` arguments), spelled as the arguments spell them. */
  inputPaths: readonly string[];
}

const runningChildren = new Set<TrackedFfmpegChild>();

/**
The files an ffmpeg command line reads.

Only `-i` counts: every reader this app starts names its media file there, while a pipe (`-`) and
a filter mentioning a path (`movie=...`) are not files of their own.
*/
export function extractFfmpegInputPaths(args: readonly string[]): string[] {
  const paths: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] !== '-i') {
      continue;
    }

    const value = args[i + 1];
    if (value != null && value !== '-') paths.push(value);
    i += 1;
  }
  return paths;
}

/** Register a running child. Call the returned function once it has exited. */
export function trackFfmpegChild(child: TrackedFfmpegChild): () => void {
  runningChildren.add(child);
  return () => {
    runningChildren.delete(child);
  };
}

export function countFfmpegChildren() {
  return runningChildren.size;
}

/** Abort every tracked child (the app's "abort the running job" action). */
export function abortAllFfmpegChildren() {
  const children = [...runningChildren];
  for (const child of children) child.abortController.abort();
  return children.length;
}

function defaultSleep(ms: number) {
  return new Promise<void>((resolve) => { setTimeout(resolve, ms); });
}

/**
Stop the running children that read one of `paths`, and wait until they are gone.

The abort only asks the process to exit; the file handle is released when it has really exited,
and until then a rename of the same file still fails. Resolves with what it did so the caller can
say whether it had to wait - a child that outlives the wait means something else of ours is
holding the file, and the move will fail with the same lock error as before.
*/
export async function stopFfmpegChildrenReading({ paths, caseInsensitive, timeoutMs = 2000, sleep = defaultSleep }: {
  paths: readonly string[];
  caseInsensitive: boolean;
  /** How long the children are given to exit before the caller goes ahead anyway. */
  timeoutMs?: number;
  /** Test seam. */
  sleep?: (ms: number) => Promise<void>;
}): Promise<{ stopped: number; stillRunning: number }> {
  const wanted = new Set(paths.map((path) => normalizeManifestPath(path, { caseInsensitive })));
  const readsWanted = (child: TrackedFfmpegChild) => child.inputPaths.some((input) => wanted.has(normalizeManifestPath(input, { caseInsensitive })));

  const matches = () => [...runningChildren].filter((child) => readsWanted(child));
  const stopped = matches();
  for (const child of stopped) child.abortController.abort();

  const attempts = Math.max(1, Math.ceil(timeoutMs / 50));
  for (let attempt = 0; attempt < attempts && matches().length > 0; attempt += 1) {
    // eslint-disable-next-line no-await-in-loop
    await sleep(50);
  }

  return { stopped: stopped.length, stillRunning: matches().length };
}
