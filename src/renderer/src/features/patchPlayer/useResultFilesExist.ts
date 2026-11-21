import { useCallback, useEffect, useMemo, useState } from 'react';

const emptyMissing: ReadonlySet<string> = new Set<string>();

/** The paths among `paths` that are gone from disk (main process, one `exists` each). */
async function readMissingPaths(paths: readonly string[]) {
  try {
    const { missing } = await window.electron.patchCheckResultFilesExist({ paths });
    return missing;
  } catch (err) {
    // A failed check must not gray out the playlist: the rows still work if the files are there.
    console.error('Failed to check the cut results', err);
    return undefined;
  }
}

/**
Which playlist entries are gone from disk (fork-owned).

A results window shows a snapshot of the results. Another window (another instance) may end the
job meanwhile and move or rename them, so the playlist can list files that no longer exist. When
the window gets focus - the moment the user is about to click a row - the paths are checked again
and the rows are greyed out instead of failing to open.

The caller passes every row it shows (the playlist and the "other" section, see
`getShownResultPaths`), so both are checked.
*/
export default function useResultFilesExist({ enabled, paths }: {
  /** Only the player / merged windows; the cutting window has its own batch list. */
  enabled: boolean;
  paths: readonly string[];
}) {
  const [missing, setMissing] = useState<ReadonlySet<string>>(() => new Set<string>());

  // The array identity changes with every render of the playlist; the joined string does not, so the
  // effects below only run when the playlist itself changes. A NUL cannot appear in a file name on
  // any system the app runs on, so it is a safe separator (a path may contain a newline on Linux).
  const pathsKey = paths.join('\0');
  const stablePaths = useMemo(() => (pathsKey === '' ? [] : pathsKey.split('\0')), [pathsKey]);

  // Nothing to look at: the value returned below is empty anyway, so no state is touched.
  const active = enabled && stablePaths.length > 0;

  const apply = useCallback((gone: readonly string[] | undefined) => {
    // `undefined` is a failed check: keep what is shown rather than graying out everything.
    if (gone == null) return;
    const next = new Set(gone);
    setMissing((previous) => (
      previous.size === next.size && [...next].every((path) => previous.has(path)) ? previous : next
    ));
  }, []);

  useEffect(() => {
    if (!active) return undefined;
    let cancelled = false;
    (async () => {
      const gone = await readMissingPaths(stablePaths);
      if (!cancelled) apply(gone);
    })();
    return () => { cancelled = true; };
  }, [active, apply, stablePaths]);

  useEffect(() => {
    if (!active) return undefined;
    // A focus check of an old playlist must not overwrite the result of a newer one: the export that
    // replaced the playlist also changes `stablePaths`, which re-runs this effect and cancels it.
    let cancelled = false;
    const onFocus = () => {
      (async () => {
        const gone = await readMissingPaths(stablePaths);
        if (!cancelled) apply(gone);
      })();
    };
    window.addEventListener('focus', onFocus);
    return () => {
      cancelled = true;
      window.removeEventListener('focus', onFocus);
    };
  }, [active, apply, stablePaths]);

  return active ? missing : emptyMissing;
}
