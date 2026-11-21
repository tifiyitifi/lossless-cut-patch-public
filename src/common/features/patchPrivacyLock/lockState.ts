import type { PatchHistoryLockEvent, PatchHistoryLockEventType, PatchHistoryLockMode } from './types.js';
import { patchHistoryLockEventLimit } from './types.js';

/**
The pure decisions of the privacy lock (fork-owned).

The main process keeps the state; these functions decide the two rules that are easy to get wrong:
what the first status of a run is, and when an idle machine locks the history. Keeping them pure
lets the settings and the main process agree without a second implementation.
*/

/** A hand-edited or older config value falls back to the quietest mode. */
export function parseHistoryLockMode(value: unknown): PatchHistoryLockMode {
  return value === 'startup' || value === 'idle' ? value : 'manual';
}

/**
Is the history visible when this run first asks for its status?

- no password record → nothing to hide;
- `manual` remembers the state of the last run (`historyLockLocked`);
- `startup` and `idle` always start locked, so the auto-lock is the first thing that happens.

This only decides the start; a later unlock/lock wins.
*/
export function initialHistoryUnlocked({ enabled, mode, storedLocked }: {
  enabled: boolean;
  mode: PatchHistoryLockMode;
  storedLocked: boolean;
}): boolean {
  if (!enabled) return true;
  if (mode === 'manual') return !storedLocked;
  return false;
}

/** Should the idle watcher lock the history now? It never unlocks. */
export function shouldLockAfterIdle({ mode, idleMinutes, idleSeconds }: {
  mode: PatchHistoryLockMode;
  idleMinutes: number;
  idleSeconds: number;
}): boolean {
  if (mode !== 'idle') return false;
  if (!Number.isFinite(idleMinutes) || idleMinutes <= 0) return false;
  return Number.isFinite(idleSeconds) && idleSeconds >= idleMinutes * 60;
}

/** Put a new event in front of the list and keep the list bounded. */
export function appendHistoryLockEvent(events: readonly PatchHistoryLockEvent[], event: PatchHistoryLockEvent, limit = patchHistoryLockEventLimit): PatchHistoryLockEvent[] {
  return [event, ...events].slice(0, Math.max(1, limit));
}

const eventTypes = new Set<PatchHistoryLockEventType>(['created', 'reset', 'changed', 'unlocked']);

/** Read the event log from a possibly hand-edited config. Newest first, bounded. */
export function parseHistoryLockEvents(value: unknown): PatchHistoryLockEvent[] {
  if (!Array.isArray(value)) return [];
  const events: PatchHistoryLockEvent[] = [];
  for (const entry of value) {
    if (typeof entry !== 'object' || entry == null) continue;
    const { at, type } = entry as { at?: unknown, type?: unknown };
    if (typeof at !== 'number' || !Number.isFinite(at)) continue;
    if (typeof type !== 'string' || !eventTypes.has(type as PatchHistoryLockEventType)) continue;
    events.push({ at, type: type as PatchHistoryLockEventType });
  }
  return events.sort((a, b) => b.at - a.at).slice(0, patchHistoryLockEventLimit);
}
