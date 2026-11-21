// Fork-only: pure decisions for installing a downloaded update in place.
//
// Windows cannot replace a running executable, so the app never touches its own files: it hands the
// package to a small PowerShell updater that outlives it (see `script/win/patch_update.ps1`), which
// is why everything that can be checked is checked *before* the app gives up its window. A failed
// hand-over leaves the user at a desktop with no app and no explanation, so each blocker below is
// something the user can act on or that makes the manual download the only honest answer.

/** The updater script, shipped next to the executable by `build.extraFiles`. */
export const patchUpdateScriptName = 'patch_update.ps1';

/** Folder under the app's userData where the package, the script copy and the record live. */
export const patchUpdatesDirName = 'updates';

export type UpdateInstallBlocker =
  /** A development build: there are no program files to replace. */
  | 'notPackaged'
  /** A Store build is updated by the Store, not by us. */
  | 'storeBuild'
  /** The release published no `SHA256SUMS.txt`, so the package cannot be verified. */
  | 'noChecksum'
  /** A path `cmd.exe` would expand or re-parse (`%`, `!`, `&`, parentheses, ...). */
  | 'unsafePath'
  /** The installation folder refuses a write (a portable build extracted into Program Files). */
  | 'installDirNotWritable'
  /** Not enough free space for the package and the unpacked build next to it. */
  | 'noFreeSpace';

export interface PortableUpdatePlan {
  kind: 'portable';
  /** The folder that holds the running executable; the updater swaps it. */
  installDir: string;
  /** The verified package. */
  packagePath: string;
  /** The copy of the updater script the running build ships. */
  scriptPath: string;
  /** Where the updater writes its transcript. */
  logPath: string;
  /** Folder the download and the hand-off record live in. */
  updatesDir: string;
}

export interface BlockedUpdate {
  kind: 'blocked';
  blocker: UpdateInstallBlocker;
}

export type UpdateInstallPlan = PortableUpdatePlan | BlockedUpdate;

// Characters `cmd.exe` re-interprets inside a command line: `%VAR%` expands, `!` expands under
// delayed expansion, `&`/`|`/`<`/`>`/`( )` separate or group commands, `^` is the escape character
// and `"` toggles quoting. The hand-off goes through `cmd.exe /c start` (a plain detached
// `powershell.exe` exits without running a line on Windows), so a folder name containing one of
// these would change the meaning of the command.
const cmdUnsafePathPattern = /[%!^&|<>()"]/;

export function isCmdSafePath(path: string): boolean {
  return path !== '' && !cmdUnsafePathPattern.test(path) && !path.includes('\n') && !path.includes('\r');
}

/** A package file name taken from a release asset, or undefined when it is not a plain file name. */
export function sanitizeAssetFileName(name: string): string | undefined {
  const trimmed = name.trim();
  if (!/^[\w.-]+$/.test(trimmed)) return undefined;
  if (trimmed === '.' || trimmed === '..') return undefined;
  return trimmed;
}

// How much room the swap needs: the package itself, the unpacked build next to it, and a margin.
//
// The unpacked build is about twice the compressed archive, which is what the factor stands for;
// the fixed margin covers the updater's log and a filesystem that needs slack.
export function estimateRequiredFreeBytes(packageSize: number): number {
  return Math.ceil(packageSize * 3) + 128 * 1024 * 1024;
}

// Decides whether a verified package can be applied in place.
//
// Checks run in the order that makes the report most useful: "this build cannot be updated at all"
// first, then "this release cannot be trusted", then "this machine cannot take it".
export function planPortableUpdate({
  isPackaged,
  windowsStore,
  checksumAvailable,
  installDir,
  packagePath,
  packageSize,
  freeBytes,
  canWriteInstallDir,
  scriptPath,
  updatesDir,
  logPath,
}: {
  isPackaged: boolean;
  windowsStore: boolean;
  checksumAvailable: boolean;
  installDir: string;
  packagePath: string;
  packageSize: number;
  freeBytes: number;
  canWriteInstallDir: boolean;
  scriptPath?: string | undefined;
  updatesDir: string;
  logPath: string;
}): UpdateInstallPlan {
  if (!isPackaged) return { kind: 'blocked', blocker: 'notPackaged' };
  if (windowsStore) return { kind: 'blocked', blocker: 'storeBuild' };
  if (!checksumAvailable) return { kind: 'blocked', blocker: 'noChecksum' };
  if (scriptPath === undefined || !isCmdSafePath(scriptPath)) return { kind: 'blocked', blocker: 'unsafePath' };

  if (!isCmdSafePath(installDir) || !isCmdSafePath(packagePath) || !isCmdSafePath(updatesDir) || !isCmdSafePath(logPath)) {
    return { kind: 'blocked', blocker: 'unsafePath' };
  }

  if (!canWriteInstallDir) return { kind: 'blocked', blocker: 'installDirNotWritable' };
  if (freeBytes < estimateRequiredFreeBytes(packageSize)) return { kind: 'blocked', blocker: 'noFreeSpace' };

  return { kind: 'portable', installDir, packagePath, scriptPath, logPath, updatesDir };
}

/** Console title of the updater window the hand-over opens. */
export const patchUpdaterTitle = 'LosslessCut-Patch update';

export interface UpdaterCommand {
  executable: string;
  args: string[];
}

// The command that hands the package to the updater and returns immediately.
//
// Routed through `cmd.exe /c start` rather than launching `powershell.exe` directly: a detached
// `powershell.exe` started from a GUI process gets no console and exits immediately without running
// the script (measured on Windows 11), which turned the hand-over into a silent no-op. `start`
// allocates a console for the script, so it runs and the user can watch it.
//
// Returns undefined when a path contains something `cmd.exe` would expand or re-parse: refusing is
// better than launching a command line whose meaning depends on a folder name.
export function buildUpdaterCommand({
  scriptPath,
  packagePath,
  installDir,
  logPath,
}: {
  scriptPath: string;
  packagePath: string;
  installDir: string;
  logPath: string;
}): UpdaterCommand | undefined {
  if (!isCmdSafePath(scriptPath) || !isCmdSafePath(packagePath) || !isCmdSafePath(logPath) || !isCmdSafePath(installDir)) {
    return undefined;
  }

  // The title argument is not decoration: `start` reads its first quoted token as the window title,
  // and an EMPTY token is dropped by the argument escaping, which made `start` take the script
  // interpreter itself as the title and never run it. A real title keeps the command unambiguous.
  return {
    executable: 'cmd.exe',
    args: [
      '/c',
      'start',
      patchUpdaterTitle,
      'powershell.exe',
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      scriptPath,
      '-PackagePath',
      packagePath,
      '-InstallDir',
      installDir,
      '-LogPath',
      logPath,
      '-NonInteractive',
    ],
  };
}
