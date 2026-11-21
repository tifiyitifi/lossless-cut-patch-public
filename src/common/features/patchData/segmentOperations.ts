/**
Upstream segment operations patch exposes in its console / command palette.

These already exist in `useSegments`; patch only adds a keyboard-driven entry point for them, so no
upstream logic is duplicated.
*/
export type PatchSegmentOperation = | 'detect-black-scenes'
  | 'detect-silent-scenes'
  | 'detect-scene-changes'
  | 'segments-from-keyframes'
  | 'invert-segments'
  | 'fill-segment-gaps'
  | 'combine-overlapping-segments'
  | 'reorder-segments';

export const patchSegmentOperations: readonly PatchSegmentOperation[] = [
  'detect-black-scenes',
  'detect-silent-scenes',
  'detect-scene-changes',
  'segments-from-keyframes',
  'invert-segments',
  'fill-segment-gaps',
  'combine-overlapping-segments',
  'reorder-segments',
];

export function isPatchSegmentOperation(value: string): value is PatchSegmentOperation {
  return (patchSegmentOperations as readonly string[]).includes(value);
}
