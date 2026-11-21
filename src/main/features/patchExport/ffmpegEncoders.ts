import { getFfmpegPath, runFfmpeg } from '../../ffmpeg.js';
import logger from '../../logger.js';
import { parseFfmpegEncoders } from '../../../common/features/patchExportPolicy/encoder.js';
import { createFfmpegEncoderCache } from './encoderCache.js';

/**
The encoders the current ffmpeg build has (fork-owned).

The renderer cannot run ffmpeg, but the join repair has to know whether `libx264` exists before it
uses it (see `common/features/patchExportPolicy/encoder.ts`). One `-encoders` call per ffmpeg binary
is enough for the whole process (the list cannot change while the app runs), so the answer is
cached by path (see `encoderCache.ts`).

`undefined` means the probe itself failed (a custom ffmpeg that does not start, a killed process).
The caller keeps the pinned encoder in that case: a broken probe must not downgrade an export that
would have worked.
*/
async function probeEncoders() {
  try {
    const { stdout } = await runFfmpeg(['-hide_banner', '-encoders'], undefined, { logCli: false });
    return [...parseFfmpegEncoders(Buffer.from(stdout).toString('utf8'))];
  } catch (error) {
    logger.warn('Could not list the ffmpeg encoders; keeping the pinned join-repair encoder', error);
    return undefined;
  }
}

// eslint-disable-next-line import/prefer-default-export
export const listFfmpegEncoders = createFfmpegEncoderCache({ getPath: getFfmpegPath, probe: probeEncoders });
