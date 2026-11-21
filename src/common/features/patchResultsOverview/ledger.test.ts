// eslint-disable-next-line import-js/no-extraneous-dependencies
import { describe, expect, it } from 'vitest';

import {
  emptyPatchFinishLedger,
  parsePatchFinishLedger,
  renamePatchFinishLedgerPaths,
  upsertPatchFinishLedgerEntry,
} from './ledger.js';

import type { PatchFinishLedgerEntry } from './ledger.js';

function entry(overrides: Partial<PatchFinishLedgerEntry> = {}): PatchFinishLedgerEntry {
  return { source: 'C:/v/a.mp4', clips: [], merged: [], parkedClips: [], parkedMerged: [], at: 1, ...overrides };
}

const ci = { caseInsensitive: true };

describe('parsePatchFinishLedger', () => {
  it('reads a stored ledger', () => {
    expect(parsePatchFinishLedger({
      version: 1,
      entries: [{ source: '/v/a.mp4', clips: ['/f/a-1.mp4'], merged: [], parkedClips: [], parkedMerged: [], at: 5 }],
    })).toStrictEqual({ version: 1, entries: [entry({ source: '/v/a.mp4', clips: ['/f/a-1.mp4'], at: 5 })] });
  });

  it('drops malformed entries instead of failing', () => {
    expect(parsePatchFinishLedger({
      version: 1,
      entries: [
        { source: '', at: 1 },
        { source: '/v/a.mp4' },
        { source: '/v/b.mp4', at: 2, clips: ['/f/b-1.mp4', 42] },
      ],
    })).toStrictEqual({ version: 1, entries: [entry({ source: '/v/b.mp4', clips: ['/f/b-1.mp4'], at: 2 })] });
  });

  it('treats another version or a missing file as empty', () => {
    expect(parsePatchFinishLedger(undefined)).toStrictEqual(emptyPatchFinishLedger());
    expect(parsePatchFinishLedger({ version: 2, entries: [] })).toStrictEqual(emptyPatchFinishLedger());
  });

  it('keeps the newest entry first', () => {
    const ledger = parsePatchFinishLedger({
      version: 1,
      entries: [
        { source: '/v/old.mp4', at: 1 },
        { source: '/v/new.mp4', at: 9 },
      ],
    });
    expect(ledger.entries.map((item) => item.source)).toStrictEqual(['/v/new.mp4', '/v/old.mp4']);
  });

  it('keeps a source fingerprint and drops a malformed one', () => {
    const ledger = parsePatchFinishLedger({
      version: 1,
      entries: [
        { source: '/v/a.mp4', at: 3, sourceIdentity: { size: 12, hash: 'abc' } },
        { source: '/v/b.mp4', at: 2, sourceIdentity: { size: -1, hash: 'abc' } },
        { source: '/v/c.mp4', at: 1, sourceIdentity: { size: 12, hash: '  ' } },
        { source: '/v/d.mp4', at: 0, sourceIdentity: 'nonsense' },
      ],
    });

    expect(ledger.entries.map((item) => item.source)).toStrictEqual(['/v/a.mp4', '/v/b.mp4', '/v/c.mp4', '/v/d.mp4']);
    expect(ledger.entries.map((item) => item.sourceIdentity)).toStrictEqual([{ size: 12, hash: 'abc' }, undefined, undefined, undefined]);
  });
});

describe('upsertPatchFinishLedgerEntry', () => {
  it('replaces the entry of the same source (any case or separator)', () => {
    const first = upsertPatchFinishLedgerEntry(emptyPatchFinishLedger(), entry({ source: String.raw`C:\v\a.mp4`, at: 1 }), ci);
    const next = upsertPatchFinishLedgerEntry(first, entry({ source: 'c:/V/A.mp4', at: 2 }), ci);
    expect(next.entries).toHaveLength(1);
    expect(next.entries[0]).toStrictEqual(entry({ source: 'c:/V/A.mp4', at: 2 }));
  });

  it('keeps two different sources apart and caps the list', () => {
    const ledger = upsertPatchFinishLedgerEntry(emptyPatchFinishLedger(), entry({ source: '/v/a.mp4', at: 1 }), ci);
    const capped = upsertPatchFinishLedgerEntry(ledger, entry({ source: '/v/b.mp4', at: 2 }), { ...ci, max: 1 });
    expect(capped.entries.map((item) => item.source)).toStrictEqual(['/v/b.mp4']);
  });
});

describe('renamePatchFinishLedgerPaths', () => {
  it('follows a renamed result', () => {
    const ledger = { version: 1 as const, entries: [entry({ source: '/v/a.mp4', clips: ['/f/old.mp4'] })] };
    const result = renamePatchFinishLedgerPaths(ledger, { from: '/f/old.mp4', to: '/f/new.mp4', ...ci });
    expect(result.updated).toBe(true);
    expect(result.ledger.entries[0]?.clips).toStrictEqual(['/f/new.mp4']);
  });

  it('follows a renamed source', () => {
    const ledger = { version: 1 as const, entries: [entry({ source: '/v/a.mp4' })] };
    const result = renamePatchFinishLedgerPaths(ledger, { from: '/V/A.mp4', to: '/v/a (1).mp4', ...ci });
    expect(result.ledger.entries[0]?.source).toBe('/v/a (1).mp4');
  });

  it('reports nothing to do for an unknown path', () => {
    const ledger = { version: 1 as const, entries: [entry({ source: '/v/a.mp4' })] };
    const result = renamePatchFinishLedgerPaths(ledger, { from: '/elsewhere.mp4', to: '/x.mp4', ...ci });
    expect(result.updated).toBe(false);
    expect(result.ledger).toBe(ledger);
  });
});
