/**
Upstream file operations patch exposes in its console / command palette.

Like the segment operations, these already exist in `useFfmpegOperations`; patch only adds a
keyboard-driven entry point (and writes next to the work directory like the rest of patch).
*/

import type { Html5ifyMode } from '../../types.js';
import type { PatchExportFormat } from './exportFormats.js';
import type { PatchImportFormat } from './importFormats.js';

export type PatchFileOperation = | 'fix-invalid-duration'
  | 'extract-all-streams'
  | 'html5ify'
  | 'decimate'
  | 'concat-batch'
  | 'convert-batch'
  | 'export-cut-list'
  | 'import-cut-list';

export const patchFileOperations: readonly PatchFileOperation[] = [
  'fix-invalid-duration',
  'extract-all-streams',
  'html5ify',
  'decimate',
  'concat-batch',
  'convert-batch',
  'export-cut-list',
  'import-cut-list',
];

/** Operations that need user parameters before they can run. */
export const patchParameterisedFileOperations: readonly PatchFileOperation[] = [
  'html5ify',
  'decimate',
  'convert-batch',
  'export-cut-list',
  'import-cut-list',
];

export interface PatchFileOperationParams {
  /** `html5ify` encode speed. */
  speed?: Html5ifyMode | undefined;
  /** `decimate`: keep every n-th keyframe. */
  n?: number | undefined;
  /** `decimate`: output frame rate. */
  fps?: number | undefined;
  /** `export-cut-list` format. */
  format?: PatchExportFormat | undefined;
  /** `import-cut-list` format. */
  importFormat?: PatchImportFormat | undefined;
}

export function isPatchFileOperation(value: string): value is PatchFileOperation {
  return (patchFileOperations as readonly string[]).includes(value);
}

export function needsPatchFileOperationParams(value: PatchFileOperation): boolean {
  return patchParameterisedFileOperations.includes(value);
}
