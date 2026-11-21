/**
Cut-list / project formats patch can import.

Mirrors upstream's `EdlImportType` (renderer types) but lives in `common` so the console intents
and the parameter dialog can share it. The values must stay identical to upstream's.
*/
export type PatchImportFormat = | 'csv'
  | 'csv-frames'
  | 'edl'
  | 'cutlist'
  | 'xmeml'
  | 'fcpxml'
  | 'cue'
  | 'pbf'
  | 'srt'
  | 'dv-analyzer-summary-txt'
  | 'otio'
  | 'llc'
  | 'youtube';

export const patchImportFormats: readonly PatchImportFormat[] = [
  'csv',
  'csv-frames',
  'edl',
  'cutlist',
  'xmeml',
  'fcpxml',
  'cue',
  'pbf',
  'srt',
  'dv-analyzer-summary-txt',
  'otio',
  'llc',
  'youtube',
];

export function isPatchImportFormat(value: string): value is PatchImportFormat {
  return (patchImportFormats as readonly string[]).includes(value);
}
