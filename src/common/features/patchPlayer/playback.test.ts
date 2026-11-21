// eslint-disable-next-line import-js/no-extraneous-dependencies
import { describe, expect, it } from 'vitest';

import { planPlaybackPause } from './playback.js';

describe('planPlaybackPause', () => {
  it('pauses every other window when the cutting window starts playing', () => {
    expect(planPlaybackPause({ source: 'source', singleWindowPlayback: true }))
      .toStrictEqual({ pauseSource: false, pauseResults: ['cut-results', 'merged', 'inspect'] });
    // The setting only relaxes the results pair, never the cutting window.
    expect(planPlaybackPause({ source: 'source', singleWindowPlayback: false }))
      .toStrictEqual({ pauseSource: false, pauseResults: ['cut-results', 'merged', 'inspect'] });
  });

  it('pauses the source and the other results window when the setting is on', () => {
    expect(planPlaybackPause({ source: 'cut-results', singleWindowPlayback: true }))
      .toStrictEqual({ pauseSource: true, pauseResults: ['merged', 'inspect'] });
    expect(planPlaybackPause({ source: 'merged', singleWindowPlayback: true }))
      .toStrictEqual({ pauseSource: true, pauseResults: ['cut-results', 'inspect'] });
  });

  it('lets the two results windows play together when the setting is off', () => {
    expect(planPlaybackPause({ source: 'cut-results', singleWindowPlayback: false }))
      .toStrictEqual({ pauseSource: true, pauseResults: ['inspect'] });
    expect(planPlaybackPause({ source: 'merged', singleWindowPlayback: false }))
      .toStrictEqual({ pauseSource: true, pauseResults: ['inspect'] });
  });

  it('pauses everything else when the check player starts playing', () => {
    expect(planPlaybackPause({ source: 'inspect', singleWindowPlayback: true }))
      .toStrictEqual({ pauseSource: true, pauseResults: ['cut-results', 'merged'] });
    // The setting never relaxes the check player: it exists to judge one file.
    expect(planPlaybackPause({ source: 'inspect', singleWindowPlayback: false }))
      .toStrictEqual({ pauseSource: true, pauseResults: ['cut-results', 'merged'] });
  });

  it('never pauses the window that started playing', () => {
    for (const source of ['source', 'cut-results', 'merged', 'inspect'] as const) {
      for (const singleWindowPlayback of [true, false]) {
        const plan = planPlaybackPause({ source, singleWindowPlayback });
        expect(plan.pauseResults).not.toContain(source);
        expect(plan.pauseSource).toBe(source !== 'source');
      }
    }
  });
});
