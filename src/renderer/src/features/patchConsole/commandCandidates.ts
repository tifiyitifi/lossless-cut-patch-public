import { patchBuiltinCommands, normalizeAlias } from '../../../../common/features/patchCommand';
import type { PatchIntent, PatchUserAlias } from '../../../../common/features/patchCommand';

/**
One console candidate: a built-in command plus every name it answers to (its own full name, its
compiled-in short names and the user's extra aliases).
*/
export interface CommandCandidate {
  intent: PatchIntent;
  /** Canonical name, e.g. `togglebatchfileslist`. */
  name: string;
  /** Canonical name first, then the built-in short names, then the user aliases. */
  names: string[];
  /** Extra user aliases only (shown separately so the user sees their own names). */
  userAliases: string[];
}

/** All candidates, with the user's aliases folded in. */
export function getCommandCandidates(userAliases: readonly PatchUserAlias[]): CommandCandidate[] {
  return patchBuiltinCommands.map((command) => {
    const aliases = userAliases.filter((entry) => entry.intent === command.intent).map((entry) => normalizeAlias(entry.alias));
    return {
      intent: command.intent,
      name: command.name,
      names: [command.name, ...command.shortNames, ...(command.phrases ?? []), ...aliases],
      userAliases: aliases,
    };
  });
}

/**
The input as one comparable string: lower-case, single spaces.

Matching uses the **whole** input, not just its first token, so a multi-word command
(`clear empty work dirs`) is found while it is still being typed.
*/
export function getCommandQuery(input: string) {
  return input.trim().toLowerCase().split(/\s+/).filter((token) => token.length > 0).join(' ');
}

function getCommandQueryTokens(input: string) {
  const query = getCommandQuery(input);
  return query === '' ? [] : query.split(' ');
}

interface CommandTermMatch {
  term: string;
  /** 0 = the term starts the input (possibly followed by arguments), 1 = the input is inside it. */
  score: number;
}

/** The term of the candidate the input matches; the longest one wins (phrase over its fragments). */
function findTermMatch(input: string, candidate: CommandCandidate): CommandTermMatch | undefined {
  const query = getCommandQuery(input);
  if (query === '') return undefined;

  let best: CommandTermMatch | undefined;
  const consider = (term: string, score: number) => {
    if (best == null || score < best.score || (score === best.score && term.length > best.term.length)) {
      best = { term, score };
    }
  };

  for (const term of [...candidate.names, candidate.intent]) {
    if (term.startsWith(query)) consider(term, 0);
    // The whole term is typed and its arguments follow: completing must keep them.
    else if (query.startsWith(`${term} `)) consider(term, 0);
    else if (term.includes(query)) consider(term, 1);
  }
  return best;
}

/** Candidates whose name (or intent id) matches the input, best prefix matches first. */
export function filterCommandCandidates(candidates: readonly CommandCandidate[], input: string): CommandCandidate[] {
  if (getCommandQuery(input) === '') return [...candidates];
  return candidates
    .flatMap((candidate) => {
      const match = findTermMatch(input, candidate);
      return match == null ? [] : [{ candidate, score: match.score }];
    })
    .sort((a, b) => a.score - b.score)
    .map(({ candidate }) => candidate);
}

/** The term Tab should insert for a candidate (the multi-word phrase, not its canonical name). */
export function getCommandCompletionTerm(input: string, candidate: CommandCandidate) {
  return findTermMatch(input, candidate)?.term ?? candidate.name;
}

/** Replace the typed command name, keeping any arguments the user already typed. */
export function completeCommandInput(input: string, name: string) {
  const nameTokens = name.split(' ');
  const rest = getCommandQueryTokens(input).slice(nameTokens.length).join(' ');
  return rest === '' ? name : `${name} ${rest}`;
}

/**
The grey inline hint: the rest of the single matching name, shown while the user types.
Returns undefined when there is no unique candidate to hint at.
*/
export function getCommandHint(input: string, candidates: readonly CommandCandidate[]) {
  const query = getCommandQuery(input);
  if (query === '') return undefined;
  const matches = candidates.filter((candidate) => findTermMatch(input, candidate) != null);
  if (matches.length !== 1) return undefined;
  const [match] = matches;
  if (match == null) return undefined;
  const termMatch = findTermMatch(input, match);
  // Only a prefix can be continued; a "contains" match (`custom`) has no remainder to show.
  if (termMatch?.score !== 0) return undefined;
  const { term } = termMatch;
  // The term is already complete (possibly with arguments following it): nothing left to hint.
  if (term === query || query.startsWith(`${term} `)) return undefined;
  return term.slice(query.length);
}
