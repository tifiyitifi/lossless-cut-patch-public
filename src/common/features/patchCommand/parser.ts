import { allPatchActions } from '../patchData/keymap.js';
import type { PatchAction } from '../patchData/keymap.js';
import { findBuiltinCommandByName, findBuiltinPhrasePrefix } from './builtinCommands.js';
import type { PatchUserAlias } from './builtinCommands.js';
import { legacyPatchCommands, upstreamActionAliases, isPatchFlowIntent } from './commands.js';
import type { PatchIntent } from './commands.js';
import type { KeyboardAction } from '../../types.js';

/** How a command name was resolved. */
export type PatchCommandSource = 'builtin' | 'legacy' | 'action' | 'base-action' | 'user-alias';

export interface PatchCommand {
  /** Normalized (lower-cased) command name as typed. */
  name: string;
  intent: PatchIntent;
  /** Whitespace-separated arguments after the command name. */
  args: string[];
  source: PatchCommandSource;
}

export type PatchParseError = 'empty' | 'unknown';

export type PatchParseResult = | { ok: true, command: PatchCommand }
  | { ok: false, error: PatchParseError, name: string };

const patchActionIds: ReadonlySet<string> = new Set<string>(allPatchActions);

/** Console names are matched lower-case and trimmed. */
export function normalizeAlias(alias: string) {
  return alias.trim().toLowerCase();
}

/**
Resolve a name against the built-in vocabulary only (no user aliases): built-in commands, legacy
codes, patch action ids, upstream aliases, flow intents and `help` / `clear`.

Used by the parser and by alias validation, so a user alias can never shadow a built-in name.
*/
export function resolveBaseCommandName(input: string): PatchIntent | undefined {
  const name = input.toLowerCase();

  const builtin = findBuiltinCommandByName(name);
  if (builtin != null) return builtin.intent;

  const legacy = legacyPatchCommands.find((command) => command.code === name);
  if (legacy != null) return legacy.intent;

  if (patchActionIds.has(name)) return name as PatchAction;

  const alias = upstreamActionAliases[name];
  if (alias != null) return alias;

  if (isPatchFlowIntent(name)) return name;

  if (name === 'help' || name === '?') return 'help';
  if (name === 'clear') return 'clear';

  return undefined;
}

/**
Parse one console line.

Resolution order: built-in command → legacy code → patch action id → upstream alias → flow
intent → base action name → `help` / `clear` → user alias. Whitespace is collapsed; the first
token is the command name, the rest are arguments.

`baseActionNames` maps lower-cased upstream action names to their canonical spelling; the
renderer passes the actions the app can actually run (see `mainActions`).
*/
export function parsePatchCommand(input: string, userAliases?: readonly PatchUserAlias[], baseActionNames?: ReadonlyMap<string, KeyboardAction>): PatchParseResult {
  const tokens = input.trim().split(/\s+/).filter((token) => token.length > 0);
  const [first, ...args] = tokens;
  if (first == null) return { ok: false, error: 'empty', name: '' };

  // Multi-word built-in names (e.g. `clear empty work dirs`) are matched before splitting, so the
  // whole phrase cannot fall through to a shorter command (`clear`) with the rest as arguments. The
  // longest phrase wins and anything after it becomes an argument, so `clear empty work dirs extra`
  // runs the cleanup instead of clearing the console.
  const phraseBuiltin = findBuiltinPhrasePrefix(tokens);
  if (phraseBuiltin != null) {
    return {
      ok: true,
      command: {
        name: tokens.slice(0, phraseBuiltin.length).join(' ').toLowerCase(),
        intent: phraseBuiltin.command.intent,
        args: tokens.slice(phraseBuiltin.length),
        source: 'builtin',
      },
    };
  }

  const name = first.toLowerCase();
  const aliases = userAliases ?? [];

  const builtin = findBuiltinCommandByName(name);
  if (builtin != null) return { ok: true, command: { name, intent: builtin.intent, args, source: 'builtin' } };

  const baseIntent = resolveBaseCommandName(name);
  if (baseIntent != null) {
    const legacy = legacyPatchCommands.some((command) => command.code === name);
    return { ok: true, command: { name, intent: baseIntent, args, source: legacy ? 'legacy' : 'action' } };
  }

  const baseAction = baseActionNames?.get(name);
  if (baseAction != null) return { ok: true, command: { name, intent: baseAction, args, source: 'base-action' } };

  const userAlias = aliases.find((entry) => entry.alias.toLowerCase() === name);
  if (userAlias != null) return { ok: true, command: { name, intent: userAlias.intent, args, source: 'user-alias' } };

  return { ok: false, error: 'unknown', name };
}
