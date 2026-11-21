/** Video/audio file extensions recognized by patch mode when scanning a work directory. */
export const patchMediaExtensions: readonly string[] = [
  'avi', 'mp4', 'mkv', 'flv', 'mov', 'wmv', 'mts', 'm2ts', 'ts', 'vob', 'webm', 'mpeg', 'mpg', 'rmvb', 'rm', '3gp', 'm4v', 'ogv',
  // audio
  'mp3', 'aac', 'm4a', 'flac', 'wav', 'ogg', 'opus', 'wma', 'mka', 'weba', 'oga', 'aif', 'aiff',
];

const extensionSet = new Set(patchMediaExtensions);

/** The file name part of a path (both separators, so it also works on foreign paths). */
export function getPathBaseName(path: string): string {
  const index = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return index === -1 ? path : path.slice(index + 1);
}

/** Case-insensitive check whether a file name has a supported media extension. */
export function hasPatchMediaExtension(fileName: string): boolean {
  const dot = fileName.lastIndexOf('.');
  if (dot === -1) return false;
  return extensionSet.has(fileName.slice(dot + 1).toLowerCase());
}
