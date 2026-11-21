import { normalizeAlias, resolveBaseCommandName } from './parser.js';
import type { PatchUserAlias } from './builtinCommands.js';
import type { PatchIntent } from './commands.js';

/** Why a candidate alias cannot be saved. */
export type AliasValidationError = 'empty' | 'tooLong' | 'invalidCharacters' | 'reserved' | 'duplicate';

export const aliasMaxLength = 24;

/** Short names are matched lower-case and kept to a conservative character set. */
export const aliasPattern = /^[a-z0-9_-]+$/;

/**
Validate one candidate user alias.

Built-in names, legacy codes and every other name the console already understands are reserved
(the user may not shadow them), and an alias may not be used twice, so the console always
resolves unambiguously. `extraReserved` carries names the common layer cannot know statically
(the upstream action names, which the renderer enumerates at runtime).
*/
export function validateAlias(alias: string, existing: readonly PatchUserAlias[], extraReserved: readonly string[] = []): AliasValidationError | undefined {
  const normalized = normalizeAlias(alias);
  if (normalized === '') return 'empty';
  if (normalized.length > aliasMaxLength) return 'tooLong';
  if (!aliasPattern.test(normalized)) return 'invalidCharacters';
  if ((resolveBaseCommandName(normalized) != null) || extraReserved.some((name) => name.toLowerCase() === normalized)) return 'reserved';
  if (existing.some((entry) => normalizeAlias(entry.alias) === normalized)) return 'duplicate';
  return undefined;
}

/** Add an alias if valid; returns the new list, or a copy of the old list when it was rejected. */
export function addUserAlias(existing: readonly PatchUserAlias[], alias: string, intent: PatchIntent, extraReserved?: readonly string[]): PatchUserAlias[] {
  if (validateAlias(alias, existing, extraReserved) != null) return [...existing];
  return [...existing, { alias: normalizeAlias(alias), intent }];
}

export function removeUserAlias(existing: readonly PatchUserAlias[], alias: string): PatchUserAlias[] {
  const normalized = normalizeAlias(alias);
  return existing.filter((entry) => normalizeAlias(entry.alias) !== normalized);
}
