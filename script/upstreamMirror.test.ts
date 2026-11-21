import { describe, expect, it } from 'vitest';

import {
  MIRROR_PREFIX,
  buildBranchPushRefspecs,
  buildTagPushRefspecs,
  findMirrorMismatches,
  parseLsRemoteHeads,
  parseLsRemoteTags,
  parseTargetRepo,
} from './upstreamMirror.ts';

describe('buildBranchPushRefspecs', () => {
  it('mirrors every upstream branch under the upstream/ namespace', () => {
    expect(
      buildBranchPushRefspecs([
        'refs/remotes/upstream/master',
        'refs/remotes/upstream/claude/some-branch',
      ]),
    ).toStrictEqual([
      'refs/remotes/upstream/claude/some-branch:refs/heads/upstream/claude/some-branch',
      'refs/remotes/upstream/master:refs/heads/upstream/master',
    ]);
  });

  it('skips upstream/HEAD, which would create a branch literally named HEAD', () => {
    expect(
      buildBranchPushRefspecs(['refs/remotes/upstream/HEAD', 'refs/remotes/upstream/master']),
    ).toStrictEqual(['refs/remotes/upstream/master:refs/heads/upstream/master']);
  });

  it('ignores refs that do not belong to the upstream remote-tracking namespace', () => {
    expect(
      buildBranchPushRefspecs([
        'refs/remotes/origin/master',
        'refs/heads/patch-cut-dev',
        'refs/tags/v3.70.2',
      ]),
    ).toStrictEqual([]);
  });

  it('never pushes an unprefixed branch, so a target branch such as main cannot be overwritten', () => {
    const [refspec = ''] = buildBranchPushRefspecs(['refs/remotes/upstream/main']);
    expect(refspec.startsWith('refs/remotes/upstream/main:refs/heads/upstream/')).toBe(true);
  });
});

describe('buildTagPushRefspecs', () => {
  it('mirrors upstream tags under the upstream/ namespace', () => {
    expect(buildTagPushRefspecs(['v3.70.2', '3.61.1'])).toStrictEqual([
      'refs/tags/3.61.1:refs/tags/upstream/3.61.1',
      'refs/tags/v3.70.2:refs/tags/upstream/v3.70.2',
    ]);
  });

  it('drops the peeled ^{} refs that git ls-remote reports for annotated tags', () => {
    expect(buildTagPushRefspecs(['v3.70.2', 'v3.70.2^{}'])).toStrictEqual([
      'refs/tags/v3.70.2:refs/tags/upstream/v3.70.2',
    ]);
  });

  it('produces nothing when upstream has no tags', () => {
    expect(buildTagPushRefspecs([])).toStrictEqual([]);
  });
});

describe('parseLsRemoteHeads', () => {
  it('parses sha and branch name from git ls-remote --heads output', () => {
    expect(
      parseLsRemoteHeads(
        [
          '4c7ab1cb0c9acaefabb48e997bc909562dc3624d\trefs/heads/master',
          '261019072bd9e4a353a0b9d29185d82949118261\trefs/heads/stores/apple',
          '',
        ].join('\n'),
      ),
    ).toStrictEqual([
      { name: 'master', sha: '4c7ab1cb0c9acaefabb48e997bc909562dc3624d' },
      { name: 'stores/apple', sha: '261019072bd9e4a353a0b9d29185d82949118261' },
    ]);
  });

  it('returns an empty list for empty output', () => {
    expect(parseLsRemoteHeads('')).toStrictEqual([]);
  });
});

describe('parseLsRemoteTags', () => {
  it('keeps tag names only, and skips the peeled refs of annotated tags', () => {
    expect(
      parseLsRemoteTags(
        [
          'f900bc795856f97f84c8637a81753d6f762f7991\trefs/tags/v3.70.2',
          '4c7ab1cb0c9acaefabb48e997bc909562dc3624d\trefs/tags/v3.70.2^{}',
          '69b3215583dcf997fb44e4bf6490a120a9a79b9c\trefs/tags/3.61.1',
          '',
        ].join('\n'),
      ),
    ).toStrictEqual(['v3.70.2', '3.61.1']);
  });

  it('returns an empty list for empty output', () => {
    expect(parseLsRemoteTags('')).toStrictEqual([]);
  });
});

describe('parseTargetRepo', () => {
  it('takes the target repository from the command line', () => {
    expect(parseTargetRepo(['origin'])).toBe('origin');
  });

  it('accepts a URL, so no fork address has to be stored in the repo', () => {
    expect(parseTargetRepo(['https://example.com/fork.git'])).toBe('https://example.com/fork.git');
  });

  it('returns undefined when no target repository is given', () => {
    expect(parseTargetRepo([])).toBeUndefined();
    expect(parseTargetRepo([''])).toBeUndefined();
  });
});

describe('findMirrorMismatches', () => {
  const upstream = [
    { name: 'master', sha: 'aaa' },
    { name: 'stores/apple', sha: 'bbb' },
    { name: 'claude/x', sha: 'ccc' },
  ];

  it('reports nothing when every upstream ref is mirrored at the same sha', () => {
    const mirrored = upstream.map((ref) => ({ name: `${MIRROR_PREFIX}${ref.name}`, sha: ref.sha }));
    expect(findMirrorMismatches(upstream, mirrored.toReversed())).toStrictEqual([]);
  });

  it('reports refs missing from the target', () => {
    expect(
      findMirrorMismatches(upstream, [{ name: `${MIRROR_PREFIX}master`, sha: 'aaa' }]),
    ).toStrictEqual(['upstream/claude/x: not mirrored', 'upstream/stores/apple: not mirrored']);
  });

  it('reports refs whose sha differs', () => {
    expect(
      findMirrorMismatches(upstream, [
        { name: `${MIRROR_PREFIX}master`, sha: 'aaa' },
        { name: `${MIRROR_PREFIX}stores/apple`, sha: 'outdated' },
        { name: `${MIRROR_PREFIX}claude/x`, sha: 'ccc' },
      ]),
    ).toStrictEqual(['upstream/stores/apple: differs']);
  });

  it('does not accept an unprefixed target ref as a mirror of an upstream one', () => {
    expect(
      findMirrorMismatches([{ name: 'main', sha: 'aaa' }], [{ name: 'main', sha: 'aaa' }]),
    ).toStrictEqual(['upstream/main: not mirrored']);
  });
});
