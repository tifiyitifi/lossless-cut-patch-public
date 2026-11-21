// eslint-disable-next-line import-js/no-extraneous-dependencies
import { describe, expect, it } from 'vitest';

import { decideResultsWindowLoadAction } from './windowLoad.js';

describe('decideResultsWindowLoadAction', () => {
  it('does nothing once the window reported that it is mounted', () => {
    expect(decideResultsWindowLoadAction({ ready: true, reloaded: false, reloadEnabled: true })).toBe('none');
    // A window that reported ready is left alone even after a retry.
    expect(decideResultsWindowLoadAction({ ready: true, reloaded: true, reloadEnabled: true })).toBe('none');
    expect(decideResultsWindowLoadAction({ ready: true, reloaded: false, reloadEnabled: false })).toBe('none');
  });

  it('retries a window that did not load, once', () => {
    expect(decideResultsWindowLoadAction({ ready: false, reloaded: false, reloadEnabled: true })).toBe('reload');
    expect(decideResultsWindowLoadAction({ ready: false, reloaded: true, reloadEnabled: true })).toBe('report');
  });

  it('never reloads when the user turned the reload off, but still reports the failure', () => {
    expect(decideResultsWindowLoadAction({ ready: false, reloaded: false, reloadEnabled: false })).toBe('report');
    expect(decideResultsWindowLoadAction({ ready: false, reloaded: true, reloadEnabled: false })).toBe('report');
  });
});
