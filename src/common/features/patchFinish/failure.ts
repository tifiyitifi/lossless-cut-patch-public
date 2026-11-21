/**
Why one file of a finish job could not be moved or deleted (pure, fork-owned).

The executor reports the raw reason (`errorCode`, e.g. `EPERM`, or the exception message). The
dialog turns it into advice: a code alone ("EPERM") tells the user nothing about what to do, and
a stopped job is only useful if it says how to make the next attempt succeed.
*/
export type PatchFinishFailureKind =
  /** Another program (this app's own player included) holds the file open. */
  | 'locked'
  /** The file system refused the operation (read-only, no rights, a protected folder). */
  | 'permission'
  /** The file is no longer where the job expected it. */
  | 'missing'
  /** The target volume is full. */
  | 'no-space'
  /** The target is on another volume (should not reach the user: the executor copies instead). */
  | 'other-volume'
  /** Anything else: the raw reason is shown as it is. */
  | 'unknown';

export function classifyFinishFailureReason(reason: string): PatchFinishFailureKind {
  // The executor stores `errorCode` or the message, so compare the whole value - not a substring,
  // or a message that happens to mention a code would be misclassified.
  const code = reason.trim().toUpperCase();
  if (code === 'EBUSY' || code === 'EAGAIN' || code === 'ETXTBSY') return 'locked';
  if (code === 'EPERM' || code === 'EACCES' || code === 'EROFS') return 'permission';
  if (code === 'ENOENT' || code === 'ENOTDIR') return 'missing';
  if (code === 'ENOSPC' || code === 'EDQUOT') return 'no-space';
  if (code === 'EXDEV') return 'other-volume';
  return 'unknown';
}
