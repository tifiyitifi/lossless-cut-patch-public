// eslint-disable-next-line import-js/no-extraneous-dependencies
import { describe, expect, it } from 'vitest';

import { appendHistoryLockEvent, initialHistoryUnlocked, parseHistoryLockEvents, parseHistoryLockMode, shouldLockAfterIdle } from './lockState.js';
import type { PatchHistoryLockEvent } from './types.js';

describe('initialHistoryUnlocked', () => {
  it('shows everything when no password is set', () => {
    expect(initialHistoryUnlocked({ enabled: false, mode: 'startup', storedLocked: true })).toBe(true);
  });

  it('remembers the last state in manual mode', () => {
    expect(initialHistoryUnlocked({ enabled: true, mode: 'manual', storedLocked: false })).toBe(true);
    expect(initialHistoryUnlocked({ enabled: true, mode: 'manual', storedLocked: true })).toBe(false);
  });

  it('always starts locked in the two automatic modes', () => {
    expect(initialHistoryUnlocked({ enabled: true, mode: 'startup', storedLocked: false })).toBe(false);
    expect(initialHistoryUnlocked({ enabled: true, mode: 'idle', storedLocked: false })).toBe(false);
  });
});

describe('shouldLockAfterIdle', () => {
  it('only fires in idle mode', () => {
    expect(shouldLockAfterIdle({ mode: 'manual', idleMinutes: 10, idleSeconds: 10_000 })).toBe(false);
    expect(shouldLockAfterIdle({ mode: 'startup', idleMinutes: 10, idleSeconds: 10_000 })).toBe(false);
    expect(shouldLockAfterIdle({ mode: 'idle', idleMinutes: 10, idleSeconds: 599 })).toBe(false);
    expect(shouldLockAfterIdle({ mode: 'idle', idleMinutes: 10, idleSeconds: 600 })).toBe(true);
  });

  it('does nothing when the idle time is off or invalid', () => {
    expect(shouldLockAfterIdle({ mode: 'idle', idleMinutes: 0, idleSeconds: 10_000 })).toBe(false);
    expect(shouldLockAfterIdle({ mode: 'idle', idleMinutes: NaN, idleSeconds: 10_000 })).toBe(false);
    expect(shouldLockAfterIdle({ mode: 'idle', idleMinutes: 10, idleSeconds: NaN })).toBe(false);
  });
});

describe('parseHistoryLockMode', () => {
  it('accepts the three modes and falls back to manual', () => {
    expect(parseHistoryLockMode('manual')).toBe('manual');
    expect(parseHistoryLockMode('startup')).toBe('startup');
    expect(parseHistoryLockMode('idle')).toBe('idle');
    expect(parseHistoryLockMode('nope')).toBe('manual');
    expect(parseHistoryLockMode(undefined)).toBe('manual');
  });
});

describe('appendHistoryLockEvent and parseHistoryLockEvents', () => {
  const event = (at: number, type: PatchHistoryLockEvent['type']): PatchHistoryLockEvent => ({ at, type });

  it('puts the newest event first and keeps the limit', () => {
    const events = [event(1, 'created'), event(2, 'unlocked')];
    expect(appendHistoryLockEvent(events, event(3, 'reset'))).toStrictEqual([
      event(3, 'reset'),
      event(1, 'created'),
      event(2, 'unlocked'),
    ]);
    const full = Array.from({ length: 10 }, (_, index) => event(index, 'unlocked'));
    expect(appendHistoryLockEvent(full, event(99, 'changed'))).toHaveLength(10);
    expect(appendHistoryLockEvent(full, event(99, 'changed'))[0]).toStrictEqual(event(99, 'changed'));
  });

  it('drops malformed events and sorts newest first', () => {
    expect(parseHistoryLockEvents([
      { at: 1, type: 'created' },
      { at: 3, type: 'reset' },
      { at: 2, type: 'nope' },
      { at: 'x', type: 'changed' },
      null,
      { at: 4, type: 'unlocked' },
    ])).toStrictEqual([event(4, 'unlocked'), event(3, 'reset'), event(1, 'created')]);
  });

  it('returns an empty list for anything that is not a list', () => {
    expect(parseHistoryLockEvents(undefined)).toStrictEqual([]);
    expect(parseHistoryLockEvents('x')).toStrictEqual([]);
  });
});
