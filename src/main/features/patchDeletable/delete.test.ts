// eslint-disable-next-line import-js/no-extraneous-dependencies
import { describe, expect, it } from 'vitest';

import type { PatchDetachableReport, PatchDetachableSourceRow } from '../../../common/features/patchDeletable/rows.js';

import { deletePatchDetachedSources } from './delete.js';
import type { PatchDeleteDetachedDeps } from './delete.js';

const root = 'C:/work';
const detached = `${root}/.losslesscut_work/detached_src_media`;
const finished = `${root}/losslesscut_finished/finished_src_media`;

function row(path: string, deletable: boolean): PatchDetachableSourceRow {
  return {
    path,
    reason: deletable ? 'deletable' : 'no-results',
    deletable,
    clips: deletable ? [{ path: `${path}-1.mp4`, folder: 'finishedClips' }] : [],
    merged: [],
    parked: [],
    missing: [],
    pairing: 'ledger',
  };
}

function report(rows: PatchDetachableSourceRow[]): PatchDetachableReport {
  return {
    workRoot: root,
    detachedSrcMediaDir: detached,
    rows,
    totals: { sources: rows.length, deletable: rows.filter((entry) => entry.deletable).length, results: rows.length },
    warnings: [],
  };
}

interface Fake {
  report: PatchDetachableReport;
  files: Set<string>;
  openElsewhere?: Set<string>;
  /** Errors thrown by `unlink`, keyed by path (a sequence per path). */
  unlinkErrors?: Map<string, unknown[]>;
  /** The order of the calls the executor made. */
  calls: string[];
}

function deps(fake: Fake, overrides: Partial<PatchDeleteDetachedDeps> = {}): PatchDeleteDetachedDeps {
  return {
    readReport: async () => fake.report,
    exists: async (path) => fake.files.has(path),
    isOpenElsewhere: (path) => fake.openElsewhere?.has(path) === true,
    releasePlayers: () => { fake.calls.push('release'); },
    stopReaders: async (paths) => { fake.calls.push(`stop:${paths.length}`); },
    unlink: async (path) => {
      fake.calls.push(`unlink:${path}`);
      const errors = fake.unlinkErrors?.get(path);
      if (errors != null && errors.length > 0) throw errors.shift();
      if (!fake.files.delete(path)) throw Object.assign(new Error('not found'), { code: 'ENOENT' });
    },
    sleep: async () => undefined,
    ...overrides,
  };
}

const params = { workRoot: root, caseInsensitive: true };

