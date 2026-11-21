import JSON5 from 'json5';
import i18n from 'i18next';
import invariant from 'tiny-invariant';

import { parseSrtToSegments, formatSrt, parseCuesheet, parseXmeml, parseFcpXml, parseCsv, parseCutlist, parsePbf, parseEdl, formatCsvHuman, formatTsvHuman, formatCsvFrames, formatCsvSeconds, parseCsvTime, getFrameValParser, parseDvAnalyzerSummaryTxt, parseOtio } from './edlFormats';
import { askForYouTubeInput, showOpenDialog } from './dialogs';
import { getOutPath } from './util';
import type { EdlExportType, EdlFileType, EdlImportType, GetFrameCount, LlcProjectFile, SegmentBase, StateSegment } from './types';
import { llcProjectV1Schema, llcProjectV2Schema, llcProjectV3Schema } from './types';
import { mapSaveableSegments } from './segments';
import isDev from './isDev';
import { formatLlcTime, getLlcProjectVersion, normalizeLlcTimeValue } from '../../common/features/patchData/llcTime';
import type { LlcTimeFormat } from '../../common/features/patchData/llcTime';
// patch: the project file text with its human-readable comments (see llcProjectText).
import { renderLlcProjectText } from '../../common/features/patchData/llcProjectText';
// patch: keep the top-level fields this build does not know (see projectExtras).
import { buildProjectData, readProjectExtras } from '../../common/features/patchData/projectExtras';
import { basename } from './util/path';

const { readFile, writeFile } = window.require('node:fs/promises');
const cueParser = window.require('cue-parser');

const { dialog } = window.require('@electron/remote');


// When readFile is used with 'utf8', ef bb bf is its UTF-8 representation of BOM. As BOM is considered white-space, it can be stripped by .trim(). Node.js does not strip BOM, it is a userland task.
// https://github.com/nodejs/node/issues/20649#issuecomment-388016410
const trimBom = (text: string) => text.trim();

async function loadCsv(path: string, parseTimeFn: (a: string) => number | undefined) {
  return parseCsv(trimBom(await readFile(path, 'utf8')), parseTimeFn);
}

async function loadCutlistSeconds(path: string) {
  return parseCutlist(trimBom(await readFile(path, 'utf8')));
}

async function loadXmeml(path: string) {
  return parseXmeml(await readFile(path, 'utf8'));
}

async function loadFcpXml(path: string) {
  return parseFcpXml(await readFile(path, 'utf8'));
}

async function loadDvAnalyzerSummaryTxt(path: string) {
  return parseDvAnalyzerSummaryTxt(trimBom(await readFile(path, 'utf8')));
}

async function loadPbf(path: string) {
  return parsePbf(await readFile(path));
}

async function loadEdl(path: string, fps: number) {
  return parseEdl(trimBom(await readFile(path, 'utf8')), fps);
}

async function loadCue(path: string) {
  return parseCuesheet(cueParser.parse(path));
}

async function loadSrt(path: string) {
  return parseSrtToSegments(await readFile(path, 'utf8'));
}

export async function saveCsv(path: string, cutSegments: SegmentBase[]) {
  await writeFile(path, formatCsvSeconds(cutSegments));
}

export async function saveCsvHuman(path: string, cutSegments: SegmentBase[]) {
  await writeFile(path, formatCsvHuman(cutSegments));
}

export async function saveCsvFrames({ path, cutSegments, getFrameCount }: {
  path: string,
  cutSegments: SegmentBase[],
  getFrameCount: GetFrameCount,
}) {
  await writeFile(path, formatCsvFrames({ cutSegments, getFrameCount }));
}

export async function saveTsv(path: string, cutSegments: SegmentBase[]) {
  await writeFile(path, formatTsvHuman(cutSegments));
}

export async function saveSrt(path: string, cutSegments: SegmentBase[]) {
  await writeFile(path, formatSrt(cutSegments));
}

/** The carried fields of the project file that is about to be replaced (none when there is none). */
async function readExistingProjectExtras(savePath: string) {
  try {
    return readProjectExtras(await readFile(savePath, 'utf8'));
  } catch {
    // A new export path, a file the user deleted, a permission problem: nothing to carry.
    return {};
  }
}

