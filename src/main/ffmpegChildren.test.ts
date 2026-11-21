// eslint-disable-next-line import-js/no-extraneous-dependencies
import { afterEach, describe, expect, it } from 'vitest';

import { abortAllFfmpegChildren, countFfmpegChildren, extractFfmpegInputPaths, stopFfmpegChildrenReading, trackFfmpegChild } from './ffmpegChildren.js';

const cleanups: (() => void)[] = [];

/** A fake child: aborting it is enough for the test to see it was stopped. */
function child(inputPaths: string[]) {
  const abortController = new AbortController();
  const done = trackFfmpegChild({ abortController, inputPaths });
  cleanups.push(done);
  return { abortController, done, wasAborted: () => abortController.signal.aborted };
}

afterEach(() => {
  for (const done of cleanups.splice(0)) done();
  // eslint-disable-next-line vitest/no-standalone-expect -- the check belongs to the afterEach cleanup, not to one test
  expect(countFfmpegChildren()).toBe(0);
});

describe('extractFfmpegInputPaths', () => {
  it('reads every input file of a command line', () => {
    expect(extractFfmpegInputPaths(['-hide_banner', '-i', '/v/a.mp4', '-c', 'copy', '/out.mp4'])).toStrictEqual(['/v/a.mp4']);
    expect(extractFfmpegInputPaths(['-i', '/v/a.mp4', '-i', String.raw`C:\v\b.mp4`, '-filter_complex', 'x'])).toStrictEqual(['/v/a.mp4', String.raw`C:\v\b.mp4`]);
  });

  it('ignores a pipe and an option that merely mentions a path', () => {
    // The waveform renderer pipes its first pass into the second: `-` is a stream, not a file.
    expect(extractFfmpegInputPaths(['-i', '-', '-i', '-'])).toStrictEqual([]);
    expect(extractFfmpegInputPaths(['-i', '/v/a.mp4', '-vf', 'movie=/v/overlay.png'])).toStrictEqual(['/v/a.mp4']);
  });

  it('is empty when the command line reads no file', () => {
    expect(extractFfmpegInputPaths(['-version'])).toStrictEqual([]);
    expect(extractFfmpegInputPaths(['-i'])).toStrictEqual([]);
  });
});

describe('stopFfmpegChildrenReading', () => {
  it('stops only the children that read one of the given files', async () => {
    const source = child([String.raw`C:\v\source.mp4`]);
    const other = child([String.raw`C:\v\other.mp4`]);

    const result = await stopFfmpegChildrenReading({
      paths: ['c:/v/source.mp4'],
      caseInsensitive: true,
      sleep: async () => { source.done(); },
    });

    expect(source.wasAborted()).toBe(true);
    // Another window's export must survive: the job only moves its own files.
    expect(other.wasAborted()).toBe(false);
    expect(result).toStrictEqual({ stopped: 1, stillRunning: 0 });
  });

  it('matches the separator and the case the way the file system does', async () => {
    const source = child([String.raw`C:\V\Source.mp4`]);
    const result = await stopFfmpegChildrenReading({
      paths: ['c:/v/source.mp4'],
      caseInsensitive: true,
      sleep: async () => { source.done(); },
    });
    expect(result.stopped).toBe(1);
  });

  it('leaves a differently cased path alone when the file system is case sensitive', async () => {
    child(['/v/Source.mp4']);
    const result = await stopFfmpegChildrenReading({
      paths: ['/v/source.mp4'],
      caseInsensitive: false,
      timeoutMs: 0,
      sleep: async () => undefined,
    });
    expect(result).toStrictEqual({ stopped: 0, stillRunning: 0 });
  });

  it('reports a child that outlives the wait instead of pretending it is gone', async () => {
    // The abort is only a request; a process that keeps the file open is exactly what makes the
    // caller's move fail, so the caller has to know.
    child(['/v/source.mp4']);
    const result = await stopFfmpegChildrenReading({
      paths: ['/v/source.mp4'],
      caseInsensitive: false,
      timeoutMs: 100,
      sleep: async () => undefined,
    });
    expect(result).toStrictEqual({ stopped: 1, stillRunning: 1 });
  });

  it('does nothing when no child reads the files', async () => {
    const other = child(['/v/other.mp4']);
    const result = await stopFfmpegChildrenReading({ paths: ['/v/source.mp4'], caseInsensitive: false, sleep: async () => { other.done(); } });
    expect(result).toStrictEqual({ stopped: 0, stillRunning: 0 });
    expect(other.wasAborted()).toBe(false);
  });
});

describe('abortAllFfmpegChildren', () => {
  it('aborts every child and reports how many there were', () => {
    const first = child(['/v/a.mp4']);
    const second = child(['/v/b.mp4']);
    expect(abortAllFfmpegChildren()).toBe(2);
    expect(first.wasAborted()).toBe(true);
    expect(second.wasAborted()).toBe(true);
  });

  it('counts only the children that have not exited', () => {
    const first = child(['/v/a.mp4']);
    const second = child(['/v/b.mp4']);
    first.done();
    first.done(); // idempotent: a late exit report must not remove a newer child
    expect(countFfmpegChildren()).toBe(1);
    expect(abortAllFfmpegChildren()).toBe(1);
    expect(second.wasAborted()).toBe(true);
  });
});
