/**
The volume a directory lives on (pure, fork-owned).

Free space belongs to a volume, not to a directory. Two writes into different folders of one
volume have to be added up, so the folders must be mapped to the same key. `node:path`'s root is
not enough on Windows: `C:/a` and `c:/a` (or `C:\a`) are the same volume but three different
roots. The key therefore normalizes the separators, stops after the drive or UNC share, and
lowers the case when the platform ignores it.
*/
// eslint-disable-next-line import/prefer-default-export
export function getPatchVolumeKey(dir: string, { caseInsensitive }: { caseInsensitive: boolean }) {
  const unified = dir.replaceAll('\\', '/');
  const drive = /^[a-zA-Z]:/.exec(unified)?.[0];
  // A UNC share (`//server/share/...`) is one volume. On POSIX a leading `//` is not a share, so it
  // only counts where the file system is case-insensitive (Windows).
  const unc = caseInsensitive ? /^\/\/[^/]+\/[^/]+/.exec(unified)?.[0] : undefined;
  const root = drive ?? unc ?? (unified.startsWith('/') ? '/' : unified);
  return caseInsensitive ? root.toLowerCase() : root;
}
