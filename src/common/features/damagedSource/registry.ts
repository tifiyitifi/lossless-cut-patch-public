import type { DamageRepairPlan, SourceDamageKind, SourceProbeFacts } from './types.js';
import { sourceDamageMissingCompositionOffsets } from './types.js';

/**
The repairs this app knows how to do, as data (fork-owned).

Every defect is one entry: how to recognise it and what repairing it costs in each direction
(preview and export). The dialog, the repair menu and the export wiring only read this list, so a
new defect is one entry plus one filter, not another branch in every call site.

The words live next to the call sites (`copy.ts`): translation keys are literal English sentences
that the extractor has to see inside `t()`, so they cannot be data in this module.
*/
export interface SourceRepair {
  kind: SourceDamageKind;
  /** Does this file have this defect? Receives the probe facts of one file. */
  detect: (facts: SourceProbeFacts) => boolean;
  /** What repairing it costs in the preview and in an export. */
  plan: DamageRepairPlan;
}

/**
The frame order is not stored, so a player that trusts the container shows the frames in decode
order. The rule is deliberately narrow: "no composition offsets" is only a defect when the video
needs reordering at all - a Baseline file stores its frames in display order, so `pts === dts` is
correct there. A `ctts` box that exists but holds only zeroes is the same defect as a missing
box. When the box scan could not read the movie header, the first GOP's packets decide instead;
as a primary rule they would also fire on a correct file whose first GOP has no B frames.
*/
const missingCompositionOffsets: SourceRepair = {
  kind: sourceDamageMissingCompositionOffsets,
  detect(facts) {
    if (!facts.hasVideo || !facts.hasBFrames) return false;

    const { hasCtts, cttsAllZero, firstGopPtsEqualsDts } = facts;
    return hasCtts === false
      || cttsAllZero === true
      || (hasCtts === undefined && firstGopPtsEqualsDts === true);
  },
  plan: {
    // A lossless copy reproduces the broken order in both directions, and encoding only the joins
    // would leave the copied middle broken. The export is the real result, so it keeps its size.
    playbackNeedsTranscode: true,
    exportNeedsVideoEncode: true,
    exportKeepResolution: true,
    forbidsPartialEncode: true,
  },
};

/** In the order the menu lists them. */
export const sourceRepairs: readonly SourceRepair[] = [missingCompositionOffsets];

/** The descriptor of one kind. Throws for an id no repair declares (a programming error). */
export function getSourceRepair(kind: SourceDamageKind): SourceRepair {
  const repair = sourceRepairs.find((candidate) => candidate.kind === kind);
  if (repair == null) throw new Error(`No repair is declared for source damage kind ${kind}`);
  return repair;
}
