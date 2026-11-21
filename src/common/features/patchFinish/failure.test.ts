// eslint-disable-next-line import-js/no-extraneous-dependencies
import { describe, expect, it } from 'vitest';

import { classifyFinishFailureReason } from './failure.js';

describe('classifyFinishFailureReason', () => {
  it('tells a locked file from a refused permission', () => {
    expect(classifyFinishFailureReason('EBUSY')).toBe('locked');
    expect(classifyFinishFailureReason('EPERM')).toBe('permission');
    expect(classifyFinishFailureReason('EACCES')).toBe('permission');
    expect(classifyFinishFailureReason('EROFS')).toBe('permission');
  });

  it('reports a file that is gone, a full volume and a cross-volume move', () => {
    expect(classifyFinishFailureReason('ENOENT')).toBe('missing');
    expect(classifyFinishFailureReason('ENOSPC')).toBe('no-space');
    expect(classifyFinishFailureReason('EXDEV')).toBe('other-volume');
  });

  it('ignores the case and surrounding spaces of the code', () => {
    expect(classifyFinishFailureReason(' eperm ')).toBe('permission');
  });

  it('keeps an unknown reason for the dialog to show as it is', () => {
    expect(classifyFinishFailureReason('EUNKNOWN')).toBe('unknown');
    expect(classifyFinishFailureReason('EISDIR')).toBe('unknown');
  });

  it('does not classify a message that merely mentions a code', () => {
    // The executor stores the code when there is one and the message otherwise; a message is not a
    // code, so it must not be turned into advice that hides what it said.
    expect(classifyFinishFailureReason('EPERM: operation not permitted')).toBe('unknown');
  });
});
