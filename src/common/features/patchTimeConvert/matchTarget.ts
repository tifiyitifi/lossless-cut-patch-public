/**
Which video a written cut list belongs to (pure).

The text says its video's name (`a.mp4`, `a [1080p].mp4`, or a name somebody else's copy used). An
exact file name is the strongest answer, but a shared cut list rarely spells the name of the user's
own copy: download sites add `[...]` tags, a copy may have another extension, and the name may carry
the other machine's wording. Falling back to the stem - the name without its tags and extension -
finds those, but only when exactly one video in the list matches: guessing between two candidates
would attach the cut list to the wrong video, which is worse than asking the user to pick.

The caller keeps the choice editable, so a wrong stem match is one click away from being fixed.
*/
import { getPathFileName, getPathStem } from '../patchFinish/paths.js';

/** What the written name says about the videos the dialog can offer. */
export type TimePairsTargetMatch = | { kind: 'exact'; path: string }
  | { kind: 'stem'; path: string }
  /** More than one video has that stem: the user has to choose. */
  | { kind: 'ambiguous'; paths: string[] }
  | { kind: 'none' };

/** Collapse the spacing a hand-written or copied name may carry. */
function normalizeName(name: string) {
  return name.replaceAll(/\s+/gu, ' ').trim();
}

/**
A name without its bracketed tags and its extension: `a [1080p].mp4` -> `a`.

Tags are what download sites add and what a copy loses or changes, so they are ignored on both
sides. Parentheses are kept on purpose: `a (1).mp4` is a real, different file.
*/
export function getNameStem(name: string) {
  const withoutTags = normalizeName(name).replaceAll(/\[[^\]]*\]/gu, ' ');
  const collapsed = normalizeName(withoutTags);
  if (collapsed === '') return '';
  return getPathStem(collapsed).trim();
}

export function matchTimePairsTarget({ wantedName, filePaths, caseInsensitive }: {
  /** The video name the text declares, already unquoted. */
  wantedName: string | undefined;
  /** The videos the dialog can offer, most preferred first (the open file first). */
  filePaths: readonly (string | undefined)[];
  /** Windows and macOS ignore case in file names. */
  caseInsensitive: boolean;
}): TimePairsTargetMatch {
  const wanted = wantedName != null ? normalizeName(wantedName) : '';
  if (wanted === '') return { kind: 'none' };

  const paths = [...new Set(filePaths.filter((path): path is string => path != null && path !== ''))];
  const fold = (value: string) => (caseInsensitive ? value.toLowerCase() : value);

  const wantedFileName = fold(getPathFileName(wanted));
  const exact = paths.find((path) => fold(getPathFileName(path)) === wantedFileName);
  if (exact != null) return { kind: 'exact', path: exact };

  const wantedStem = fold(getNameStem(wanted));
  if (wantedStem === '') return { kind: 'none' };

  const stemMatches = paths.filter((path) => fold(getNameStem(getPathFileName(path))) === wantedStem);
  const [only] = stemMatches;
  if (only == null) return { kind: 'none' };
  if (stemMatches.length > 1) return { kind: 'ambiguous', paths: stemMatches };
  return { kind: 'stem', path: only };
}
