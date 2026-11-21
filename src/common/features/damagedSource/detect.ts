/* eslint-disable import/prefer-default-export */
import { sourceRepairs } from './registry.js';
import type { SourceDamage, SourceProbeFacts } from './types.js';

/**
Classify a probed file.

The rules live with the repairs themselves (`registry.ts`): this only asks every known repair
whether it applies, so adding a defect does not touch this file.
*/
export function detectSourceDamage(facts: SourceProbeFacts): SourceDamage[] {
  return sourceRepairs
    .filter((repair) => repair.detect(facts))
    .map((repair) => ({ kind: repair.kind, evidence: facts }));
}
