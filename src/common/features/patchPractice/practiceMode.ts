import type { KeyboardAction } from '../../types.js';
import { practiceGuides } from './practiceGuides.js';
import type { PracticeGuide, PracticeGuideId } from './practiceGuides.js';

/**
Keyboard practice mode (pure logic).

Practice mode never lets a key run silently the first time it is seen in a guide: pressing it
opens the guide's notes instead. Whether that happens on every press or only when entering a new
guide is the user's choice (`PracticePopupMode`).
*/
export type PracticePopupMode = 'per-guide' | 'every-press';

export const practicePopupModes = ['per-guide', 'every-press'] as const;

/** Default: notes once per guide visit, then the keys run normally. */
export const defaultPracticePopupMode: PracticePopupMode = 'per-guide';

const fallbackGuideIdPrefix = 'action:';

/**
Id of the fallback card for an action that has no curated guide.

Every current action is covered by a guide, so this only matters for actions added upstream
later: they still get a card (their own name plus their bindings) instead of being ignored.
*/
export function fallbackGuideId(action: KeyboardAction) {
  return `${fallbackGuideIdPrefix}${action}`;
}

export function isFallbackGuideId(id: string) {
  return id.startsWith(fallbackGuideIdPrefix);
}

/** The action behind a fallback card id. */
export function actionFromFallbackGuideId(id: string) {
  return id.slice(fallbackGuideIdPrefix.length) as KeyboardAction;
}

const guideIdByAction = new Map<KeyboardAction, PracticeGuideId>();
for (const guide of practiceGuides) {
  for (const action of guide.triggers) guideIdByAction.set(action, guide.id);
}

/** The guide an action belongs to; curated when there is one, otherwise the action's own card. */
export function resolveGuideIdForAction(action: KeyboardAction): string {
  return guideIdByAction.get(action) ?? fallbackGuideId(action);
}

export function findPracticeGuide(id: string) {
  return practiceGuides.find((guide) => guide.id === id);
}

/**
The shortcuts the notes panel lists for a guide.

The guide's own triggers always belong on its card, even when they are not repeated in the
curated `related` links: a user may bind one of them later, and the card should then show the key
that opens it. `related` adds the deliberate cross-links, so the union is deduplicated.
*/
export function guideRelatedActions(guide: PracticeGuide): KeyboardAction[] {
  return [...new Set<KeyboardAction>([...guide.triggers, ...guide.related])];
}

/**
Should pressing `action` open the guide notes instead of running the action?

- `every-press`: always.
- `per-guide`: only when the action belongs to a different guide than the one currently shown, so
  a guide's notes appear once and its keys then run normally. To see them again, press a key from
  another guide first.
*/
export function shouldShowPracticePopup(mode: PracticePopupMode, action: KeyboardAction, currentGuideId: string | undefined) {
  if (mode === 'every-press') return true;
  return resolveGuideIdForAction(action) !== currentGuideId;
}
