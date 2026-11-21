import type { PatchIntent } from './commands.js';

/**
Built-in console commands (pure data).

These names are compiled in and can never be edited or removed: the alias editor only lets the
user *add* extra short names that point at one of these commands (see `aliasValidation.ts`).
Every name here is lower-case and matched lower-case.
*/
export interface PatchBuiltinCommand {
  intent: PatchIntent;
  /** Canonical (full) name, e.g. `togglebatchfileslist`. */
  name: string;
  /** Default short names, e.g. `['tbfl']`. */
  shortNames: readonly string[];
  /**
  Optional multi-word names (lower-case, single spaces). The parser matches the longest one
  before it treats the first token as the command, so `clear empty work dirs` works as typed and
  `clear empty work dirs extra` becomes that command with `extra` as its argument.
  */
  phrases?: readonly string[];
}

export const patchBuiltinCommands: readonly PatchBuiltinCommand[] = [
  {
    intent: 'toggle-batch-files-list',
    name: 'togglebatchfileslist',
    shortNames: ['tbfl'],
  },
  {
    intent: 'toggle-command-custom-settings',
    name: 'togglecommandcustomsettings',
    shortNames: ['tccs'],
  },
  {
    intent: 'toggle-keyboard-practice',
    name: 'togglekeyboardpractice',
    shortNames: ['tkp'],
  },
  {
    intent: 'toggle-work-settings',
    name: 'toggleworksettings',
    shortNames: ['tws'],
  },
  {
    // patch: the console's escape hatch for the incremental export.
    intent: 'exportForce',
    name: 'exportforce',
    shortNames: ['export-force'],
  },
  {
    intent: 'resumewindows',
    name: 'resumewindows',
    shortNames: ['rsw'],
  },
  {
    intent: 'toggleclipswindow',
    name: 'toggleclipswindow',
    shortNames: ['tcw'],
  },
  {
    intent: 'togglemergedwindow',
    name: 'togglemergedwindow',
    shortNames: ['tmw'],
  },
  {
    // patch: end the job (the two dialogs the `zm` / `zc` legacy codes already named).
    intent: 'post-process-merge',
    name: 'finishmerge',
    shortNames: ['zm'],
  },
  {
    intent: 'post-process-cut',
    name: 'finishcut',
    shortNames: ['zc'],
  },
  {
    // patch: the work folders the app has created (`opl`).
    intent: 'open-workpath-list',
    name: 'open-workpath-list',
    shortNames: ['opl'],
  },
  {
    // patch: move work areas that hold no files (strict whitelist) to the recycle bin (`cewd`).
    intent: 'clear-empty-work-dirs',
    name: 'clearemptyworkdirs',
    // The intent id doubles as a typed name, like `open-workpath-list`; the spaced form is a phrase.
    shortNames: ['cewd', 'clear-empty-work-dirs'],
    phrases: ['clear empty work dirs'],
  },
];

/** A user-defined extra short name for one of the built-in commands. */
export interface PatchUserAlias {
  /** Lower-case short name as typed. */
  alias: string;
  intent: PatchIntent;
}

/** Every name a built-in command answers to (canonical name first). */
export function builtinCommandNames(command: PatchBuiltinCommand) {
  return [command.name, ...command.shortNames, ...(command.phrases ?? [])];
}

/** All reserved names: no user alias may collide with any of them. */
export const reservedCommandNames: readonly string[] = patchBuiltinCommands.flatMap((command) => builtinCommandNames(command));

export function findBuiltinCommandByName(name: string) {
  const lower = name.toLowerCase();
  return patchBuiltinCommands.find((command) => builtinCommandNames(command).includes(lower));
}

/**
The longest multi-word built-in name the token list starts with.

`['clear', 'empty', 'work', 'dirs', 'extra']` returns the phrase `clear empty work dirs` and its
length, so the parser can pass `extra` on as an argument instead of falling through to the
single-token command `clear` (which would clear the console).
*/
export function findBuiltinPhrasePrefix(tokens: readonly string[]) {
  let best: { command: PatchBuiltinCommand; length: number } | undefined;
  for (const command of patchBuiltinCommands) {
    for (const phrase of command.phrases ?? []) {
      const phraseTokens = phrase.split(' ');
      const matches = phraseTokens.length <= tokens.length
        && phraseTokens.every((token, index) => token === tokens[index]?.toLowerCase());
      if (matches && (best == null || phraseTokens.length > best.length)) {
        best = { command, length: phraseTokens.length };
      }
    }
  }
  return best;
}

export function findBuiltinCommandByIntent(intent: PatchIntent) {
  return patchBuiltinCommands.find((command) => command.intent === intent);
}
