/**
Cut-list / project export formats patch can write.

Mirrors upstream's `EdlExportType` (renderer types) but lives in `common` so the console intents
and the parameter dialog can share it. The values must stay identical to upstream's.
*/
export type PatchExportFormat = 'csv' | 'csv-human' | 'csv-frames' | 'tsv-human' | 'srt' | 'llc';

export const patchExportFormats: readonly PatchExportFormat[] = ['csv', 'csv-human', 'csv-frames', 'tsv-human', 'srt', 'llc'];

export function isPatchExportFormat(value: string): value is PatchExportFormat {
  return (patchExportFormats as readonly string[]).includes(value);
}
