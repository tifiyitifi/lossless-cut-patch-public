import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const checker = join(import.meta.dirname, 'check-local-paths.ps1');
const backslash = String.fromCodePoint(92);

function findPowerShell(): string | undefined {
  if (process.platform !== 'win32') return undefined;
  for (const name of ['powershell', 'pwsh']) {
    const result = spawnSync(name, ['-NoProfile', '-Command', 'exit 0'], { stdio: 'ignore' });
    if (result.status === 0) return name;
  }
  return undefined;
}

const powershell = findPowerShell();

// Build path samples at run time: this file must not contain the shapes the
// checker rejects, or the gate would flag its own test.
function drive(letter: string, ...parts: string[]): string {
  return `${letter}:${backslash}${parts.join(backslash)}`;
}

function runGit(repo: string, args: string[]): string {
  const result = spawnSync('git', args, { cwd: repo, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  return result.stdout.trim();
}

function createRepo(): string {
  const repo = mkdtempSync(join(tmpdir(), 'llc-local-gate-'));
  runGit(repo, ['init', '-q']);
  runGit(repo, ['config', 'user.email', 'test@example.com']);
  runGit(repo, ['config', 'user.name', 'test']);
  runGit(repo, ['config', 'commit.gpgsign', 'false']);
  runGit(repo, ['config', 'core.autocrlf', 'false']);
  return repo;
}

interface CheckResult {
  status: number | null;
  output: string;
}

function runCheck(
  repo: string,
  args: string[] = [],
  env: Record<string, string> = {},
): CheckResult {
  if (!powershell) throw new Error('PowerShell is required');
  const result = spawnSync(
    powershell,
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', checker, '-Root', repo, ...args],
    { cwd: repo, encoding: 'utf8', env: { ...process.env, ...env } },
  );
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

function withRepo(test: (repo: string) => void): void {
  const repo = createRepo();
  try {
    test(repo);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
}

describe.skipIf(!powershell)('check-local-paths', () => {
  it('passes a staged stand-in path and warns about the missing deny list', () => {
    withRepo((repo) => {
      writeFileSync(join(repo, 'note.md'), `clip at ${drive('C', 'work', 'inbox', 'a.mp4')}\n`);
      runGit(repo, ['add', 'note.md']);

      const { status, output } = runCheck(repo);

      expect(status).toBe(0);
      expect(output).toContain('deny list not found');
    });
  }, 30_000);

  it('rejects a staged real-looking local path', () => {
    withRepo((repo) => {
      writeFileSync(
        join(repo, 'note.md'),
        `clip at ${drive('C', 'Users', 'someone', 'Videos', 'a.mp4')}\n`,
      );
      runGit(repo, ['add', 'note.md']);

      const { status, output } = runCheck(repo);

      expect(status).toBe(1);
      expect(output).toContain('local path');
    });
  }, 30_000);

  it('rejects this machine profile even when it sits under a stand-in root', () => {
    withRepo((repo) => {
      const profile = drive('C', 'work', 'gate-profile');
      writeFileSync(
        join(repo, 'note.md'),
        `clip at ${profile}${backslash}videos${backslash}a.mp4\n`,
      );
      runGit(repo, ['add', 'note.md']);

      const { status, output } = runCheck(repo, [], { USERPROFILE: profile, HOME: profile });

      expect(status).toBe(1);
      expect(output).toContain('local machine path');
    });
  }, 30_000);

  it('rejects a private term from the deny list', () => {
    withRepo((repo) => {
      mkdirSync(join(repo, 'ai-tmp', 'local_text'), { recursive: true });
      writeFileSync(join(repo, 'ai-tmp', 'local_text', 'deny-list.txt'), 'SecretProject\n');
      writeFileSync(join(repo, 'note.md'), 'the SecretProject folder\n');
      runGit(repo, ['add', 'note.md']);

      const { status, output } = runCheck(repo);

      expect(status).toBe(1);
      expect(output).toContain('private term');
    });
  }, 30_000);

  it('rejects a local path in the commit message', () => {
    withRepo((repo) => {
      writeFileSync(
        join(repo, '.git', 'COMMIT_EDITMSG'),
        `subject ${drive('C', 'Users', 'someone', 'a.mp4')}\n`,
      );

      const { status, output } = runCheck(repo, ['-Message']);

      expect(status).toBe(1);
      expect(output).toContain('the commit message');
    });
  }, 30_000);

  it('checks the exact push range that pre-push reports', () => {
    withRepo((repo) => {
      writeFileSync(join(repo, 'a.md'), 'one\n');
      runGit(repo, ['add', 'a.md']);
      runGit(repo, ['commit', '-q', '-m', 'one']);
      const first = runGit(repo, ['rev-parse', 'HEAD']);

      writeFileSync(
        join(repo, 'b.md'),
        `two ${drive('C', 'Users', 'someone', 'b.mp4')}\n`,
      );
      runGit(repo, ['add', 'b.md']);
      runGit(repo, ['commit', '-q', '-m', 'two']);
      const second = runGit(repo, ['rev-parse', 'HEAD']);

      const { status, output } = runCheck(repo, ['-Pushed', '-Range', `${first}..${second}`]);

      expect(status).toBe(1);
      expect(output).toContain('local path');
    });
  }, 30_000);

  it('checks earlier commits of a new branch, not only the last one', () => {
    withRepo((repo) => {
      writeFileSync(join(repo, 'base.md'), 'base\n');
      runGit(repo, ['add', 'base.md']);
      runGit(repo, ['commit', '-q', '-m', 'base']);

      runGit(repo, ['checkout', '-q', '-b', 'feature']);
      writeFileSync(join(repo, 'leak.md'), `leak ${drive('C', 'Users', 'someone', 'a.mp4')}\n`);
      runGit(repo, ['add', 'leak.md']);
      runGit(repo, ['commit', '-q', '-m', 'leak']);

      writeFileSync(join(repo, 'clean.md'), 'clean\n');
      runGit(repo, ['add', 'clean.md']);
      runGit(repo, ['commit', '-q', '-m', 'clean']);

      const { status, output } = runCheck(repo, ['-Pushed']);

      expect(status).toBe(1);
      expect(output).toContain('local path');
    });
  }, 30_000);

  it('warns instead of failing for a local path that is already committed', () => {
    withRepo((repo) => {
      writeFileSync(join(repo, 'a.md'), `one ${drive('D', 'personal', 'a.mp4')}\n`);
      runGit(repo, ['add', 'a.md']);
      runGit(repo, ['commit', '-q', '-m', 'one']);

      const { status, output } = runCheck(repo, ['-All']);

      expect(status).toBe(0);
      expect(output).toContain('warning:');
    });
  }, 30_000);

  it('rejects a local project file by name', () => {
    withRepo((repo) => {
      writeFileSync(join(repo, 'a.llc'), 'x\n');
      runGit(repo, ['add', 'a.llc']);

      const { status, output } = runCheck(repo);

      expect(status).toBe(1);
      expect(output).toContain('local data in a file name');
    });
  }, 30_000);
});