export async function saveLlcProject({ savePath, mediaFilePath, cutSegments, timeFormat }: {
  savePath: string,
  mediaFilePath: string,
  cutSegments: StateSegment[],
  // patch: decides both the representation and the file version (see getLlcProjectVersion).
  timeFormat: LlcTimeFormat,
}) {
  const saveableSegments = mapSaveableSegments(cutSegments);
  // patch: the readable format writes v3 timecodes; the numeric format stays v2 so that upstream
  // (and older builds) can still open the file.
  const version = getLlcProjectVersion(timeFormat);
  const cutSegmentsToSave = timeFormat === 'timecode'
    ? saveableSegments.map(({ start, end, ...restSeg }) => ({
      start: formatLlcTime(start),
      ...((end != null) && { end: formatLlcTime(end) }),
      ...restSeg,
    }))
    : saveableSegments;

  // patch: keep the fields this build does not know (the finish flow writes `patchExport` there).
  // The autosave writes once right after a load, so rebuilding the file from the segments alone
  // would erase them by merely opening the project.
  const projectData = buildProjectData({
    version,
    mediaFileName: basename(mediaFilePath),
    cutSegments: cutSegmentsToSave,
    extras: await readExistingProjectExtras(savePath),
  });
  // patch: the file carries comments (segment numbers, a blank line every five segments), so a
  // human can read it; JSON5 ignores them when parsing, upstream included.
  await writeFile(savePath, renderLlcProjectText(projectData, { t: (key, options) => (options == null ? i18n.t(key) : i18n.t(key, options)) }));
}

/** Normalize a parsed project file of any known version to numeric segment times. */
function normalizeLlcProject(json: unknown): LlcProjectFile {
  const version = typeof json === 'object' && json != null ? (json as { version?: unknown }).version : undefined;

  if (version === 3) {
    const project = llcProjectV3Schema.parse(json);
    return {
      version: project.version,
      ...((project.mediaFileName != null) && { mediaFileName: project.mediaFileName }),
      cutSegments: project.cutSegments.map((seg, index) => {
        const { start: startRaw, end: endRaw, ...restSeg } = seg;
        const start = normalizeLlcTimeValue(startRaw);
        if (start == null) throw new Error(i18n.t('Invalid start time in LLC segment {{index}}', { index }));
        if (endRaw == null) return { ...restSeg, start };
        const end = normalizeLlcTimeValue(endRaw);
        if (end == null) throw new Error(i18n.t('Invalid end time in LLC segment {{index}}', { index }));
        return { ...restSeg, start, end };
      }),
    };
  }

  if (version === 2) {
    return llcProjectV2Schema.parse(json);
  }

  if (version === 1) {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { cutSegments, version: _ignored, ...restProject } = llcProjectV1Schema.parse(json);
    console.log('Converting v1 project to v2');
    return {
      ...restProject,
      version: 2,
      cutSegments: cutSegments.map(({ start, ...restSeg }) => ({
        ...restSeg,
        start: start ?? 0, // v1 allowed undefined for "start", which we no longer allow as of v2
      })),
    };
  }

  throw new Error(i18n.t('Unsupported LLC project version: {{version}}', { version: String(version) }));
}

export async function loadLlcProject(path: string) {
  const json = JSON5.parse(await readFile(path, 'utf8'));

  const project = normalizeLlcProject(json);
  console.log(`Loaded LLC project v${project.version}, mediaFileName: ${project.mediaFileName}, ${project.cutSegments.length} segments`);
  if (isDev) console.log(project);
  return project;
}

export async function loadOtio(path: string) {
  return parseOtio(JSON.parse(await readFile(path, 'utf8')));
}

export async function readEdlFile({ type, path, fps }: {
  type: EdlFileType,
  path: string,
  fps: number | undefined,
}) {
  if (type === 'csv') return loadCsv(path, parseCsvTime);
  if (type === 'csv-frames' || type === 'edl') {
    invariant(fps != null, 'The loaded media has an unknown framerate');
    if (type === 'csv-frames') return loadCsv(path, getFrameValParser(fps));
    if (type === 'edl') return loadEdl(path, fps);
  }
  // eslint-disable-next-line unicorn-js/prefer-else-if -- TODO fix (new rule in @mifi/lint-config)
  if (type === 'cutlist') return loadCutlistSeconds(path);
  if (type === 'xmeml') return loadXmeml(path);
  if (type === 'fcpxml') return loadFcpXml(path);
  if (type === 'dv-analyzer-summary-txt') return loadDvAnalyzerSummaryTxt(path);
  if (type === 'cue') return loadCue(path);
  if (type === 'pbf') return loadPbf(path);
  if (type === 'srt') return loadSrt(path);
  if (type === 'otio') return loadOtio(path);
  if (type === 'llc') {
    const project = await loadLlcProject(path);
    return project.cutSegments;
  }
  throw new Error('Invalid EDL type');
}

