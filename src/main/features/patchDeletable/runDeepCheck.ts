import readline from 'node:readline';

import { execa } from 'execa';

import { getFfCommandLine, getFfmpegPath } from '../../ffmpeg.js';
import { trackFfmpegChild } from '../../ffmpegChildren.js';
import logger from '../../logger.js';

/**
Run one FFmpeg decode and stream its progress (fork-owned, main process).

Kept apart from the pure `deepCheck` orchestration so the arguments, the progress parsing and the
failure summary can be tested without Electron or a bundled binary. The child is registered with
`trackFfmpegChild`, so a finish job or a delete stops the check before it touches the file (the run
then ends as cancelled, not as a failure).
*/
export async function runFfmpegDecodeCheck({ args, inputPath, abortController, onLine }: {
  args: readonly string[];
  /** The file the decode reads; it is what the tracking reports. */
  inputPath: string;
  abortController: AbortController;
  onLine: (line: string) => void;
}): Promise<{ exitCode: number, stderr: string, canceled: boolean }> {
  logger.info(getFfCommandLine('ffmpeg', args));
  const stopTracking = trackFfmpegChild({ abortController, inputPaths: [inputPath] });

  const child = execa(getFfmpegPath(), args, {
    reject: false,
    buffer: false,
    encoding: 'utf8',
    cancelSignal: abortController.signal,
  });

  // Enough to name the failure; a damaged file can print megabytes of the same error.
  let stderr = '';
  child.stderr?.on('data', (chunk: string) => {
    stderr = `${stderr}${chunk}`.slice(-20_000);
  });

  const lines = child.stdout != null ? readline.createInterface({ input: child.stdout }) : undefined;
  lines?.on('line', onLine);

  try {
    const result = await child;
    return {
      exitCode: result.exitCode ?? -1,
      stderr,
      canceled: result.isCanceled || abortController.signal.aborted,
    };
  } finally {
    lines?.close();
    stopTracking();
  }
}
