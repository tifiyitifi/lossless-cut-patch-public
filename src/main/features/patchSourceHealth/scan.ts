import logger from '../../logger.js';
import { runFfprobe } from '../../ffmpeg.js';
import { parseSourceHealth, summarizeSourceHealth } from '../../../common/features/patchSourceHealth/index.js';
import type { PatchSourceHealth } from '../../../common/features/patchSourceHealth/index.js';

/**
Probe a source video for a damaged head GOP (fork-owned, main process).

The probe only reads the header, so it is cheap enough to run when a file is opened. The parser
warns on stderr even though ffprobe exits successfully, which is exactly the signal used here.
Anything that fails (missing file, broken container) is `unknown`: the app must never claim a
file is fine when it could not look at it.
*/

export interface PatchSourceHealthResult {
  health: PatchSourceHealth | 'unknown';
  /** How many damage lines the probe printed. */
  errorCount: number;
  /** The first damage line, for the log only (never the main message). */
  detail: string | undefined;
}

/**
execa hands the stream back as a `Uint8Array`, whose `toString()` is a list of byte values
(`"91,104,…"`) - not text. Decoding has to be explicit.
*/
function decodeStderr(stderr: unknown): string {
  if (typeof stderr === 'string') return stderr;
  if (stderr instanceof Uint8Array) return Buffer.from(stderr).toString('utf8');
  return stderr == null ? '' : String(stderr);
}

export async function scanPatchSourceHealth(filePath: string): Promise<PatchSourceHealthResult> {
  try {
    const result = await runFfprobe(
      ['-hide_banner', '-v', 'error', '-show_entries', 'format=duration', '-of', 'json', filePath],
      { logCli: false },
    );
    const stderr = decodeStderr(result.stderr);
    const parsed = parseSourceHealth(stderr);
    if (parsed.damaged) {
      logger.warn('Source video has decode errors at its head', { filePath, errorCount: parsed.errorCount });
    }
    return {
      health: summarizeSourceHealth(parsed),
      errorCount: parsed.errorCount,
      detail: parsed.damaged ? stderr.split('\n').find((line) => line.trim() !== '')?.trim() : undefined,
    };
  } catch (err) {
    logger.warn('Could not scan the source video', { filePath }, err);
    return { health: 'unknown', errorCount: 0, detail: undefined };
  }
}
