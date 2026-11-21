import { legacyPatchCommands, upstreamActionAliases } from '../../../../common/features/patchCommand';
import type { PatchIntent } from '../../../../common/features/patchCommand';

export interface BaseCommandEntry {
  /** The name you type, e.g. `xc` or `addSegment`. */
  name: string;
  /** Where the name comes from (the legacy PowerShell workflow, or an upstream action name). */
  group: 'legacy' | 'upstream';
  intent: PatchIntent;
}

/**
The base commands the console already understands (help popup only).

These resolve to a patch intent but are not wired to an action yet - the console reports
"not available yet" for them until the matching patch steps land.
*/
export function getBaseCommandEntries(): BaseCommandEntry[] {
  const legacy: BaseCommandEntry[] = legacyPatchCommands.map((command) => ({ name: command.code, group: 'legacy', intent: command.intent }));
  const upstream: BaseCommandEntry[] = Object.entries(upstreamActionAliases).map(([name, intent]) => ({ name, group: 'upstream', intent }));
  return [...legacy, ...upstream];
}