export async function askForEdlImport({ type, fps, fileDuration, defaultPath }: { type: EdlImportType, fps?: number | undefined, fileDuration?: number | undefined, defaultPath?: string | undefined }) {
  if (type === 'youtube') return askForYouTubeInput({ fileDuration });

  let filters;
  // eslint-disable-next-line unicorn-js/prefer-switch
  if (type === 'csv' || type === 'csv-frames') filters = [{ name: i18n.t('CSV files'), extensions: ['csv'] }];
  else if (type === 'xmeml') filters = [{ name: i18n.t('XML files'), extensions: ['xml'] }];
  else if (type === 'fcpxml') filters = [{ name: i18n.t('FCPXML files'), extensions: ['fcpxml'] }];
  else if (type === 'cue') filters = [{ name: i18n.t('CUE files'), extensions: ['cue'] }];
  else if (type === 'pbf') filters = [{ name: i18n.t('PBF files'), extensions: ['pbf'] }];
  else if (type === 'edl') filters = [{ name: i18n.t('EDL'), extensions: ['*'] }];
  else if (type === 'dv-analyzer-summary-txt') filters = [{ name: i18n.t('DV Analyzer Summary.txt'), extensions: ['txt'] }];
  else if (type === 'srt') filters = [{ name: i18n.t('Subtitles (SRT)'), extensions: ['srt'] }];
  else if (type === 'llc') filters = [{ name: i18n.t('LosslessCut project'), extensions: ['llc'] }];

  const { canceled, filePaths } = await showOpenDialog({
    properties: ['openFile'],
    title: i18n.t('Import project'),
    ...(filters && { filters }),
    ...(defaultPath != null && { defaultPath }),
  });
  const [firstFilePath] = filePaths;
  if (canceled || firstFilePath == null) return [];
  return readEdlFile({ type, path: firstFilePath, fps });
}

export async function exportEdlFile({ type, cutSegments, customOutDir, filePath, getFrameCount, llcTimeFormat }: {
  type: EdlExportType,
  cutSegments: StateSegment[],
  customOutDir?: string | undefined,
  filePath?: string | undefined,
  getFrameCount: GetFrameCount,
  llcTimeFormat: LlcTimeFormat,
}) {
  invariant(filePath != null);

  let filters: { name: string, extensions: string[] }[] | undefined;
  let ext: string | undefined;
  switch (type) {
    case 'csv':
    case 'csv-human':
    case 'csv-frames': {
      ext = 'csv';
      filters = [{ name: i18n.t('CSV files'), extensions: [ext, 'txt'] }];
      break;
    }
    case 'tsv-human': {
      ext = 'tsv';
      filters = [{ name: i18n.t('TXT files'), extensions: [ext, 'txt'] }];
      break;
    }
    case 'srt': {
      ext = 'srt';
      filters = [{ name: i18n.t('Subtitles (SRT)'), extensions: [ext, 'txt'] }];
      break;
    }
    case 'llc': {
      ext = 'llc';
      filters = [{ name: i18n.t('LosslessCut project'), extensions: [ext, 'llc'] }];
      break;
    }
  }

  const defaultPath = getOutPath({ filePath, customOutDir, fileName: `${basename(filePath)}.${ext}` });

  const { canceled, filePath: savePath } = await dialog.showSaveDialog({ defaultPath, title: i18n.t('Export project'), ...(filters != null && { filters }) });
  if (canceled || !savePath) return;
  console.log('Saving', type, savePath);
  // eslint-disable-next-line unicorn-js/prefer-switch
  if (type === 'csv') await saveCsv(savePath, cutSegments);
  else if (type === 'tsv-human') await saveTsv(savePath, cutSegments);
  else if (type === 'csv-human') await saveCsvHuman(savePath, cutSegments);
  else if (type === 'csv-frames') await saveCsvFrames({ path: savePath, cutSegments, getFrameCount });
  else if (type === 'llc') await saveLlcProject({ savePath, mediaFilePath: filePath, cutSegments, timeFormat: llcTimeFormat });
  else if (type === 'srt') await saveSrt(savePath, cutSegments);
}
