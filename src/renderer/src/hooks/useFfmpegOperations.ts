import { useCallback } from 'react';
import sum from 'lodash/sum';
import pMap from 'p-map';
import invariant from 'tiny-invariant';
import i18n from 'i18next';

import { getSuffixedOutPath, transferTimestamps, getOutFileExtension, getOutDir, getHtml5ifiedPath, unlinkWithRetry, getFrameDuration, isMac, html5ifiedPrefix, html5dummySuffix, assertFileExists, decodeText, isExecaError, getStdioString } from '../util';
import { isCuttingStart, isCuttingEnd, runFfmpegWithProgress, getFfCommandLine, getDuration, createChaptersFromSegments, readFileFfprobeMeta, getExperimentalArgs, getVideoTimescaleArgs, logStdoutStderr, runFfmpegConcat, RefuseOverwriteError, runFfmpeg, readKeyframesAroundTime, findNextKeyframe, findKeyframeNearTime, readVideoConcatDuration } from '../ffmpeg';
import { flacEncodeArgs, getEffectiveAvoidNegativeTs, getKeyframeCutSeekCompensation, getMapStreamsArgs, getStreamIdsToCopy, isCopyingOnlyAudioStreams, isCropActive, isAspectRatioActive } from '../util/streams';
import { needsSmartCut, getCodecParams } from '../smartcut';
import { getGuaranteedSegments, isDurationValid } from '../segments';
import type { FFprobeStream } from '../../../common/ffprobe';
import type { AvoidNegativeTs, FfmpegHwAccel, Html5ifyMode, PreserveMetadata } from '../../../common/types';
import { deleteDispositionValue } from '../types';
import type { AllFilesMeta, Chapter, CopyfileStreams, LiteFFprobeStream, ParamsByFile, SegmentToExport } from '../types';
import type { LossyMode } from '../../../main';
import { UserFacingError } from '../../errors';
import mainApi from '../mainApi';
import { formatFfmpegNumber, getFixChannelLayoutFilter, getHwaccelArgs, hasCustomChannelLayout } from '../../../common/util';
import { buildDamageRepairEncodeArgs, buildRepairVideoArgs, findConcatLayoutMismatch, getDamageRepairVideoBitrate, getEncodedFragmentDuration, getSmartCutHeadEnd, hasKeyframeToCopyFrom, partitionCopiedStreams, planConcatParts, planJoinRepairTail, resolveJoinRepairEncoder } from '../../../common/features/patchExportPolicy';
import type { PatchTailTarget } from '../../../common/features/patchExportPolicy';
import { getFfmpegEncoders } from '../features/patchExportPolicy/ffmpegEncoders';
import { join, resolve, dirname, extname, basename } from '../util/path';

const { writeFile, mkdir, access, constants: { W_OK } } = window.require('node:fs/promises');


export class OutputNotWritableError extends Error {
  constructor() {
    super();
    this.name = 'OutputNotWritableError';
  }
}

async function writeChaptersFfmetadata(outDir: string, chapters: Chapter[] | undefined) {
  if (!chapters || chapters.length === 0) return undefined;

  const path = join(outDir, `ffmetadata-${Date.now()}.txt`);

  const ffmetadata = chapters.map(({ start, end, name }) => (
    `[CHAPTER]\nTIMEBASE=1/1000\nSTART=${Math.floor(start * 1000)}\nEND=${Math.floor(end * 1000)}\ntitle=${name || ''}`
  )).join('\n\n');
  console.log('Writing chapters', ffmetadata);
  await writeFile(path, ffmetadata);
  return path;
}

// Muxers implemented by ffmpeg's movenc.c, i.e. the ones that accept `-movflags`.
// Note: deliberately not util/streams.ts `isMov`, which is a narrower, UI oriented list.
const movencFormats = new Set(['3g2', '3gp', 'f4v', 'ipod', 'ismv', 'mov', 'mp4', 'psp']);

// Muxers implemented by ffmpeg's matroskaenc.c, i.e. the ones that accept `-default_mode`.
const matroskaencFormats = new Set(['matroska', 'webm']);

// ffmpeg tolerates private options belonging to a different muxer, but they add noise to the command line
// that we log, show in "Last commands" and include in error reports - which makes troubleshooting harder.
// If the output format is unknown, ffmpeg infers the muxer from the file extension, so keep the flags to be safe.
function getMovFlags({ outFormat, preserveMovData, movFastStart }: { outFormat: string | undefined, preserveMovData: boolean, movFastStart: boolean }) {
  if (outFormat != null && !movencFormats.has(outFormat)) return [];

  const flags: string[] = [];

  // https://video.stackexchange.com/a/26084/29486
  // https://github.com/mifi/lossless-cut/issues/331#issuecomment-623401794
  if (preserveMovData) flags.push('use_metadata_tags');

  // https://github.com/mifi/lossless-cut/issues/347
  if (movFastStart) flags.push('+faststart');

  if (flags.length === 0) return [];
  return flags.flatMap((flag) => ['-movflags', flag]);
}

// same as getMovFlags, but for the matroska muxer's private options
function getMatroskaFlags(outFormat: string | undefined) {
  if (outFormat != null && !matroskaencFormats.has(outFormat)) return [];

  return [
    '-default_mode', 'infer_no_subs',
    // because it makes sense to not force subtitles disposition to "default" if they were not default in the input file
    // after some testing, it seems that default is actually "infer", contrary to what is documented (ffmpeg doc says "passthrough" is default)
    // https://ffmpeg.org/ffmpeg-formats.html#Options-8
    // https://github.com/mifi/lossless-cut/issues/972#issuecomment-1015176316
  ];
}

const getChaptersInputArgs = (ffmetadataPath: string | undefined) => (ffmetadataPath ? ['-f', 'ffmetadata', '-i', ffmetadataPath] : []);

async function tryDeleteFiles(paths: string[]) {
  return pMap(paths, (path) => unlinkWithRetry(path).catch((err: unknown) => console.error('Failed to delete', path, err)), { concurrency: 5 });
}

/**
patch: which part of a failed concat does not carry the streams the output maps (see
`findConcatLayoutMismatch` in `features/patchExportPolicy/concatParts`).

Probed only after a failure, so the happy path pays nothing. A part that cannot be probed any more
(deleted, unreadable) is skipped instead of hiding the original ffmpeg error.
*/
async function findConcatPartMismatch({ paths, streams }: {
  paths: string[];
  streams: readonly { index: number, codec_type: string }[];
}) {
  const parts = await pMap(paths, async (path) => {
    try {
      return { path, streams: (await readFileFfprobeMeta(path)).streams };
    } catch (err) {
      console.warn('Unable to probe a concat part after a failed concat', path, err);
      return undefined;
    }
  }, { concurrency: 2 });
  return findConcatLayoutMismatch({ expected: streams, parts: parts.filter((part) => part != null) });
}

export async function maybeMkDeepOutDir({ outputDir, fileOutPath }: { outputDir: string, fileOutPath: string }) {
  // cutFileNames might contain slashes and therefore might have a subdir(tree) that we need to mkdir
  // https://github.com/mifi/lossless-cut/issues/1532
  const actualOutputDir = dirname(fileOutPath);
  if (actualOutputDir !== outputDir) await mkdir(actualOutputDir, { recursive: true });
}


