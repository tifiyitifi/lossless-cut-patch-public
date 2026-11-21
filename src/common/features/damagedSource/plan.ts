/* eslint-disable import/prefer-default-export */
import { getSourceRepair } from './registry.js';
import type { DamageRepairPlan, SourceDamageKind } from './types.js';

/**
How to repair one kind of damage.

The plan is declared by the repair itself (`registry.ts`), so every kind answers the same four
questions and the wiring in the app never has to know which defect it is looking at.
*/
export function getDamageRepairPlan(kind: SourceDamageKind): DamageRepairPlan {
  return getSourceRepair(kind).plan;
}
