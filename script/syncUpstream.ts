// Mirror the whole upstream repository into a target repository given on the command line: every
// upstream branch and tag, pushed under the `upstream/` namespace. The target is never assumed, so
// no private fork address is stored in the repo. Fork-only, see AGENTS.md -> "Git / fork".
//
// The namespace is what keeps the target's own branches (`main`) and its release tags untouched, and
// what stops upstream's CI from running there: its workflows trigger on `master` and on plain
// `v*` tags, which a namespaced ref cannot match.
import { execa } from 'execa';

import {
  buildBranchPushRefspecs,
  buildTagPushRefspecs,
  findMirrorMismatches,
  parseLsRemoteHeads,
  parseLsRemoteTagRefs,
  parseTargetRepo,
} from './upstreamMirror.ts';

const UPSTREAM = 'upstream';

const USAGE = [
  'Usage: node script/syncUpstream.ts <target-repo>',
  '',
  '<target-repo>  where to mirror to: a remote name (e.g. origin) or a git URL.',
  '               Asked for on every run so no private address is committed.',
  '',
  'Every upstream branch and tag is pushed under the upstream/ namespace (upstream/master,',
  'upstream/v3.70.2), so the target\'s own branches and tags are never overwritten.',
].join('\n');

// `reject: false` keeps git's own error output visible instead of replacing it with a stack trace.
const git = (args: string[]) => execa('git', args, { reject: false });
const gitInherit = (args: string[]) => execa('git', args, { reject: false, stdio: 'inherit' });

async function main(targetRepo: string) {
  const fetchResult = await gitInherit(['fetch', UPSTREAM, '--prune', '--tags']);
  if (fetchResult.exitCode !== 0) {
    console.error(`\nCould not fetch ${UPSTREAM}. Fix the remote first.`);
    return false;
  }

  const refs = await git(['for-each-ref', '--format=%(refname)', `refs/remotes/${UPSTREAM}`]);
  const refspecs = buildBranchPushRefspecs(refs.stdout.split('\n'));
  // An empty list would make `git push <target>` fall back to `push.default` and push the checked-out
  // branch - a fork branch - instead of mirroring nothing.
  if (refspecs.length === 0) {
    console.error(`\nNo ${UPSTREAM} branches to mirror. Is ${UPSTREAM} the right remote?`);
    return false;
  }

  console.log(`\nMirroring ${refspecs.length} ${UPSTREAM} branches to ${targetRepo} ...`);
  const pushResult = await gitInherit(['push', targetRepo, ...refspecs]);
  if (pushResult.exitCode !== 0) {
    // Never force: a rejection means upstream rewrote history, and that is the user's call.
    console.error(
      `\nPushing branches to ${targetRepo} failed. If upstream rewrote history, resolve it manually.`,
    );
    return false;
  }

  // Tags are read from the upstream remote rather than from the local tag list: the local list also
  // holds the fork's own tags, which do not belong under the `upstream/` namespace.
  const upstreamTagsResult = await git(['ls-remote', '--tags', UPSTREAM]);
  if (upstreamTagsResult.exitCode !== 0) {
    console.error(`\nCould not list ${UPSTREAM} tags.`);
    return false;
  }
  const upstreamTags = parseLsRemoteTagRefs(upstreamTagsResult.stdout);
  const tagRefspecs = buildTagPushRefspecs(upstreamTags.map((tag) => tag.name));

  if (tagRefspecs.length > 0) {
    console.log(`\nMirroring ${tagRefspecs.length} ${UPSTREAM} tags to ${targetRepo} ...`);
    const tagResult = await gitInherit(['push', targetRepo, ...tagRefspecs]);
    if (tagResult.exitCode !== 0) {
      console.error(
        `\nPushing tags to ${targetRepo} failed. If upstream retagged a release, resolve it manually.`,
      );
      return false;
    }
  }

  const upstreamBranches = await git([
    'for-each-ref',
    '--format=%(refname:lstrip=3) %(objectname)',
    `refs/remotes/${UPSTREAM}`,
  ]);
  const expectedBranches = upstreamBranches.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('HEAD '))
    .map((line) => {
      const [name = '', sha = ''] = line.split(' ', 2);
      return { name, sha };
    });

  const targetHeads = await git(['ls-remote', '--heads', targetRepo]);
  const targetTags = await git(['ls-remote', '--tags', targetRepo]);

  const mismatches = [
    ...findMirrorMismatches(expectedBranches, parseLsRemoteHeads(targetHeads.stdout)),
    ...findMirrorMismatches(upstreamTags, parseLsRemoteTagRefs(targetTags.stdout)),
  ];
  if (mismatches.length > 0) {
    console.error(`\n${targetRepo} does not match ${UPSTREAM}:\n${mismatches.join('\n')}`);
    return false;
  }

  console.log(
    `\n${targetRepo} mirrors all ${expectedBranches.length} ${UPSTREAM} branches and `
    + `${upstreamTags.length} tags under the upstream/ namespace.`,
  );
  return true;
}

const targetRepo = parseTargetRepo(process.argv.slice(2));

if (targetRepo === undefined) {
  console.error(USAGE);
  process.exitCode = 1;
} else {
  process.exitCode = (await main(targetRepo)) ? 0 : 1;
}
