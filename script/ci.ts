/* eslint-disable no-console */
// Local equivalent of .github/workflows/test.yml, for when GitHub Actions is
// unavailable (or before pushing). `yarn install --immutable` is assumed done.
import { execa } from 'execa';

const yarn = (args: string[]) => execa('yarn', args, { stdio: 'inherit' });

const steps: string[][] = [
  ['dedupe', '--check'],
  ['test', 'run'],
  ['tsc'],
  ['lint'],
  ['build'],
  ['scan-i18n'],
  ['generate-docs'],
];

for (const args of steps) {
  console.log(`\n>>> yarn ${args.join(' ')}`);
  await yarn(args);
}

// test.yml asserts `git diff --quiet HEAD` and then throws the changes away with
// `git reset --hard`. Here only the generated files are checked, so unrelated work
// in progress does not fail the run, and nothing is ever discarded.
const generatedFiles = ['docs/generated/types.md', 'locales/en/translation.json'];
const status = await execa('git', ['status', '--porcelain', '--', ...generatedFiles]);
const stale = status.stdout.trim();
if (stale !== '') {
  console.error(`\nGenerated files are out of date:\n${stale}\nCommit the regenerated files.`);
  process.exitCode = 1;
} else {
  await yarn(['check-licenses']);
  await yarn(['generate-licenses']); // leaves an untracked licenses.txt, same as CI

  console.log('\nLocal CI passed.');
}
