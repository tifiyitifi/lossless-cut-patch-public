// eslint-disable-next-line import-js/no-extraneous-dependencies
import { describe, expect, it } from 'vitest';

import { hasKeyframeToCopyFrom } from './cutStart.js';

describe('hasKeyframeToCopyFrom', () => {
  it('accepts a keyframe exactly on the cut start', () => {
    expect(hasKeyframeToCopyFrom({ keyframeTimes: [10, 12, 14], cutFrom: 12 })).toBe(true);
  });

  it('accepts a keyframe after the cut start', () => {
    // The normal case: the head encodes the frames up to this keyframe, the copy starts on it.
    expect(hasKeyframeToCopyFrom({ keyframeTimes: [10, 12.4, 14], cutFrom: 11 })).toBe(true);
  });

  it('refuses when every keyframe is before the cut start', () => {
    // The real failure: the segment starts after the source's last keyframe (cut start 375.613022,
    // last keyframe 374.966341), so upstream's smart cut throws and the export produces nothing.
    expect(hasKeyframeToCopyFrom({ keyframeTimes: [366.633008, 370.799674, 374.966341], cutFrom: 375.613022 })).toBe(false);
  });

  it('refuses on an empty list', () => {
    expect(hasKeyframeToCopyFrom({ keyframeTimes: [], cutFrom: 0 })).toBe(false);
  });

  it('is a sub-frame difference, not a tolerance', () => {
    // The cut start is compared as it is: a keyframe a fraction of a frame earlier still counts as
    // "before", because the copy cannot start there without including frames the user cut away.
    expect(hasKeyframeToCopyFrom({ keyframeTimes: [12], cutFrom: 12.000001 })).toBe(false);
  });
});
