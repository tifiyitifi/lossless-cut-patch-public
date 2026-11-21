import type { KeyboardAction } from '../../../../common/types';

/** Lower-cased base action name -> canonical `KeyboardAction`. */
export type BaseActionNames = ReadonlyMap<string, KeyboardAction>;

/** Build the lookup from the app's own action map, so the console accepts every base action. */
export function buildBaseActionNames(baseActions: Record<string, unknown>): BaseActionNames {
  return new Map(Object.keys(baseActions).map((name) => [name.toLowerCase(), name as KeyboardAction]));
}
