// Pure helpers for script/syncUpstream.ts: the fork mirrors every upstream branch and tag into a
// target repository so that target holds a complete backup next to the fork branches. Fork-only,
// see AGENTS.md -> "Git / fork".
//
// Everything is pushed under the `upstream/` namespace: the target is a public repository that also
// holds the fork's own `main`, and upstream's workflows trigger on plain branch and tag names
// (`tags: ['v*']`, `branches: [master]`). A namespaced ref cannot match those patterns, so mirroring
// upstream can never start an upstream CI run on the target.

const UPSTREAM_REF_PREFIX = 'refs/remotes/upstream/';
const HEAD_REF = `${UPSTREAM_REF_PREFIX}HEAD`;

// Namespace every mirrored ref is pushed under, on both branches and tags.
export const MIRROR_PREFIX = 'upstream/';

// A branch or tag on one side of the mirror, identified by name and commit sha.
export interface MirroredBranch {
  name: string;
  sha: string;
}

// The target repository is entered on every run, so neither the script nor the docs have to store a
// private fork address. It is passed straight to git, so it can be a remote name (`origin`) or a URL.
export function parseTargetRepo(argv: readonly string[]): string | undefined {
  const [targetRepo] = argv;
  return targetRepo === undefined || targetRepo === '' ? undefined : targetRepo;
}

// Build the refspecs that push every `upstream` remote-tracking branch into the target's
// `upstream/<name>` namespace. `refs/remotes/upstream/HEAD` is a symbolic alias of the default
// branch and must be skipped: pushing it would create a branch literally named `HEAD`.
export function buildBranchPushRefspecs(remoteRefs: readonly string[]): string[] {
  return [...remoteRefs]
    .filter((ref) => ref.startsWith(UPSTREAM_REF_PREFIX) && ref !== HEAD_REF)
    .toSorted((a, b) => a.localeCompare(b))
    .map((ref) => {
      const name = ref.slice(UPSTREAM_REF_PREFIX.length);
      return `${ref}:refs/heads/${MIRROR_PREFIX}${name}`;
    });
}

// Build the refspecs that push upstream tags into the target's `upstream/<tag>` namespace.
//
// Only tags that exist on the upstream remote are mirrored, so the fork's own tags (such as
// `pre-upstream-merge`) never end up under a namespace that says they came from upstream.
export function buildTagPushRefspecs(tagNames: readonly string[]): string[] {
  return [...new Set(tagNames.map((tag) => tag.trim()))]
    .filter((tag) => tag !== '' && !tag.endsWith('^{}'))
    .toSorted((a, b) => a.localeCompare(b))
    .map((tag) => `refs/tags/${tag}:refs/tags/${MIRROR_PREFIX}${tag}`);
}

// Parse `git ls-remote --heads <remote>` output into branches with `refs/heads/` stripped.
export function parseLsRemoteHeads(stdout: string): MirroredBranch[] {
  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .map((line) => {
      const [sha = '', ref = ''] = line.split('\t', 2);
      return { name: ref.replace('refs/heads/', ''), sha };
    });
}

// Parse `git ls-remote --tags <remote>` output into tag refs.
//
// An annotated tag is listed twice: once as the tag object and once as `<tag>^{}` for the commit it
// points at. Only the tag object is pushed (the peeled line is derived by git), so the `^{}` entries
// are dropped here.
export function parseLsRemoteTagRefs(stdout: string): MirroredBranch[] {
  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .map((line) => {
      const [sha = '', ref = ''] = line.split('\t', 2);
      return { name: ref.replace('refs/tags/', ''), sha };
    })
    .filter((ref) => ref.name !== '' && !ref.name.endsWith('^{}'));
}

// The names only, for the push refspecs.
export function parseLsRemoteTags(stdout: string): string[] {
  return parseLsRemoteTagRefs(stdout).map((ref) => ref.name);
}

// Compare what upstream has against what the target has. Returns one message per ref that is
// missing or at a different commit, sorted by name, so a mirror can be verified after pushing.
//
// `upstreamRefs` carry the plain upstream name (`master`, `v3.70.2`); `targetRefs` carry the
// namespaced one (`upstream/master`, `upstream/v3.70.2`). An unprefixed target ref is never accepted
// as a mirror of an upstream one: that would be the fork's own branch of the same name.
export function findMirrorMismatches(
  upstreamRefs: readonly MirroredBranch[],
  targetRefs: readonly MirroredBranch[],
): string[] {
  const targetShas = new Map(targetRefs.map((ref) => [ref.name, ref.sha]));
  return [...upstreamRefs]
    .toSorted((a, b) => a.name.localeCompare(b.name))
    .flatMap((ref) => {
      const targetSha = targetShas.get(`${MIRROR_PREFIX}${ref.name}`);
      if (targetSha === ref.sha) return [];
      return [`${MIRROR_PREFIX}${ref.name}: ${targetSha === undefined ? 'not mirrored' : 'differs'}`];
    });
}