function useFfmpegOperations({ filePath, treatInputFileModifiedTimeAsStart, treatOutputFileModifiedTimeAsStart, isEncoding, lossyMode, repairVideoEncode, enableOverwriteOutput, outputPlaybackRate, cutFromAdjustmentFrames, cutToAdjustmentFrames, appendLastCommandsLog, encCustomBitrate, appendFfmpegCommandLog, ffmpegHwaccel }: {
  filePath: string | undefined,
  treatInputFileModifiedTimeAsStart: boolean,
  treatOutputFileModifiedTimeAsStart: boolean | null | undefined,
  enableOverwriteOutput: boolean,
  isEncoding: boolean,
  lossyMode: LossyMode | undefined,
  /**
  patch: the source is damaged in a way that a lossless copy keeps (features/damagedSource), so
  every exported clip has to re-encode its whole video track. Unlike smart cut, which encodes the
  joins and copies the middle, nothing may be copied.
  */
  repairVideoEncode: boolean,
  outputPlaybackRate: number,
  cutFromAdjustmentFrames: number,
  cutToAdjustmentFrames: number,
  appendLastCommandsLog: (a: string) => void,
  encCustomBitrate: number | undefined,
  appendFfmpegCommandLog: (args: string[]) => void,
  ffmpegHwaccel: FfmpegHwAccel,
}) {
  const shouldSkipExistingFile = useCallback(async (path: string) => {
    const fileExists = await mainApi.pathExists(path);

    // If output file exists, check that it is writable, so we can inform user if it's not (or else ffmpeg will fail with "Permission denied")
    // this seems to sometimes happen on Windows, not sure why.
    if (fileExists) {
      try {
        await access(path, W_OK);
      } catch {
        throw new OutputNotWritableError();
      }
    }
    const shouldSkip = !enableOverwriteOutput && fileExists;
    if (shouldSkip) console.log('Not overwriting existing file', path);
    return shouldSkip;
  }, [enableOverwriteOutput]);

  const getOutputPlaybackRateArgs = useCallback(() => (outputPlaybackRate !== 1 ? ['-itsscale', String(1 / outputPlaybackRate)] : []), [outputPlaybackRate]);

  const concatFiles = useCallback(async ({ paths, outDir, outPath, metadataFromPath, includeAllStreams, streams, outFormat, ffmpegExperimental, onProgress = () => undefined, preserveMovData, movFastStart, chapters, preserveMetadataOnMerge, videoTimebase, overwrite = false, durations }: {
    paths: string[],
    outDir: string | undefined,
    outPath: string,
    metadataFromPath: string,
    includeAllStreams: boolean,
    streams: FFprobeStream[],
    outFormat?: string | undefined,
    ffmpegExperimental: boolean,
    onProgress?: (a: number) => void,
    preserveMovData: boolean,
    movFastStart: boolean,
    chapters: Chapter[] | undefined,
    preserveMetadataOnMerge: boolean,
    videoTimebase?: number | undefined,
    /** patch: the file is a result this app owns, so replace it even when overwriting is disabled. */
    overwrite?: boolean | undefined,
    /**
    patch: how long each file is, in the merged timeline (see `readVideoConcatDuration` in `../ffmpeg`). The concat
    demuxer otherwise offsets the next file by the container duration, which is not where the
    video ends, and that is what puts a hole or a duplicate frame at the join.
    */
    durations?: (number | undefined)[] | undefined,
  }) => {
    if (!overwrite && await shouldSkipExistingFile(outPath)) return { haveExcludedStreams: false, wrote: false };

    console.log('Merging files', { paths }, 'to', outPath);

    const fileDurations = await pMap(paths, async (path) => (await getDuration(path)) ?? 0, { concurrency: 1 });
    const totalDuration = sum(fileDurations);

    let chaptersPath: string | undefined;
    if (chapters) {
      const chaptersWithNames = chapters.map((chapter, i) => ({ ...chapter, name: chapter.name || `Chapter ${i + 1}` }));
      invariant(outDir != null);
      chaptersPath = await writeChaptersFfmetadata(outDir, chaptersWithNames);
    }

    try {
      let inputArgs: string[] = [];
      let inputIndex = 0;

      // Keep track of input index to be used later
      // eslint-disable-next-line no-inner-declarations
      function addInput(args: string[]) {
        inputArgs = [...inputArgs, ...args];
        const retIndex = inputIndex;
        inputIndex += 1;
        return retIndex;
      }

      // concat list - always first
      addInput([
        // https://blog.yo1.dog/fix-for-ffmpeg-protocol-not-on-whitelist-error-for-urls/
        '-f', 'concat', '-safe', '0', '-protocol_whitelist', 'file,pipe,fd',
        '-i', '-',
      ]);

      let metadataSourceIndex: number | undefined;
      if (preserveMetadataOnMerge) {
        // If preserve metadata, add the first file (we will get metadata from this input)
        metadataSourceIndex = addInput(['-i', metadataFromPath]);
      }

      let chaptersInputIndex: number | undefined;
      if (chaptersPath) {
        // if chapters, add chapters source file
        chaptersInputIndex = addInput(getChaptersInputArgs(chaptersPath));
      }

      const { streamIdsToCopy, excludedStreamIds } = getStreamIdsToCopy({ streams, includeAllStreams });
      const mapStreamsArgs = getMapStreamsArgs({
        allFilesMeta: { [metadataFromPath]: { streams } },
        copyFileStreams: [{ path: metadataFromPath, streamIds: streamIdsToCopy }],
        outFormat,
        manuallyCopyDisposition: true,
        needFlac: true, // https://github.com/mifi/lossless-cut/issues/2636
      });

      // Keep this similar to losslessCutSingle()
      const ffmpegArgs = [
        '-hide_banner',
        // No progress if we set loglevel warning :(
        // '-loglevel', 'warning',

        ...inputArgs,

        ...mapStreamsArgs,

        // -map_metadata 0 with concat demuxer doesn't transfer metadata from the concat'ed file input (index 0) when merging.
        // So we use the first file file (index 1) for metadata
        // Can only do this if allStreams (-map 0) is set
        ...(metadataSourceIndex != null ? ['-map_metadata', String(metadataSourceIndex)] : []),

        ...(chaptersInputIndex != null ? ['-map_chapters', String(chaptersInputIndex)] : []),

        ...getMovFlags({ outFormat, preserveMovData, movFastStart }),
        ...getMatroskaFlags(outFormat),

        // See https://github.com/mifi/lossless-cut/issues/170
        '-ignore_unknown',

        ...getExperimentalArgs(ffmpegExperimental),

        ...getVideoTimescaleArgs(videoTimebase),

        ...(outFormat ? ['-f', outFormat] : []),
        '-y', outPath,
      ];

      // https://superuser.com/questions/787064/filename-quoting-in-ffmpeg-concat
      // Must add "file:" or we get "Impossible to open 'pipe:xyz.mp4'" on newer ffmpeg versions
      // https://superuser.com/questions/718027/ffmpeg-concat-doesnt-work-with-absolute-path
      const concatTxt = paths.map((file, index) => {
        const fileLine = `file 'file:${resolve(file).replaceAll('\'', String.raw`'\''`)}'`;
        // patch: an explicit duration makes the next file start exactly where this file's video
        // ends, instead of at its container duration (see `readVideoConcatDuration` in `../ffmpeg`).
        const duration = durations?.[index];
        return duration != null ? `${fileLine}\nduration ${formatFfmpegNumber(duration)}` : fileLine;
      }).join('\n');

      const ffmpegCommandLine = getFfCommandLine('ffmpeg', ffmpegArgs);

      const fullCommandLine = `echo -e "${concatTxt.replaceAll('\n', String.raw`\n`)}" | ${ffmpegCommandLine}`;
      console.log(fullCommandLine);
      appendLastCommandsLog(fullCommandLine);

      let result: Awaited<ReturnType<typeof runFfmpegConcat>>;
      try {
        result = await runFfmpegConcat({ ffmpegArgs, concatTxt, totalDuration, onProgress });
      } catch (err) {
        // patch: the concat demuxer takes its stream list from the first file, so a part that lost a
        // track makes one of the maps fail with an error that does not name the culprit (see
        // `concatParts.ts`). Only a failure pays for probing the parts.
        const mismatch = await findConcatPartMismatch({ paths, streams });
        if (mismatch == null) throw err;
        const file = basename(mismatch.path);
        throw new UserFacingError(i18n.t(mismatch.missing
          ? 'The pieces of this clip cannot be joined: the file "{{file}}" has no {{type}} track. Export again; if it keeps happening, set "Cut points when merging" to C — no re-encode.'
          : 'The pieces of this clip cannot be joined: the tracks of the file "{{file}}" do not match the rest of the clip. Export again; if it keeps happening, set "Cut points when merging" to C — no re-encode.', {
          file,
          type: mismatch.expectedCodecType,
        }), { cause: err });
      }
      logStdoutStderr(result);

      await transferTimestamps({ inPath: metadataFromPath, outPath, treatInputFileModifiedTimeAsStart, treatOutputFileModifiedTimeAsStart, duration: totalDuration });

      return { haveExcludedStreams: excludedStreamIds.length > 0, wrote: true };
    } finally {
      if (chaptersPath) await tryDeleteFiles([chaptersPath]);
    }
  }, [appendLastCommandsLog, shouldSkipExistingFile, treatInputFileModifiedTimeAsStart, treatOutputFileModifiedTimeAsStart]);

  const losslessCutSingle = useCallback(async ({
    keyframeCut: ssBeforeInput, avoidNegativeTs, copyFileStreams, cutFrom, cutTo, chaptersPath, onProgress, outPath,
    fileDuration, rotation, allFilesMeta, outFormat, shortestFlag, ffmpegExperimental, preserveMetadata, preserveMovData, preserveChapters, movFastStart, paramsByFile, videoTimebase, detectedFps,
    /** patch: extra seconds kept past `cutTo` so a merged join has no missing frames. */
    cutToGuardSeconds,
  }: {
    keyframeCut: boolean,
    avoidNegativeTs: AvoidNegativeTs | undefined,
    copyFileStreams: CopyfileStreams,
    cutFrom: number,
    cutTo: number,
    chaptersPath: string | undefined,
    onProgress: (p: number) => void,
    outPath: string,
    fileDuration: number | undefined,
    rotation: number | undefined,
    allFilesMeta: AllFilesMeta,
    outFormat: string,
    shortestFlag: boolean,
    ffmpegExperimental: boolean,
    preserveMetadata: PreserveMetadata,
    preserveMovData: boolean,
    preserveChapters: boolean,
    movFastStart: boolean,
    paramsByFile: ParamsByFile,
    videoTimebase?: number | undefined,
    detectedFps?: number,
    /** patch: extra seconds kept past `cutTo` so a merged join has no missing frames. */
    cutToGuardSeconds?: number | undefined,
  }) => {
    const frameDuration = getFrameDuration(detectedFps);

    const cuttingStart = isCuttingStart(cutFrom);
    const cutFromWithAdjustment = cutFrom + cutFromAdjustmentFrames * frameDuration;
    const cutToWithAdjustment = cutTo + cutToAdjustmentFrames * frameDuration;
    const cuttingEnd = isCuttingEnd(cutTo, fileDuration);
    const areWeCutting = cuttingStart || cuttingEnd;
    if (areWeCutting) console.log('Cutting from', cuttingStart ? `${cutFrom} (${cutFromWithAdjustment} adjusted ${cutFromAdjustmentFrames} frames)` : 'start', 'to', cuttingEnd ? `${cutTo} (adjusted ${cutToAdjustmentFrames} frames)` : 'end');

    // ensure at least one frame duration (ffmpeg >= 8.1 rejects a negative `-t`, e.g. with cut from/to adjustment on a short segment)
    const cutDuration = Math.max(cutToWithAdjustment - cutFromWithAdjustment, frameDuration);

    // patch: a merged export keeps a few extra frames past the cut point. A lossless cut stops on a
    // packet boundary, so the trailing B-frames (which reference a frame outside the segment) are
    // dropped; inside one file that is invisible, but in a merged file it is a freeze at the join.
    const cutDurationWithGuard = cutDuration + (cutToGuardSeconds ?? 0);


    const copyFileStreamsFiltered = copyFileStreams.filter(({ streamIds }) => streamIds.length > 0);

    // Undo ffmpeg's earlier seek for Matroska with B-frames, so the cut doesn't start one keyframe too early (#1216)
    // `-itsoffset` keeps the output's zero point (and so `-t`) at the original cut start. Only for a single input with `-ss` before `-i`.
    const singleInputMeta = copyFileStreamsFiltered.length === 1 ? allFilesMeta[copyFileStreamsFiltered[0]!.path] : undefined;
    const seekCompensation = ssBeforeInput && cuttingStart && singleInputMeta != null
      ? getKeyframeCutSeekCompensation({ formatName: singleInputMeta.format.format_name, streams: singleInputMeta.streams, cutFrom: cutFromWithAdjustment })
      : 0;

    // Don't cut if not needed: https://github.com/mifi/lossless-cut/issues/50
    const cutFromArgs = cuttingStart ? ['-ss', formatFfmpegNumber(cutFromWithAdjustment + seekCompensation)] : [];
    const seekCompensationArgs = seekCompensation > 0 ? ['-itsoffset', formatFfmpegNumber(seekCompensation)] : [];
    const cutToArgs = cuttingEnd ? ['-t', formatFfmpegNumber(cutDurationWithGuard)] : [];

    // remove -avoid_negative_ts make_zero when not cutting start (no -ss), or else some videos get blank first frame in QuickLook
    // note: `make_zero`/`make_non_negative` get downgraded to `auto` when copying a cover art stream, or else the
    // output gets the segment's end time as its duration, see https://github.com/mifi/lossless-cut/issues/3009
    const effectiveAvoidNegativeTs = getEffectiveAvoidNegativeTs({ avoidNegativeTs, allFilesMeta, copyFileStreams: copyFileStreamsFiltered });
    const avoidNegativeTsArgs = cuttingStart && effectiveAvoidNegativeTs && ssBeforeInput ? ['-avoid_negative_ts', String(effectiveAvoidNegativeTs)] : [];

    // When seeking after the input (keyframe cut mode off), keep leading non-keyframe packets for audio-only exports,
    // or else the cut starts late for audio files where not all packets are flagged as keyframes. See isCopyingOnlyAudioStreams
    const copyInitialNonKeyframesArgs = cuttingStart && !ssBeforeInput && isCopyingOnlyAudioStreams({ allFilesMeta, copyFileStreams: copyFileStreamsFiltered }) ? ['-copyinkf'] : [];

    // If cutting multiple files, `-ss` must be before `-i`, regardless of `ssBeforeInput` choice
    // and it seems that `-t` must be after `-i` #896
    const inputFilesArgs = copyFileStreamsFiltered.length > 1
      ? copyFileStreamsFiltered.flatMap(({ streamIds, path }) => {
        const fileParams = paramsByFile.get(path);
        // Don't cut/seek cover art or images attached by users - it will break them, see https://github.com/mifi/lossless-cut/issues/2884
        const streamParams = streamIds.map((streamId) => fileParams?.paramsByStream.get(streamId));
        if (streamIds.length === 1 && streamParams[0]?.disposition === 'attached_pic') {
          return ['-i', path];
        }

        const itsOffsetArgs = fileParams?.offset ? ['-itsoffset', formatFfmpegNumber(fileParams.offset)] : [];

        return [
          ...cutFromArgs,
          ...itsOffsetArgs,
          '-i', path,
          ...cutToArgs,
        ];
      })
      : [
        ...(ssBeforeInput ? [...cutFromArgs, ...seekCompensationArgs] : []),
        '-i', copyFileStreamsFiltered[0]!.path,
        ...(!ssBeforeInput ? cutFromArgs : []),
        ...cutToArgs,
      ];

    const chaptersInputIndex = copyFileStreamsFiltered.length;

    const rotationArgs = rotation !== undefined ? ['-display_rotation:v:0', String(360 - rotation)] : [];

    // This function tries to calculate the output stream index needed for -metadata:s:x and -disposition:x arguments
    // It is based on the assumption that copyFileStreamsFiltered contains the order of the input files (and their respective streams orders) sent to ffmpeg, to hopefully calculate the same output stream index values that ffmpeg does internally.
    // It also takes into account previously added files that have been removed and disabled streams.
    function mapInputStreamIndexToOutputIndex(inputFilePath: string, inputFileStreamIndex: number) {
      let streamCount = 0;
      // Count copied streams of all files until this input file
      const foundFile = copyFileStreamsFiltered.find(({ path: path2, streamIds }) => {
        if (path2 === inputFilePath) return true;
        streamCount += streamIds.length;
        return false;
      });
      if (!foundFile) return undefined; // Could happen if a tag has been edited on an external file, then the file was removed

      // Then add the index of the current stream index to the count
      const copiedStreamIndex = foundFile.streamIds.indexOf(inputFileStreamIndex);
      if (copiedStreamIndex === -1) return undefined; // Could happen if a tag has been edited on a stream, but the stream is disabled
      return streamCount + copiedStreamIndex;
    }

    invariant(filePath != null);

    const customFileMetadataArgs = Object.entries(paramsByFile.get(filePath)?.metadata ?? {}).flatMap(([key, value]) => [
      '-metadata', `${key}=${value}`,
    ]);

    const mapStreamsArgs = getMapStreamsArgs({ copyFileStreams: copyFileStreamsFiltered, allFilesMeta, outFormat, needFlac: areWeCutting });

    const customParamsArgs = (() => {
      const ret: string[] = [];
      for (const [fileId, { paramsByStream }] of paramsByFile.entries()) {
        for (const [streamId, streamParams] of paramsByStream.entries()) {
          const outputIndex = mapInputStreamIndexToOutputIndex(fileId, streamId);
          if (outputIndex == null) continue;

          const { disposition } = streamParams;
          if (disposition != null) {
            // "0" means delete the disposition for this stream
            const dispositionArg = disposition === deleteDispositionValue ? '0' : disposition;
            ret.push(`-disposition:${outputIndex}`, String(dispositionArg));
          }

          const bitstreamFilters: string[] = [];
          if (streamParams.bsfH264Mp4toannexb) bitstreamFilters.push('h264_mp4toannexb');
          if (streamParams.bsfHevcMp4toannexb) bitstreamFilters.push('hevc_mp4toannexb');
          if (streamParams.bsfHevcAudInsert) bitstreamFilters.push('hevc_metadata=aud=insert');

          const getFileStreams = () => allFilesMeta[fileId]?.streams;
          const getStream = () => getFileStreams()?.find((s) => s.index === streamId);

          // Lossless crop via codec bitstream metadata (#643)
          if (isCropActive(streamParams.crop)) {
            const { left, right, top, bottom } = streamParams.crop;
            // Look up codec_name from allFilesMeta to determine the correct bitstream filter
            const streamInfo = getStream();
            const codecName = streamInfo?.codec_name;

            const cropParams = `crop_left=${left}:crop_right=${right}:crop_top=${top}:crop_bottom=${bottom}`;
            if (codecName === 'h264') {
              bitstreamFilters.push(`h264_metadata=${cropParams}`);
            } else if (codecName === 'hevc') {
              bitstreamFilters.push(`hevc_metadata=${cropParams}`);
            }
          }

          // Lossless aspect ratio (SAR) via codec bitstream metadata (#643)
          if (isAspectRatioActive(streamParams.aspectRatio)) {
            const { num, den } = streamParams.aspectRatio;
            const streamInfo = getStream();
            const codecName = streamInfo?.codec_name;

            if (codecName === 'h264') {
              bitstreamFilters.push(`h264_metadata=sample_aspect_ratio=${num}/${den}`);
            } else if (codecName === 'hevc') {
              bitstreamFilters.push(`hevc_metadata=sample_aspect_ratio=${num}/${den}`);
            } else {
              // For non-H264/HEVC codecs, use container-level -aspect flag
              ret.push('-aspect', `${num}:${den}`);
            }
          }

          if (bitstreamFilters.length > 0) {
            ret.push(`-bsf:${outputIndex}`, bitstreamFilters.join(','));
          }

          if (streamParams.tag != null) {
            ret.push(`-tag:${outputIndex}`, streamParams.tag);
          }

          // custom stream metadata
          if (streamParams.metadata != null) {
            for (const [tag, value] of Object.entries(streamParams.metadata)) {
              ret.push(`-metadata:s:${outputIndex}`, `${tag}=${value}`);
            }
          }
        }
      }
      return ret;
    })();

    function getPreserveMetadata() {
      if (preserveMetadata === 'default') return ['-map_metadata', '0']; // todo isn't this ffmpeg default and can be omitted? https://stackoverflow.com/a/67508734/6519037
      if (preserveMetadata === 'none') return ['-map_metadata', '-1'];
      if (preserveMetadata === 'nonglobal') return ['-map_metadata:g', '-1']; // https://superuser.com/a/1546267/658247
      return [];
    }

    function getPreserveChapters() {
      if (chaptersPath) return ['-map_chapters', String(chaptersInputIndex)];
      // todo should preserve chapters be hardcoded (and disabled in UI) when segmentsToChaptersOnly mode is enabled?
      if (!preserveChapters) return ['-map_chapters', '-1']; // https://github.com/mifi/lossless-cut/issues/2176
      return []; // default: includes chapters from input
    }

    const ffmpegArgs = [
      '-hide_banner',
      // No progress if we set loglevel warning :(
      // '-loglevel', 'warning',

      ...getOutputPlaybackRateArgs(),

      ...rotationArgs,

      ...inputFilesArgs,
      ...getChaptersInputArgs(chaptersPath),

      ...avoidNegativeTsArgs,

      ...copyInitialNonKeyframesArgs,

      ...mapStreamsArgs,

      ...getPreserveMetadata(),

      ...getPreserveChapters(),

      ...(shortestFlag ? ['-shortest'] : []),

      ...getMovFlags({ outFormat, preserveMovData, movFastStart }),
      ...getMatroskaFlags(outFormat),

      ...customFileMetadataArgs,

      ...customParamsArgs,

      // See https://github.com/mifi/lossless-cut/issues/170
      '-ignore_unknown',

      ...getExperimentalArgs(ffmpegExperimental),

      ...getVideoTimescaleArgs(videoTimebase),

      '-f', outFormat, '-y', outPath,
    ];

    appendFfmpegCommandLog(ffmpegArgs);
    const result = await runFfmpegWithProgress({ ffmpegArgs, duration: cutDurationWithGuard, onProgress });
    logStdoutStderr(result);

    await transferTimestamps({ inPath: filePath, outPath, cutFrom, cutTo, treatInputFileModifiedTimeAsStart, duration: isDurationValid(fileDuration) ? fileDuration : undefined, treatOutputFileModifiedTimeAsStart });
  }, [appendFfmpegCommandLog, cutFromAdjustmentFrames, cutToAdjustmentFrames, filePath, getOutputPlaybackRateArgs, treatInputFileModifiedTimeAsStart, treatOutputFileModifiedTimeAsStart]);

  /**
  Remux the two passes of a split cut into the final clip (fork, merged patch exports only).

  `avPath` holds the video and audio, cut with `-shortest`, so it ends on a complete group of
  frames. `otherPath` holds the subtitle/data/attachment tracks, cut without `-shortest` so their
  own length cannot end the clip early. Both are already encoded the way the output format wants,
  except for the container conversions ffmpeg applies to a stream the format cannot hold (e.g.
  subrip -> mov_text for mp4); probing the parts lets the same per-stream flags be computed here.
  */
  const remuxSplitParts = useCallback(async ({ avPath, otherPath, outPath, outFormat, movFastStart, preserveMovData, ffmpegExperimental, duration, onProgress }: {
    avPath: string,
    otherPath: string,
    outPath: string,
    outFormat: string,
    movFastStart: boolean,
    preserveMovData: boolean,
    ffmpegExperimental: boolean,
    duration: number,
    onProgress: (p: number) => void,
  }) => {
    const [{ streams: avStreams }, { streams: otherStreams }] = await Promise.all([readFileFfprobeMeta(avPath), readFileFfprobeMeta(otherPath)]);

    const mapStreamsArgs = getMapStreamsArgs({
      allFilesMeta: { [avPath]: { streams: avStreams }, [otherPath]: { streams: otherStreams } },
      copyFileStreams: [
        { path: avPath, streamIds: avStreams.map((stream) => stream.index) },
        { path: otherPath, streamIds: otherStreams.map((stream) => stream.index) },
      ],
      outFormat,
    });

    const ffmpegArgs = [
      '-hide_banner',
      // No progress if we set loglevel warning :(
      // '-loglevel', 'warning',

      '-i', avPath,
      '-i', otherPath,

      ...mapStreamsArgs,

      // Chapters were written by the first pass (they belong to the clip, not to the tracks).
      '-map_metadata', '0',
      '-map_chapters', '0',

      ...getMovFlags({ outFormat, preserveMovData, movFastStart }),
      ...getMatroskaFlags(outFormat),

      // See https://github.com/mifi/lossless-cut/issues/170
      '-ignore_unknown',

      ...getExperimentalArgs(ffmpegExperimental),

      '-f', outFormat, '-y', outPath,
    ];

    appendFfmpegCommandLog(ffmpegArgs);
    const result = await runFfmpegWithProgress({ ffmpegArgs, duration, onProgress });
    logStdoutStderr(result);
  }, [appendFfmpegCommandLog]);

  // inspired by https://gist.github.com/fernandoherreradelasheras/5eca67f4200f1a7cc8281747da08496e
  const cutEncodeSmartPart = useCallback(async ({ cutFrom, cutTo, outPath, outFormat, videoCodec, videoBitrate, videoTimebase, allFilesMeta, copyFileStreams, videoStreamIndex, ffmpegExperimental, hasBFrames, videoEncoderArgs, fragmentFrameDuration }: {
    cutFrom: number,
    cutTo: number,
    outPath: string,
    outFormat: string,
    videoCodec: string,
    videoBitrate: number,
    videoTimebase: number,
    allFilesMeta: AllFilesMeta,
    copyFileStreams: CopyfileStreams,
    videoStreamIndex: number,
    ffmpegExperimental: boolean,
    hasBFrames: number | undefined,
    /** patch: the source properties a join-repair fragment has to keep (see patchExportPolicy/encoderArgs). */
    videoEncoderArgs?: string[] | undefined,
    /**
    patch: set when this piece is concatenated with the rest of the clip. The end of the piece is then
    extended by a sub-frame epsilon, or the frame that starts exactly at the end is dropped and the
    piece can come out with no video at all (see `getEncodedFragmentDuration`).
    */
    fragmentFrameDuration?: number | undefined,
  }) => {
    invariant(filePath != null);

    function getVideoArgs({ streamIndex, outputIndex }: { streamIndex: number, outputIndex: number }) {
      if (streamIndex !== videoStreamIndex) return undefined;

      const args = [
        `-c:${outputIndex}`, videoCodec,
        `-b:${outputIndex}`, String(videoBitrate),
        ...(videoEncoderArgs ?? []),
      ];

      // seems like ffmpeg handles this itself well when encoding same source file
      // if (videoLevel != null) args.push(`-level:${outputIndex}`, videoLevel);
      // if (videoProfile != null) args.push(`-profile:${outputIndex}`, videoProfile);

      return args;
    }

    const mapStreamsArgs = getMapStreamsArgs({
      allFilesMeta,
      copyFileStreams,
      outFormat,
      getVideoArgs,
    });

    // patch: a concatenated fragment keeps the frame that starts exactly at its end; a piece that
    // encodes the whole clip keeps its exact length (see `getEncodedFragmentDuration`).
    const cutDuration = fragmentFrameDuration != null
      ? getEncodedFragmentDuration({ cutFrom, cutTo, frameDuration: fragmentFrameDuration })
      : cutTo - cutFrom;

    const ffmpegArgs = [
      '-hide_banner',
      // No progress if we set loglevel warning :(
      // '-loglevel', 'warning',

      '-ss', formatFfmpegNumber(cutFrom), // if we don't -ss before -i, seeking will be slow for long files, see https://github.com/mifi/lossless-cut/issues/126#issuecomment-1135451043
      '-i', filePath,
      '-ss', '0', // If we don't do this, the output seems to start with an empty black after merging with the encoded part
      '-t', formatFfmpegNumber(cutDuration),

      ...mapStreamsArgs,

      // See https://github.com/mifi/lossless-cut/issues/170
      '-ignore_unknown',

      ...getVideoTimescaleArgs(videoTimebase),

      ...(hasBFrames ? ['-bf', String(hasBFrames)] : []),

      ...getExperimentalArgs(ffmpegExperimental),

      '-f', outFormat, '-y', outPath,
    ];

    appendFfmpegCommandLog(ffmpegArgs);
    await runFfmpeg(ffmpegArgs);
  }, [appendFfmpegCommandLog, filePath]);

  const cutMultiple = useCallback(async ({
    outputDir, customOutDir, segments: segmentsIn, cutFileNames, fileDuration, rotation, detectedFps, onProgress: onTotalProgress, keyframeCut, copyFileStreams, allFilesMeta, outFormat, shortestFlag, ffmpegExperimental, preserveMetadata, preserveMetadataOnMerge, preserveMovData, preserveChapters, movFastStart, avoidNegativeTs, paramsByFile, chapters, overwritePaths, cutToGuardSeconds, splitNonAvStreams, repairJoins, tailTargets, patchMode,
  }: {
    outputDir: string,
    customOutDir: string | undefined,
    segments: SegmentToExport[],
    cutFileNames: string[],
    fileDuration: number | undefined,
    rotation: number | undefined,
    detectedFps: number | undefined,
    onProgress: (p: number) => void,
    keyframeCut: boolean,
    copyFileStreams: CopyfileStreams,
    allFilesMeta: AllFilesMeta,
    outFormat: string | undefined,
    /** patch: already resolved by the caller: `false` when a copied track would end the clip early. */
    shortestFlag: boolean,
    ffmpegExperimental: boolean,
    preserveMetadata: PreserveMetadata,
    preserveMovData: boolean,
    preserveMetadataOnMerge: boolean,
    preserveChapters: boolean,
    movFastStart: boolean,
    avoidNegativeTs: AvoidNegativeTs | undefined,
    paramsByFile: ParamsByFile,
    chapters: Chapter[] | undefined,
    /** patch: results the app owns; they are rewritten even when "overwrite output" is disabled. */
    overwritePaths?: ReadonlySet<string> | undefined,
    /** patch: extra seconds kept past every cut end (only set for merged patch exports). */
    cutToGuardSeconds?: number | undefined,
    /** patch: cut the subtitle/data tracks in their own pass (see `PatchCutPolicy.splitNonAvStreams`). */
    splitNonAvStreams?: boolean | undefined,
    /**
    patch: repair the joins of a merged export by re-encoding the first and last GOP of every clip
    and giving the merge an explicit duration per clip (see `features/patchExportPolicy/policy.ts`).
    */
    repairJoins?: boolean | undefined,
    /**
    patch: the effective cut end of the last result, when it has to keep the source's last frame
    (see `features/patchExportPolicy/tailEnd.ts`). Only the segment named here is adjusted.
    */
    tailTargets?: ReadonlyMap<string, PatchTailTarget> | undefined,
    /**
    patch: the export runs in patch mode. Only read as the fallback for a smart cut that cannot be
    placed (see the `needsSmartCut` call below): the join repair is not the only patch cut that must
    produce a result, and a repair that was blocked (another codec, a subtitle track, rotation, an
    unknown frame rate) still leaves a clip the user asked for.
    */
    patchMode?: boolean | undefined,
  }) => {
    console.log('paramsByFile', paramsByFile);

    const segments = getGuaranteedSegments(segmentsIn, fileDuration);

    const singleProgresses: Record<number, number> = {};
    function onSingleProgress(id: number, singleProgress: number) {
      singleProgresses[id] = singleProgress;
      return onTotalProgress((sum(Object.values(singleProgresses)) / segments.length));
    }

    invariant(filePath != null);
    await assertFileExists(filePath);

    const chaptersPath = await writeChaptersFfmetadata(outputDir, chapters);

    // This function will either call losslessCutSingle (if no smart cut enabled)
    // or if enabled, will first cut&encode the part before the next keyframe, trying to match the input file's codec params
    // then it will cut the part *from* the keyframe to "end", and concat them together and return the concated file
    // so that for the calling code it looks as if it's just a normal segment
    //
    // patch: `repairJoins` (a merged patch export) uses the same encode/copy/encode shape for a
    // different reason: a lossless cut cannot end on a non-keyframe without dropping frames, and a
    // copied first GOP starts ~50 ms after its audio. See features/patchExportPolicy/policy.ts.
    const repairJoinsNow = repairJoins ?? false;
    const cutSegment = async ({ start: desiredCutFrom, end: requestedCutTo }: { start: number, end: number }, i: number, tailTarget: PatchTailTarget | undefined) => {
      // patch: the last result may keep the frame at its end (or the rest of the source). The plan
      // is a concrete end, so the rest of the cutters only see `cutTo` as usual.
      const cutTo = tailTarget?.cutTo ?? requestedCutTo;
      // patch: the tail target already decides where the last result ends. A's join guard would add
      // another six frames to it, and there is no next join after the last result.
      const guardSeconds = tailTarget != null ? 0 : cutToGuardSeconds;
      // patch: `-shortest` would end the last result at a shorter track and drop the very frame the
      // tail target exists to keep.
      const effectiveShortestFlag = tailTarget != null ? false : shortestFlag;
      const onProgress = (progress: number) => onSingleProgress(i, progress / 2);
      const onConcatProgress = (progress: number) => onSingleProgress(i, (1 + progress) / 2);

      const finalOutPath = join(outputDir, cutFileNames[i]!);

      // patch: a result this export replaces (its own previous file) is rewritten even when
      // "overwrite output" is disabled. `overwriteResult` must reach the inner steps too: they
      // write through `shouldSkipExistingFile` and the concat step, and a silent skip there would
      // report `created: true` for a file that never changed.
      const overwriteResult = overwritePaths?.has(finalOutPath) === true;

      if (!overwriteResult && await shouldSkipExistingFile(finalOutPath)) return { path: finalOutPath, created: false };

      await maybeMkDeepOutDir({ outputDir, fileOutPath: finalOutPath });

      if (!isEncoding && !repairJoinsNow && !repairVideoEncode) {
        // simple lossless cut
        invariant(outFormat != null);

        // patch: a subtitle/data track cannot be in the `-shortest` pass. It usually ends long before
        // the video, and `-shortest` ends the output at its end, which would truncate the clip. Cutting
        // it in its own pass keeps `-shortest` for the video/audio pass and the track keeps its length.
        // Both passes need something to write, or a plain single cut does the same job.
        const splitParts = (splitNonAvStreams ?? false)
          ? partitionCopiedStreams({
            copyFileStreams,
            streamsByPath: Object.fromEntries(Object.entries(allFilesMeta).map(([path, meta]) => [path, meta.streams] as const)),
          })
          : undefined;

        if (splitParts != null && splitParts.av.length > 0 && splitParts.other.length > 0) {
          const ext = getOutFileExtension({ isCustomFormatSelected: true, outFormat, filePath });
          const avOutPath = getSuffixedOutPath({ customOutDir, filePath, nameSuffix: `split-av-${i}${ext}` });
          const otherOutPath = getSuffixedOutPath({ customOutDir, filePath, nameSuffix: `split-tracks-${i}.mkv` });

          const cutArgs = {
            cutFrom: desiredCutFrom, cutTo, fileDuration, rotation, keyframeCut, avoidNegativeTs, allFilesMeta, ffmpegExperimental, preserveMetadata, preserveMovData, movFastStart, paramsByFile, cutToGuardSeconds: guardSeconds,
          } as const;

          try {
            // Video and audio only: `-shortest` may end this pass on a complete group of frames. It is
            // left out when the audio is the shorter stream, which would end the pass before the
            // video (see `PatchCutPolicy.shortestBlocked`).
            await losslessCutSingle({
              ...cutArgs, chaptersPath, outPath: avOutPath, copyFileStreams: splitParts.av, outFormat, shortestFlag: effectiveShortestFlag, preserveChapters, onProgress: (progress) => onSingleProgress(i, progress * 0.85),
            });
            // Everything else: no `-shortest` (a short subtitle would end the pass at its own end), and
            // a container that can hold any track, whatever the final format is. `rotation` is left out
            // on purpose: `-display_rotation:v:0` has no video stream to apply to in this pass.
            await losslessCutSingle({
              ...cutArgs, rotation: undefined, chaptersPath: undefined, outPath: otherOutPath, copyFileStreams: splitParts.other, outFormat: 'matroska', shortestFlag: false, preserveChapters: false, onProgress: (progress) => onSingleProgress(i, 0.85 + progress * 0.1),
            });
            await remuxSplitParts({
              avPath: avOutPath, otherPath: otherOutPath, outPath: finalOutPath, outFormat, movFastStart, preserveMovData, ffmpegExperimental, duration: cutTo - desiredCutFrom, onProgress: (progress) => onSingleProgress(i, 0.95 + progress * 0.05),
            });
            await transferTimestamps({ inPath: filePath, outPath: finalOutPath, cutFrom: desiredCutFrom, cutTo, treatInputFileModifiedTimeAsStart, duration: isDurationValid(fileDuration) ? fileDuration : undefined, treatOutputFileModifiedTimeAsStart });
          } finally {
            await tryDeleteFiles([avOutPath, otherOutPath]);
          }

          return { path: finalOutPath, created: true };
        }

        await losslessCutSingle({
          cutFrom: desiredCutFrom, cutTo, chaptersPath, outPath: finalOutPath, copyFileStreams, keyframeCut, avoidNegativeTs, fileDuration, rotation, allFilesMeta, outFormat, shortestFlag: effectiveShortestFlag, ffmpegExperimental, preserveMetadata, preserveMovData, preserveChapters, movFastStart, paramsByFile, onProgress: (progress) => onSingleProgress(i, progress), cutToGuardSeconds: guardSeconds,
        });
        return { path: finalOutPath, created: true };
      }

      // we are probably encoding (`isEncoding`: true, smart cut or lossy mode)
      // patch: or repairing the joins of a merged export (`repairJoins`), which encodes the two GOPs
      // a lossless cut cannot end cleanly and copies the middle.

      // smart cut only supports cutting main file (no externally added files)
      const { streams } = allFilesMeta[filePath]!;
      const streamsToCopyFromMainFile = copyFileStreams.find(({ path }) => path === filePath)!.streamIds
        .flatMap((streamId) => {
          const match = streams.find((stream) => stream.index === streamId);
          return match ? [match] : [];
        });

      const sourceCodecParams = await getCodecParams({ path: filePath, fileDuration, streams: streamsToCopyFromMainFile });
      const { videoStream, videoTimebase } = sourceCodecParams;

      // patch: when repairing joins, pin the encoder: upstream passes the codec name (`h264`) and
      // ffmpeg then takes whichever encoder it registered first (see patchExportPolicy/encoder.ts).
      // A build without that encoder falls back to the codec name, and the repaired fragments follow
      // the source's pixel format, colour tags and field order (see patchExportPolicy/encoderArgs.ts).
      // A damaged source (`repairVideoEncode`) needs the same treatment, because its whole video track
      // is encoded: matching the source keeps the colours and the field structure of every clip.
      const pinsEncoder = (repairJoinsNow || repairVideoEncode) && lossyMode == null;
      let repairEncoder: string | undefined;
      let videoEncoderArgs: string[] | undefined;
      if (pinsEncoder) {
        const available = await getFfmpegEncoders();
        const resolved = resolveJoinRepairEncoder({
          detectedCodec: sourceCodecParams.videoCodec,
          available: available != null ? new Set(available) : undefined,
        });
        if (resolved.fellBack) {
          console.warn('Join repair: this ffmpeg build has no pinned encoder, falling back to the codec name', {
            detectedCodec: sourceCodecParams.videoCodec,
            encoder: resolved.encoder,
          });
        }
        repairEncoder = resolved.encoder;
        const sourceVideoStream = streams.find((stream) => stream.index === videoStream.index);
        if (sourceVideoStream != null) {
          videoEncoderArgs = buildRepairVideoArgs({
            pixFmt: sourceVideoStream.pix_fmt,
            fieldOrder: sourceVideoStream.field_order,
            colorRange: sourceVideoStream.color_range,
            colorSpace: sourceVideoStream.color_space,
            colorTransfer: sourceVideoStream.color_transfer,
            colorPrimaries: sourceVideoStream.color_primaries,
          }, resolved.encoder);
        }

        if (repairVideoEncode) {
          // A quality-targeted encode at full resolution: `-b:v 0` hands the rate control to `-crf`
          // (see below), and `-bf 0` keeps the output free of reordering, so its timing is correct by
          // construction - the same shape as a source that never had the damage.
          videoEncoderArgs = [
            ...(videoEncoderArgs ?? []),
            ...buildDamageRepairEncodeArgs({ encoder: resolved.encoder, lossy: false }),
          ];
        }
      }

      // patch: the same guarantee when lossy mode picks the encoder, which turns the pin off. Lossy
      // mode keeps its own encoder and bitrate; only the frame order may not be left to chance.
      if (repairVideoEncode && lossyMode != null) {
        videoEncoderArgs = [
          ...(videoEncoderArgs ?? []),
          ...buildDamageRepairEncodeArgs({ encoder: lossyMode.videoEncoder, lossy: true }),
        ];
      }

      const videoCodec = lossyMode
        ? lossyMode.videoEncoder
        : (pinsEncoder ? (repairEncoder ?? sourceCodecParams.videoCodec) : sourceCodecParams.videoCodec);

      const copyFileStreamsFiltered = [{
        path: filePath,
        // with smart cut, we only copy/cut *one* video stream, and *all* other non-video streams (main file only)
        // patch: the repair encodes the main video track of the whole segment, so another video track
        // is copied beside it instead of being dropped (smart cut drops them because it copies the
        // middle of one track only).
        streamIds: streamsToCopyFromMainFile
          .filter((stream) => repairVideoEncode || stream.index === videoStream.index || stream.codec_type !== 'video')
          .map((stream) => stream.index),
      }];

      // eslint-disable-next-line no-shadow
      async function cutEncodeSmartPartWrapper({ cutFrom, cutTo, outPath, force = false, fragmentFrameDuration }: { cutFrom: number, cutTo: number, outPath: string, force?: boolean | undefined, fragmentFrameDuration?: number | undefined }) {
        if (!force && !overwriteResult && await shouldSkipExistingFile(outPath)) return false;
        invariant(videoCodec != null);
        invariant(sourceCodecParams.videoBitrate != null);
        invariant(sourceCodecParams.videoTimebase != null);
        invariant(filePath != null);
        invariant(outFormat != null);
        await cutEncodeSmartPart({
          cutFrom,
          cutTo,
          outPath,
          outFormat,
          videoCodec,
          // patch: a repair encode is quality-targeted (`-crf`), so the bitrate target is handed over
          // to it; a lossy/smart-cut encode keeps the upstream bitrate. An encoder without the
          // measured `-crf` path keeps the source bitrate instead of ffmpeg's default quality.
          videoBitrate: repairVideoEncode && lossyMode == null
            ? getDamageRepairVideoBitrate({ encoder: repairEncoder, sourceBitrate: sourceCodecParams.videoBitrate })
            : (encCustomBitrate != null ? encCustomBitrate * 1000 : sourceCodecParams.videoBitrate),
          videoStreamIndex: videoStream.index,
          videoTimebase: sourceCodecParams.videoTimebase,
          allFilesMeta,
          copyFileStreams: copyFileStreamsFiltered,
          ffmpegExperimental,
          // patch: the repair passes its own `-bf 0`; the source's B-frame count would override it.
          hasBFrames: repairVideoEncode ? undefined : sourceCodecParams.videoStream.has_b_frames,
          videoEncoderArgs,
          fragmentFrameDuration,
        });
        return true;
      }

      // used when the final output file was produced by encoding or concat, because they don't transfer the timestamps of the segment
      const transferSegmentTimestamps = async (to = cutTo) => transferTimestamps({ inPath: filePath, outPath: finalOutPath, cutFrom: desiredCutFrom, cutTo: to, duration: isDurationValid(fileDuration) ? fileDuration : undefined, treatInputFileModifiedTimeAsStart, treatOutputFileModifiedTimeAsStart });

      // patch: A's guard is part of the repair's cut end (it decides where the tail encode ends).
      const cutEnd = cutTo + (guardSeconds ?? 0);

      const cutEncodeWholePart = async (to = cutTo) => {
        const created = await cutEncodeSmartPartWrapper({ cutFrom: desiredCutFrom, cutTo: to, outPath: finalOutPath });
        if (created) await transferSegmentTimestamps(to);
        return { path: finalOutPath, created };
      };

      if (lossyMode) {
        console.log('Lossy mode: cutting/encoding the whole segment', { desiredCutFrom, cutTo });
        return cutEncodeWholePart();
      }

      // patch: a damaged source must not be copied anywhere (features/damagedSource). Smart cut would
      // encode the joins and copy the middle, which keeps the damage in the middle of every clip -
      // the worst case, because the clip looks correct except in the parts nobody checks.
      if (repairVideoEncode) {
        console.log('Damaged source: encoding the whole segment', { desiredCutFrom, cutTo });
        return cutEncodeWholePart();
      }

      // patch: a segment that starts after the source's last keyframe has no keyframe the copy could
      // start on, and upstream's smart cut throws "Cannot find any keyframe after the desired start cut
      // point": the export then produces nothing at all. That segment lies inside one GOP, so a copy
      // would have to begin before the cut point anyway - it is encoded whole instead. Every patch cut
      // takes this fallback, not only the join repair: a clip whose repair was blocked (another codec,
      // a subtitle track, rotation, an unknown frame rate) is still a clip the user asked for. The
      // condition is re-derived from the source (never from the translated message), and only a failing
      // call pays for the probe.
      let smartCutStart: { losslessCutFrom: number, segmentNeedsSmartCut: boolean };
      try {
        smartCutStart = await needsSmartCut({ path: filePath, desiredCutFrom, videoStream });
      } catch (err) {
        if (!patchMode && !repairJoinsNow) throw err;
        let keyframeTimes: number[] | undefined;
        try {
          keyframeTimes = (await readKeyframesAroundTime({ filePath, streamIndex: videoStream.index, aroundTime: desiredCutFrom, window: 60 })).map((frame) => frame.time);
        } catch {
          // the probe is only there to explain the failure: keep the original error
        }
        if (keyframeTimes == null || hasKeyframeToCopyFrom({ keyframeTimes, cutFrom: desiredCutFrom })) throw err;
        console.log('Smart cut has no keyframe to start on, cutting/encoding the whole segment', { desiredCutFrom, cutTo: cutEnd, patchMode: patchMode === true, repairJoins: repairJoinsNow });
        return cutEncodeWholePart(cutEnd);
      }
      const { losslessCutFrom, segmentNeedsSmartCut } = smartCutStart;

      // patch: a clip that starts exactly on a keyframe is copied upstream, and a copied first GOP
      // starts ~50 ms after its audio (the muxer shifts the negative DTS of the first B frames), so
      // the next join freezes for three frames. The repair encodes that GOP too: every clip's video
      // then starts at 0, like an encoded one.
      let encodeCutStart = segmentNeedsSmartCut;
      let cutFromKeyframe = losslessCutFrom;
      if (repairJoinsNow && !segmentNeedsSmartCut) {
        const readNextKeyframe = async (window: number) => {
          const keyframes = await readKeyframesAroundTime({ filePath, streamIndex: videoStream.index, aroundTime: desiredCutFrom, window });
          return findNextKeyframe(keyframes, desiredCutFrom + 0.000001);
        };
        const nextKeyframe = (await readNextKeyframe(10)) ?? (await readNextKeyframe(60));
        if (nextKeyframe == null) {
          // A single-keyframe video has nothing to encode the head against: keep the upstream copy.
          console.warn('Join repair: no keyframe after the cut start, keeping the lossless start', { desiredCutFrom });
        } else {
          cutFromKeyframe = nextKeyframe.time;
          encodeCutStart = true;
        }
      }

      if (encodeCutStart && !detectedFps) throw new UserFacingError(i18n.t('Smart cut is not possible when FPS is unknown'));
      console.log('Smart cut on video stream', videoStream.index);

      const frameDuration = getFrameDuration(detectedFps);

      // If we are cutting within two keyframes, just encode the whole part and return that
      // See https://github.com/mifi/lossless-cut/pull/1267#issuecomment-1236381740
      if (encodeCutStart && cutFromKeyframe > cutEnd) {
        console.log('Segment is between two keyframes, cutting/encoding the whole segment', { desiredCutFrom, cutFromKeyframe, cutTo: cutEnd });
        return cutEncodeWholePart(repairJoinsNow ? cutEnd : cutTo);
      }

      invariant(outFormat != null);

      const ext = getOutFileExtension({ isCustomFormatSelected: true, outFormat, filePath });

      // patch: the trailing GOP, encoded from its keyframe to the exact cut end. A lossless copy
      // cannot end there: it drops the trailing B frames, which is the freeze at the next join.
      const tailKeyframe = repairJoinsNow && encodeCutStart
        ? await findKeyframeNearTime({ filePath, streamIndex: videoStream.index, time: cutEnd, mode: 'before' })
        : undefined;
      // patch: the plan says where the copy stops, and encodes the whole segment when the cut end is
      // still inside the head GOP: a copy there would end on a packet boundary and keep the very
      // trailing hole the repair removes (see `features/patchExportPolicy/tailRepair.ts`).
      const tailPlan = repairJoinsNow
        ? planJoinRepairTail({ tailKeyframe, headKeyframe: cutFromKeyframe, frameDuration })
        : undefined;
      if (tailPlan?.kind === 'encode-whole') {
        console.log('Join repair: the cut end is inside the head GOP, cutting/encoding the whole segment', { desiredCutFrom, cutFromKeyframe, cutTo: cutEnd });
        return cutEncodeWholePart(cutEnd);
      }
      const copyMiddle = tailPlan?.kind === 'copy-middle' ? tailPlan : undefined;
      const encodeTail = copyMiddle != null;
      const copyTo = copyMiddle != null ? copyMiddle.copyTo : (repairJoinsNow ? cutEnd : cutTo);

      if (encodeCutStart) {
        console.log('Cutting/encoding lossless part', { from: cutFromKeyframe, to: copyTo });
      }

      const losslessPartOutPath = encodeCutStart
        ? getSuffixedOutPath({ customOutDir, filePath, nameSuffix: `smartcut-segment-copy-${i}${ext}` })
        : finalOutPath;

      // for smart cut we need to use keyframe cut here, and no avoid_negative_ts
      await losslessCutSingle({
        cutFrom: cutFromKeyframe,
        cutTo: copyTo,
        chaptersPath,
        outPath: losslessPartOutPath,
        copyFileStreams: copyFileStreamsFiltered,
        keyframeCut: true,
        avoidNegativeTs: undefined,
        fileDuration,
        rotation,
        allFilesMeta,
        outFormat,
        // patch: the repair must not trim the clip to its shortest stream. It gives the merge an
        // explicit duration instead; `-shortest` would drop the video's last frames whenever the
        // audio is the shorter stream.
        shortestFlag: repairJoinsNow ? false : shortestFlag,
        ffmpegExperimental,
        preserveMetadata,
        preserveMovData,
        preserveChapters,
        movFastStart,
        paramsByFile,
        videoTimebase,
        onProgress,
        cutToGuardSeconds: repairJoinsNow ? 0 : guardSeconds,
      });

      // We don't need to concat, just return the single cut file (we may need smart cut in other segments though)
      if (!encodeCutStart) return { path: finalOutPath, created: true };

      // We need to concat

      const smartCutEncodedPartOutPath = getSuffixedOutPath({ customOutDir, filePath, nameSuffix: `smartcut-segment-encode-${i}${ext}` });
      const smartCutTailOutPath = encodeTail
        ? getSuffixedOutPath({ customOutDir, filePath, nameSuffix: `smartcut-segment-tail-encode-${i}${ext}` })
        : undefined;
      const smartCutSegmentsToConcat = [
        smartCutEncodedPartOutPath,
        losslessPartOutPath,
        ...(smartCutTailOutPath != null ? [smartCutTailOutPath] : []),
      ];

      try {
        // Subtract one frame so we don't end up with duplicates when concating, and make sure we don't create a 0 length segment
        const encodeCutToSafe = getSmartCutHeadEnd({ cutFrom: desiredCutFrom, nextKeyframe: cutFromKeyframe, frameDuration });

        console.log('Cutting/encoding smart part', { from: desiredCutFrom, to: encodeCutToSafe });
        // The encoded part is a temporary file that is deleted below: never reuse a leftover one.
        // patch: both encoded parts are concatenated, so their end keeps the frame that starts
        // exactly on the cut (see `getEncodedFragmentDuration`).
        await cutEncodeSmartPartWrapper({ cutFrom: desiredCutFrom, cutTo: encodeCutToSafe, outPath: smartCutEncodedPartOutPath, force: true, fragmentFrameDuration: frameDuration });

        if (smartCutTailOutPath != null && tailKeyframe != null) {
          console.log('Cutting/encoding tail part', { from: tailKeyframe, to: cutEnd });
          await cutEncodeSmartPartWrapper({ cutFrom: tailKeyframe, cutTo: cutEnd, outPath: smartCutTailOutPath, force: true, fragmentFrameDuration: frameDuration });
        }

        // need to re-read streams because indexes may have changed. Using main file as source of streams and metadata
        const { streams: streamsAfterCut } = await readFileFfprobeMeta(losslessPartOutPath);

        // patch: an encoded fragment can come out with no video at all (a head window that ends before
        // the source's first frame encodes 0 frames and still exits 0). As the first part it decides
        // the stream list of the whole concat: with only the data track the muxer writes an edit list
        // far past the media end and no player can read the file; with audio as well ffmpeg aborts with
        // `Could not write header` and leaves a 0 byte file (see
        // `features/patchExportPolicy/concatParts.ts`).
        const probedParts = await pMap(smartCutSegmentsToConcat, async (part) => ({ path: part, streams: (await readFileFfprobeMeta(part)).streams }));
        const concatPlan = planConcatParts({ expected: streamsAfterCut, parts: probedParts, requiredPath: losslessPartOutPath });
        if (concatPlan.dropped.length > 0) {
          console.warn('Join repair: dropping parts without video from the concat', { dropped: concatPlan.dropped.map((part) => part.path) });
        }
        const concatPaths = concatPlan.parts.map((part) => part.path);

        // patch: tell the concat demuxer where each part's video really ends. A part reports either a
        // duration one frame short (encoded) or an audio tail past the video (copied), and either
        // one becomes a hole in the middle of the clip.
        const partDurations = repairJoinsNow
          ? await pMap(concatPaths, async (part) => readVideoConcatDuration(part))
          : undefined;

        const { wrote } = await concatFiles({
          paths: concatPaths,
          outDir: outputDir,
          outPath: finalOutPath,
          metadataFromPath: losslessPartOutPath,
          outFormat,
          includeAllStreams: true,
          streams: streamsAfterCut,
          ffmpegExperimental,
          preserveMovData,
          movFastStart,
          chapters,
          preserveMetadataOnMerge,
          videoTimebase,
          onProgress: onConcatProgress,
          overwrite: overwriteResult,
          ...((partDurations != null) && { durations: partDurations }),
        });
        if (wrote) await transferSegmentTimestamps();
        return { path: finalOutPath, created: wrote };
      } finally {
        await tryDeleteFiles(smartCutSegmentsToConcat);
      }
    };

    try {
      return await pMap(segments, (segment, i) => cutSegment(segment, i, tailTargets?.get(segment.segId)), { concurrency: 1 });
    } finally {
      if (chaptersPath) await tryDeleteFiles([chaptersPath]);
    }
  }, [shouldSkipExistingFile, isEncoding, filePath, lossyMode, repairVideoEncode, losslessCutSingle, cutEncodeSmartPart, encCustomBitrate, concatFiles, remuxSplitParts, treatInputFileModifiedTimeAsStart, treatOutputFileModifiedTimeAsStart]);

  const concatCutSegments = useCallback(async ({ customOutDir, outFormat, segmentPaths, ffmpegExperimental, onProgress, preserveMovData, movFastStart, chapterNames, preserveMetadataOnMerge, mergedOutFilePath, overwrite, repairJoins }: {
    customOutDir: string | undefined,
    outFormat: string | undefined,
    segmentPaths: string[],
    ffmpegExperimental: boolean,
    onProgress: (p: number) => void,
    preserveMovData: boolean,
    movFastStart: boolean,
    chapterNames: (string | undefined)[] | undefined,
    preserveMetadataOnMerge: boolean,
    mergedOutFilePath: string,
    /** patch: the merged file is a result the app owns, so regenerate it even when overwrite is off. */
    overwrite?: boolean | undefined,
    /**
    patch: start every clip where its video really ends instead of at its container duration
    (see `readVideoConcatDuration` in `../ffmpeg`). Harmless for clips cut without the repair.
    */
    repairJoins?: boolean | undefined,
  }) => {
    const outDir = getOutDir(customOutDir, filePath);

    if (!overwrite && await shouldSkipExistingFile(mergedOutFilePath)) return false;

    const chapters = await createChaptersFromSegments({ paths: segmentPaths, defaultChapterNames: chapterNames });

    const metadataFromPath = segmentPaths[0];
    invariant(metadataFromPath != null);
    // need to re-read streams because may have changed
    const { streams } = await readFileFfprobeMeta(metadataFromPath);
    // patch: the concat demuxer offsets the next clip by this value, so a clip whose container
    // duration differs from its last displayed frame puts a hole (or a duplicate frame) at the join.
    const durations = repairJoins
      ? await pMap(segmentPaths, async (segmentPath) => readVideoConcatDuration(segmentPath), { concurrency: 2 })
      : undefined;
    const { wrote } = await concatFiles({ paths: segmentPaths, outDir, outPath: mergedOutFilePath, metadataFromPath, outFormat, includeAllStreams: true, streams, ffmpegExperimental, onProgress, preserveMovData, movFastStart, chapters, preserveMetadataOnMerge, overwrite, ...((durations != null) && { durations }) });
    return wrote;
  }, [concatFiles, filePath, shouldSkipExistingFile]);

  // This is just used to load something into the player with correct duration,
  // so that the user can seek and then we render frames using ffmpeg & MediaSource
  const html5ifyDummy = useCallback(async ({ filePath: filePathArg, outPath, onProgress }: {
    filePath: string,
    outPath: string,
    onProgress: (p: number) => void,
  }) => {
    console.log('Making ffmpeg-assisted dummy file', { filePathArg, outPath });

    const duration = await getDuration(filePathArg);

    const ffmpegArgs = [
      '-hide_banner',

      // This is just a fast way of generating an empty dummy file
      '-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100',
      '-t', String(duration),
      ...flacEncodeArgs,
      '-y', outPath,
    ];

    appendFfmpegCommandLog(ffmpegArgs);
    const result = await runFfmpegWithProgress({ ffmpegArgs, duration, onProgress });
    logStdoutStderr(result);

    await transferTimestamps({ inPath: filePathArg, outPath, duration, treatInputFileModifiedTimeAsStart, treatOutputFileModifiedTimeAsStart });
  }, [appendFfmpegCommandLog, treatInputFileModifiedTimeAsStart, treatOutputFileModifiedTimeAsStart]);

  const html5ify = useCallback(async ({ customOutDir, filePath: filePathArg, speed, hasAudio, hasVideo, onProgress }: {
    customOutDir: string | undefined,
    filePath: string,
    speed: Html5ifyMode,
    hasAudio: boolean,
    hasVideo: boolean,
    onProgress: (p: number) => void,
  }) => {
    console.log('html5ifyAndLoad', { speed, hasVideo, hasAudio });

    if (speed === 'fastest') {
      const path = getSuffixedOutPath({ customOutDir, filePath: filePathArg, nameSuffix: `${html5ifiedPrefix}${html5dummySuffix}.mkv` });
      await html5ifyDummy({ filePath: filePathArg, outPath: path, onProgress });
      return path;
    }

    const outPath = getHtml5ifiedPath(customOutDir, filePathArg, speed);
    invariant(outPath != null);

    let audio: 'hq' | 'lq' | 'copy' | undefined;
    if (hasAudio) {
      if (speed === 'slowest') audio = 'hq';
      else if (['slow-audio', 'fast-audio'].includes(speed)) audio = 'lq';
      else if (['fast-audio-remux'].includes(speed)) audio = 'copy';
    }

    let video: 'hq' | 'lq' | 'copy' | undefined;
    if (hasVideo) {
      if (speed === 'slowest') video = 'hq';
      else if (['slow-audio', 'slow'].includes(speed)) video = 'lq';
      else video = 'copy';
    }

    console.log('Making HTML5 friendly version', { filePathArg, outPath, speed, video, audio });

    let videoArgs: string[];
    let audioArgs: string[];

    // h264/aac_at: No licensing when using HW encoder (Video/Audio Toolbox on Mac)
    // https://github.com/mifi/lossless-cut/issues/372#issuecomment-810766512

    // eslint-disable-next-line @typescript-eslint/switch-exhaustiveness-check -- TODO fix (new rule in @mifi/lint-config)
    switch (video) {
      case 'hq': {
        // eslint-disable-next-line unicorn/prefer-ternary
        if (isMac) {
          videoArgs = ['-vf', 'format=yuv420p', '-allow_sw', '1', '-vcodec', 'h264', '-b:v', '15M'];
        } else {
          // AV1 is very slow
          // videoArgs = ['-vf', 'format=yuv420p', '-sws_flags', 'neighbor', '-vcodec', 'libaom-av1', '-crf', '30', '-cpu-used', '8'];
          // Theora is a bit faster but not that much
          // videoArgs = ['-vf', '-c:v', 'libtheora', '-qscale:v', '1'];
          // videoArgs = ['-vf', 'format=yuv420p', '-c:v', 'libvpx-vp9', '-crf', '30', '-b:v', '0', '-row-mt', '1'];
          // x264 can only be used in GPL projects
          videoArgs = ['-vf', 'format=yuv420p', '-c:v', 'libx264', '-profile:v', 'high', '-preset:v', 'slow', '-crf', '17'];
        }
        break;
      }
      case 'lq': {
        const targetHeight = 400;

        // eslint-disable-next-line unicorn/prefer-ternary
        if (isMac) {
          videoArgs = ['-vf', `scale=-2:${targetHeight},format=yuv420p`, '-allow_sw', '1', '-sws_flags', 'lanczos', '-vcodec', 'h264', '-b:v', '1500k'];
        } else {
          // videoArgs = ['-vf', `scale=-2:${targetHeight},format=yuv420p`, '-sws_flags', 'neighbor', '-c:v', 'libtheora', '-qscale:v', '1'];
          // x264 can only be used in GPL projects
          videoArgs = ['-vf', `scale=-2:${targetHeight},format=yuv420p`, '-sws_flags', 'neighbor', '-c:v', 'libx264', '-profile:v', 'baseline', '-x264opts', 'level=3.0', '-preset:v', 'ultrafast', '-crf', '28'];
        }
        break;
      }
      case 'copy': {
        videoArgs = ['-vcodec', 'copy'];
        break;
      }
      default: {
        videoArgs = ['-vn'];
      }
    }

    // eslint-disable-next-line @typescript-eslint/switch-exhaustiveness-check -- TODO fix (new rule in @mifi/lint-config)
    switch (audio) {
      case 'hq': {
        // eslint-disable-next-line unicorn/prefer-ternary
        if (isMac) {
          audioArgs = ['-acodec', 'aac_at', '-b:a', '192k'];
        } else {
          audioArgs = [...flacEncodeArgs];
        }
        break;
      }
      case 'lq': {
        // eslint-disable-next-line unicorn/prefer-ternary
        if (isMac) {
          audioArgs = ['-acodec', 'aac_at', '-ar', '44100', '-ac', '2', '-b:a', '96k'];
        } else {
          audioArgs = [...flacEncodeArgs, '-ar', '11025', '-ac', '2'];
        }
        break;
      }
      case 'copy': {
        audioArgs = ['-acodec', 'copy'];
        break;
      }
      default: {
        audioArgs = ['-an'];
      }
    }

    // Some files (e.g. DV/DVCPRO .mov) have an audio channel layout that ffmpeg cannot resample or
    // downmix, which makes the encode fail. Relabel the channels first so that it can.
    // We don't pass -map, so ffmpeg picks one audio stream by itself. Therefore only apply the filter
    // when every audio stream has the same channel count, or the filter might not match the picked stream.
    let audioFilterArgs: string[] = [];
    if (audio != null && audio !== 'copy') {
      try {
        const audioStreams = (await readFileFfprobeMeta(filePathArg)).streams.filter((s) => s.codec_type === 'audio');
        const unsupportedStream = audioStreams.find((s) => hasCustomChannelLayout(s.channel_layout));
        const sameChannelCount = new Set(audioStreams.map((s) => s.channels)).size === 1;
        if (unsupportedStream != null && sameChannelCount) {
          const filter = getFixChannelLayoutFilter({ channels: unsupportedStream.channels, channelLayout: unsupportedStream.channel_layout });
          if (filter != null) audioFilterArgs = ['-af', filter];
        }
      } catch (err) {
        // don't fail the conversion just because we couldn't probe it
        console.warn('Failed to probe audio channel layout', err);
      }
    }

    const ffmpegArgs = [
      '-hide_banner',
      ...((video === 'lq' || video === 'hq') ? getHwaccelArgs(ffmpegHwaccel) : []),

      '-i', filePathArg,
      ...videoArgs,
      ...audioArgs,
      ...audioFilterArgs,
      '-sn',
      '-y', outPath,
    ];

    const duration = await getDuration(filePathArg);
    appendFfmpegCommandLog(ffmpegArgs);
    const { stdout } = await runFfmpegWithProgress({ ffmpegArgs, duration, onProgress });

    console.log(decodeText(stdout));

    invariant(outPath != null);
    await transferTimestamps({ inPath: filePathArg, outPath, duration, treatInputFileModifiedTimeAsStart, treatOutputFileModifiedTimeAsStart });
    return outPath;
  }, [appendFfmpegCommandLog, ffmpegHwaccel, html5ifyDummy, treatInputFileModifiedTimeAsStart, treatOutputFileModifiedTimeAsStart]);

  // https://stackoverflow.com/questions/34118013/how-to-determine-webm-duration-using-ffprobe
  const fixInvalidDuration = useCallback(async ({ filePath: filePathArg, outPath, onProgress }: {
    filePath: string,
    outPath: string,
    onProgress: (a: number) => void,
  }) => {
    // patch: patch mode writes this temporary file into `clips/repairing_tmp/`, which ffmpeg does not
    // create itself (base mode's output folder already exists).
    await mkdir(dirname(outPath), { recursive: true });

    const ffmpegArgs = [
      '-hide_banner',

      '-i', filePathArg,

      // https://github.com/mifi/lossless-cut/issues/1415
      '-map_metadata', '0',
      '-map', '0',
      '-ignore_unknown',

      '-c', 'copy',
      '-y', outPath,
    ];

    appendFfmpegCommandLog(ffmpegArgs);
    const result = await runFfmpegWithProgress({ ffmpegArgs, onProgress });
    logStdoutStderr(result);

    return outPath;
  }, [appendFfmpegCommandLog]);

  // https://github.com/mifi/lossless-cut/issues/2111
  const decimate = useCallback(async ({ filePath: filePathArg, outPath, n, fps }: {
    n: number,
    fps: number,
    filePath: string,
    outPath: string,
  }) => {
    // patch: patch mode writes this temporary file into `clips/repairing_tmp/` (see fixInvalidDuration).
    await mkdir(dirname(outPath), { recursive: true });

    const ffmpegArgs = [
      '-hide_banner',

      // https://stackoverflow.com/questions/73710657/remove-all-non-keyframes-from-h-264-avc-video-without-re-encoding
      // https://stackoverflow.com/questions/67088473/remove-all-non-key-frames-from-video-without-re-encoding
      // '-discard', 'nokey', // doesn't seem to work with hevc, so use noise=drop=not(key) instead
      // https://chatgpt.com/share/6a1c3be1-1064-83ec-b5c1-fa91ddf3cde8
      '-i', filePathArg,
      '-map', 'v:0',
      '-c', 'copy',
      '-bsf:v', `noise=drop=not(key),noise=drop='mod(n\\,${formatFfmpegNumber(n)})',setts=ts='N/${formatFfmpegNumber(fps)}/TB_OUT'`,
      '-an',
      '-ignore_unknown',
      '-y', outPath,
    ];

    appendFfmpegCommandLog(ffmpegArgs);
    const result = await runFfmpeg(ffmpegArgs);
    logStdoutStderr(result);

    return outPath;
  }, [appendFfmpegCommandLog]);

  function getPreferredCodecFormat(stream: LiteFFprobeStream) {
    const map = {
      mp3: { format: 'mp3', ext: 'mp3' },
      opus: { format: 'opus', ext: 'opus' },
      vorbis: { format: 'ogg', ext: 'ogg' },
      h264: { format: 'mp4', ext: 'mp4' },
      hevc: { format: 'mp4', ext: 'mp4' },
      eac3: { format: 'eac3', ext: 'eac3' },

      subrip: { format: 'srt', ext: 'srt' },
      mov_text: { format: 'mp4', ext: 'mp4' },

      m4a: { format: 'ipod', ext: 'm4a' },
      aac: { format: 'adts', ext: 'aac' },
      jpeg: { format: 'image2', ext: 'jpeg' },
      png: { format: 'image2', ext: 'png' },

      // TODO add more
      // TODO allow user to change?
    } as const;

    const match = map[stream.codec_name as keyof typeof map];
    if (match) return match;

    // default fallbacks:
    if (stream.codec_type === 'video') return { ext: 'mkv', format: 'matroska' } as const;
    if (stream.codec_type === 'audio') return { ext: 'mka', format: 'matroska' } as const;
    if (stream.codec_type === 'subtitle') return { ext: 'mks', format: 'matroska' } as const;
    if (stream.codec_type === 'data') return { ext: 'bin', format: 'data' } as const; // https://superuser.com/questions/1243257/save-data-stream

    return undefined;
  }

  const extractNonAttachmentStreams = useCallback(async ({ customOutDir, streams }: {
    customOutDir?: string | undefined, streams: FFprobeStream[],
  }) => {
    invariant(filePath != null);
    if (streams.length === 0) return [];

    const outStreams = streams.flatMap((s) => {
      const format = getPreferredCodecFormat(s);
      const { index } = s;

      if (format == null || index == null) return [];

      return [{
        index,
        codec: s.codec_name || s.codec_tag_string || s.codec_type,
        type: s.codec_type,
        format,
      }];
    });

    // console.log(outStreams);


    let streamArgs: string[] = [];
    const outPaths = await pMap(outStreams, async ({ index, codec, type, format: { format, ext } }) => {
      const outPath = getSuffixedOutPath({ customOutDir, filePath, nameSuffix: `stream-${index}-${type}-${codec}.${ext}` });
      if (!enableOverwriteOutput && await mainApi.pathExists(outPath)) throw new RefuseOverwriteError();

      streamArgs = [
        ...streamArgs,
        '-map', `0:${index}`, '-c', 'copy', '-f', format, '-y', outPath,
      ];
      return outPath;
    }, { concurrency: 1 });

    const ffmpegArgs = [
      '-hide_banner',

      '-i', filePath,
      ...streamArgs,
    ];

    appendFfmpegCommandLog(ffmpegArgs);
    const { stdout } = await runFfmpeg(ffmpegArgs);
    console.log(decodeText(stdout));

    return outPaths;
  }, [appendFfmpegCommandLog, enableOverwriteOutput, filePath]);

  const extractAttachmentStreams = useCallback(async ({ customOutDir, streams }: {
    customOutDir?: string | undefined, streams: FFprobeStream[],
  }) => {
    invariant(filePath != null);
    if (streams.length === 0) return [];

    console.log('Extracting', streams.length, 'attachment streams');

    let streamArgs: string[] = [];
    const outPaths = await pMap(streams, async ({ index, codec_name: codec, codec_type: type, tags }) => {
      // Attachments like XML files have no codec_name, so take the extension from the attachment's file name
      // (it comes from the file, so only accept a plain extension, e.g. not `tt:f` on Windows)
      const nameExt = extname(tags?.['filename'] ?? '').slice(1).toLowerCase();
      const ext = codec || (/^[\da-z]{1,10}$/.test(nameExt) ? nameExt : 'bin');
      const outPath = getSuffixedOutPath({ customOutDir, filePath, nameSuffix: `stream-${index}-${type}${codec ? `-${codec}` : ''}.${ext}` });
      invariant(outPath != null);
      if (!enableOverwriteOutput && await mainApi.pathExists(outPath)) throw new RefuseOverwriteError();

      streamArgs = [
        ...streamArgs,
        `-dump_attachment:${index}`, outPath,
      ];
      return outPath;
    }, { concurrency: 1 });

    const ffmpegArgs = [
      '-y',
      '-hide_banner',
      '-loglevel', 'error',
      ...streamArgs,
      '-i', filePath,
    ];

    try {
      appendFfmpegCommandLog(ffmpegArgs);
      const { stdout } = await runFfmpeg(ffmpegArgs);
      console.log(decodeText(stdout));
    } catch (err) {
      // Unfortunately ffmpeg will exit with code 1 even though it's a success
      // Note: This is kind of hacky:
      if (isExecaError(err) && err.exitCode === 1 && getStdioString(err.stderr)?.includes('At least one output file must be specified')) return outPaths;
      throw err;
    }
    return outPaths;
  }, [appendFfmpegCommandLog, enableOverwriteOutput, filePath]);

  // https://stackoverflow.com/questions/32922226/extract-every-audio-and-subtitles-from-a-video-with-ffmpeg
  const extractStreams = useCallback(async ({ customOutDir, streams }: {
    customOutDir: string | undefined, streams: FFprobeStream[],
  }) => {
    invariant(filePath != null);
    await assertFileExists(filePath);

    const attachmentStreams = streams.filter((s) => s.codec_type === 'attachment');
    const nonAttachmentStreams = streams.filter((s) => s.codec_type !== 'attachment');

    // TODO progress

    // Attachment streams are handled differently from normal streams
    return [
      ...(await extractNonAttachmentStreams({ customOutDir, streams: nonAttachmentStreams })),
      ...(await extractAttachmentStreams({ customOutDir, streams: attachmentStreams })),
    ];
  }, [extractAttachmentStreams, extractNonAttachmentStreams, filePath]);

  return {
    cutMultiple, concatFiles, html5ify, html5ifyDummy, fixInvalidDuration, decimate, concatCutSegments, extractStreams, tryDeleteFiles,
  };
}

export default useFfmpegOperations;

export type FfmpegOperations = ReturnType<typeof useFfmpegOperations>;
