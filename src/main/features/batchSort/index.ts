import { getDuration } from '../../ffmpeg.js';
import logger from '../../logger.js';
import { readShallowDuration } from '../patchMediaProbe/index.js';
import { readBatchDurations } from './readBatchDurations.js';

/**
The batch sort's duration source (patch, fork-owned, main process).

This is the only place that pulls the production readers together: the container header first, and
the real ffprobe only for the files it declines. Kept apart from `readBatchDurations` so the
orchestration can be tested without loading Electron.
*/
export async function patchReadBatchDurations(paths: readonly string[]): Promise<Record<string, number | null>> {
  logger.info('readBatchDurations', { count: paths.length });
  return readBatchDurations(paths, { shallow: readShallowDuration, probe: getDuration });
}
