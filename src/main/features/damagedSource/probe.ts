import { open } from 'node:fs/promises';

import logger from '../../logger.js';
import { runFfprobe } from '../../ffmpeg.js';
import type { SourceDamage, SourceProbeFacts } from '../../../common/features/damagedSource/index.js';
import { detectSourceDamage, parseFirstGopPtsEqualsDts, readMoovVideoTiming } from '../../../common/features/damagedSource/index.js';

/**
Probe a source file for damage (fork-owned, main process).

The cheap gate is `has_b_frames`: a file whose video needs no reordering cannot have the broken
frame timing this looks for, so most files are answered by one header-only ffprobe and no box
parsing at all.

Nothing here may claim a file is fine when it could not be looked at: a failed probe returns no
damage (there is nothing to warn about and nothing to repair), and logs the reason.
*/

/** A movie header larger than this is already pathological; do not try to hold it in memory. */
const moovReadLimit = 64 * 1024 * 1024;

/** How many packets of the first GOP are compared for the fallback. */
const samplePacketCount = 12;

async function readExactly(handle: Awaited<ReturnType<typeof open>>, length: number, position: number) {
  const buffer = Buffer.alloc(length);
  let filled = 0;
  while (filled < length) {
    // eslint-disable-next-line no-await-in-loop
    const { bytesRead } = await handle.read(buffer, filled, length - filled, position + filled);
    if (bytesRead === 0) return undefined;
    filled += bytesRead;
  }
  return buffer;
}

/**
The file's `moov` box, wherever it is stored.

It is read by walking the top-level boxes, because the movie header can sit at the end of the
file (ffmpeg writes it there when it did not know the size up front).
*/
async function readMoov(filePath: string): Promise<Uint8Array | undefined> {
  const handle = await open(filePath, 'r');
  try {
    const { size } = await handle.stat();
    let offset = 0;

    while (offset + 8 <= size) {
      const header = await readExactly(handle, 16, offset);
      if (header == null) return undefined;

      let boxSize = header.readUInt32BE(0);
      const type = header.toString('ascii', 4, 8);
      let headerLength = 8;

      if (boxSize === 1) {
        boxSize = Number(header.readBigUInt64BE(8));
        headerLength = 16;
      } else if (boxSize === 0) {
        boxSize = size - offset;
      }

      if (boxSize < headerLength) return undefined;

      if (type === 'moov') {
        if (boxSize > moovReadLimit) return undefined;
        return await readExactly(handle, boxSize, offset);
      }

      offset += boxSize;
    }

    return undefined;
  } finally {
    await handle.close();
  }
}

function decodeStdout(stdout: unknown) {
  if (typeof stdout === 'string') return stdout;
  if (stdout instanceof Uint8Array) return Buffer.from(stdout).toString('utf8');
  return '';
}

/**
Does the file have video, and does any of its video tracks need reordering?

Every video track is asked, not only the first: a file may carry a second (or cover-art) video
track, and a verdict about the file must not depend on the order ffprobe lists them in.
*/
async function probeVideoStream(filePath: string): Promise<{ hasVideo: boolean, hasBFrames: boolean, videoStreamCount: number }> {
  const { stdout } = await runFfprobe([
    '-hide_banner', '-v', 'error',
    '-show_entries', 'stream=codec_type,has_b_frames',
    '-of', 'json',
    filePath,
  ], { logCli: false });

  const parsed: unknown = JSON.parse(decodeStdout(stdout));
  const streams = (parsed != null && typeof parsed === 'object' && 'streams' in parsed && Array.isArray(parsed.streams))
    ? parsed.streams as { codec_type?: string, has_b_frames?: number }[]
    : [];
  const videos = streams.filter((stream) => stream.codec_type === 'video');
  if (videos.length === 0) return { hasVideo: false, hasBFrames: false, videoStreamCount: 0 };

  return {
    hasVideo: true,
    hasBFrames: videos.some((video) => (video.has_b_frames ?? 0) > 0),
    videoStreamCount: videos.length,
  };
}

/**
Fallback: do the first packets of the video store their presentation time equal to their decode
time? Only used when the movie header could not be read.

The parsing lives in `common/features/damagedSource/packetTiming` because it has to tell "the file
stores pts == dts" from "the file stores no timestamps at all" (`N/A`), and only the first of those
is a verdict about the file.
*/
async function sampleFirstGopPtsEqualsDts(filePath: string): Promise<boolean | undefined> {
  const { stdout } = await runFfprobe([
    '-hide_banner', '-v', 'error',
    '-select_streams', 'v:0',
    '-show_entries', 'packet=pts,dts',
    '-of', 'csv=p=0',
    '-read_intervals', `%+#${samplePacketCount}`,
    filePath,
  ], { logCli: false });

  return parseFirstGopPtsEqualsDts(decodeStdout(stdout));
}

export async function probeSourceDamageFacts(filePath: string): Promise<SourceProbeFacts> {
  const { hasVideo, hasBFrames, videoStreamCount } = await probeVideoStream(filePath);
  if (!hasVideo) return { hasVideo: false, hasBFrames: false, hasCtts: undefined };
  // Without reordering there is nothing that a missing composition offset could break.
  if (!hasBFrames) return { hasVideo: true, hasBFrames: false, hasCtts: undefined };

  // The box walk reads one video track (the first `trak` with a video media header), and the order
  // of the tracks in the movie header is not the order ffprobe reports. With more than one video
  // track it cannot say which track the B frames belong to, so it is not a verdict about the file:
  // fall back to the packets of the first track.
  const timing = videoStreamCount === 1
    ? await readMoov(filePath)
      .then((moov) => (moov != null ? readMoovVideoTiming(moov) : undefined))
      .catch((err: unknown) => {
        logger.warn('Could not read the movie header', { filePath }, err);
        return undefined;
      })
    : undefined;

  if (timing != null) {
    return { hasVideo: true, hasBFrames: true, hasCtts: timing.hasCtts, cttsAllZero: timing.cttsAllZero };
  }

  logger.info('The frame timing could not be read from the movie header, falling back to a packet sample', { filePath });
  const firstGopPtsEqualsDts = await sampleFirstGopPtsEqualsDts(filePath).catch((err: unknown) => {
    logger.warn('Could not sample the first packets', { filePath }, err);
    return undefined;
  });

  return { hasVideo: true, hasBFrames: true, hasCtts: undefined, firstGopPtsEqualsDts };
}

export async function probeSourceDamage(filePath: string): Promise<SourceDamage[]> {
  let facts: SourceProbeFacts;
  try {
    facts = await probeSourceDamageFacts(filePath);
  } catch (err) {
    // A file that cannot be probed cannot be repaired either. There is nothing to warn about.
    logger.warn('Could not probe the source for damage', { filePath }, err);
    return [];
  }

  const damages = detectSourceDamage(facts);
  if (damages.length > 0) {
    logger.warn('Source video has broken frame timing', { filePath, evidence: facts });
  }
  return damages;
}