describe('deletePatchDetachedSources', () => {
  it('deletes a deletable source after releasing the players and stopping the readers', async () => {
    const path = `${detached}/a.mp4`;
    const fake: Fake = { report: report([row(path, true)]), files: new Set([path]), calls: [] };

    const result = await deletePatchDetachedSources({ ...params, paths: [path] }, deps(fake));

    expect(result.outcomes).toStrictEqual([{ path, status: 'deleted' }]);
    expect(fake.calls).toStrictEqual(['release', 'stop:1', `unlink:${path}`]);
    expect(fake.files.has(path)).toBe(false);
  });

  it('refuses a path the report does not offer', async () => {
    const path = `${detached}/a.mp4`;
    const fake: Fake = { report: report([row(path, false)]), files: new Set([path]), calls: [] };

    const result = await deletePatchDetachedSources({ ...params, paths: [path] }, deps(fake));

    expect(result.outcomes).toStrictEqual([{ path, status: 'not-deletable' }]);
    expect(fake.calls).toStrictEqual([]);
    expect(fake.files.has(path)).toBe(true);
  });

  it('refuses a file of a sibling folder even when a stale report names it', async () => {
    const path = `${detached}2/a.mp4`;
    const fake: Fake = { report: report([row(path, true)]), files: new Set([path]), calls: [] };

    const result = await deletePatchDetachedSources({ ...params, paths: [path] }, deps(fake));

    expect(result.outcomes).toStrictEqual([{ path, status: 'not-deletable' }]);
    expect(fake.files.has(path)).toBe(true);
  });

  it('refuses a file of the finished folder', async () => {
    const path = `${finished}/a.mp4`;
    const fake: Fake = { report: report([row(path, true)]), files: new Set([path]), calls: [] };

    const result = await deletePatchDetachedSources({ ...params, paths: [path] }, deps(fake));

    expect(result.outcomes).toStrictEqual([{ path, status: 'not-deletable' }]);
  });

  it('reports a source that is already gone as missing, without touching anything', async () => {
    const path = `${detached}/a.mp4`;
    const fake: Fake = { report: report([row(path, true)]), files: new Set(), calls: [] };

    const result = await deletePatchDetachedSources({ ...params, paths: [path] }, deps(fake));

    expect(result.outcomes).toStrictEqual([{ path, status: 'missing' }]);
    expect(fake.calls).toStrictEqual([]);
  });

  it('reports a file another window shows as open-elsewhere', async () => {
    const path = `${detached}/a.mp4`;
    const fake: Fake = { report: report([row(path, true)]), files: new Set([path]), openElsewhere: new Set([path]), calls: [] };

    const result = await deletePatchDetachedSources({ ...params, paths: [path] }, deps(fake));

    expect(result.outcomes).toStrictEqual([{ path, status: 'open-elsewhere' }]);
    expect(fake.files.has(path)).toBe(true);
  });

  it('retries a locked file and reports it as locked when it never unlocks', async () => {
    const path = `${detached}/a.mp4`;
    const fake: Fake = {
      report: report([row(path, true)]),
      files: new Set([path]),
      calls: [],
      unlinkErrors: new Map([[path, [Object.assign(new Error('locked'), { code: 'EBUSY' }), Object.assign(new Error('locked'), { code: 'EBUSY' }), Object.assign(new Error('locked'), { code: 'EBUSY' }), Object.assign(new Error('locked'), { code: 'EBUSY' }), Object.assign(new Error('locked'), { code: 'EPERM' })]]]),
    };

    const result = await deletePatchDetachedSources({ ...params, paths: [path] }, deps(fake));

    expect(result.outcomes).toStrictEqual([{ path, status: 'locked' }]);
    expect(fake.files.has(path)).toBe(true);
    expect(fake.calls.filter((call) => call.startsWith('unlink:'))).toHaveLength(5);
  });

  it('succeeds when the lock is released during a retry', async () => {
    const path = `${detached}/a.mp4`;
    const fake: Fake = {
      report: report([row(path, true)]),
      files: new Set([path]),
      calls: [],
      unlinkErrors: new Map([[path, [Object.assign(new Error('locked'), { code: 'EBUSY' })]]]),
    };

    const result = await deletePatchDetachedSources({ ...params, paths: [path] }, deps(fake));

    expect(result.outcomes).toStrictEqual([{ path, status: 'deleted' }]);
    expect(fake.files.has(path)).toBe(false);
  });

  it('keeps going after a failed file and returns one outcome per requested path', async () => {
    const a = `${detached}/a.mp4`;
    const b = `${detached}/b.mp4`;
    const fake: Fake = {
      report: report([row(a, true), row(b, true)]),
      files: new Set([a, b]),
      calls: [],
      unlinkErrors: new Map([[a, [Object.assign(new Error('denied'), { code: 'EISDIR' })]]]),
    };

    const result = await deletePatchDetachedSources({ ...params, paths: [a, b] }, deps(fake));

    expect(result.outcomes.map((outcome) => [outcome.path, outcome.status])).toStrictEqual([[a, 'failed'], [b, 'deleted']]);
    expect(result.outcomes[0]?.detail).toContain('denied');
    expect(fake.files.has(b)).toBe(false);
  });

  it('reports a file that vanished between the check and the unlink as missing', async () => {
    const path = `${detached}/a.mp4`;
    const fake: Fake = {
      report: report([row(path, true)]),
      files: new Set([path]),
      calls: [],
      unlinkErrors: new Map([[path, [Object.assign(new Error('gone'), { code: 'ENOENT' })]]]),
    };

    const result = await deletePatchDetachedSources({ ...params, paths: [path] }, deps(fake));

    expect(result.outcomes).toStrictEqual([{ path, status: 'missing' }]);
  });

  it('drops duplicates instead of deleting the same file twice', async () => {
    const path = `${detached}/a.mp4`;
    const fake: Fake = { report: report([row(path, true)]), files: new Set([path]), calls: [] };

    const result = await deletePatchDetachedSources({ ...params, paths: [path, path.toUpperCase()] }, deps(fake));

    expect(result.outcomes).toStrictEqual([{ path, status: 'deleted' }]);
    expect(fake.calls.filter((call) => call.startsWith('unlink:'))).toHaveLength(1);
  });

  it('does nothing for an empty request', async () => {
    const fake: Fake = { report: report([]), files: new Set(), calls: [] };

    const result = await deletePatchDetachedSources({ ...params, paths: [] }, deps(fake));

    expect(result).toStrictEqual({ outcomes: [] });
    expect(fake.calls).toStrictEqual([]);
  });
});
