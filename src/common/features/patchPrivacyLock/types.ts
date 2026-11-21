/**
The privacy lock of the work-folder history (fork-owned).

This lock is not a security feature. It only keeps the list of earlier work folders out of sight
until the password is entered, and it records the few events that tell the owner whether someone
else reset or unlocked it while the computer was lent out:

- the history file itself, the videos and the settings stay readable on disk;
- the password is stored as a salted scrypt hash, never in clear text;
- deleting the password file is treated as "reset it to the default password", not as "turn the
  lock off", so the history never simply becomes visible by deleting a file.

The mode decides when the history locks automatically. It never decides to unlock: unlocking always
needs the password.
*/

export const patchHistoryLockFileName = 'patch-history-lock.json';

/**
The password the lock starts with, and the one a deleted password file is restored to.

It is deliberately public: the lock only protects against a casual look. The settings point this
out and the event log records every reset, so the owner can still tell that someone did it.
*/
export const patchHistoryLockDefaultPassword = '123456';

/** How many password events the settings keep (newest first). */
export const patchHistoryLockEventLimit = 10;

/** Default idle time before the history locks again, in minutes. */
export const patchHistoryLockDefaultIdleMinutes = 10;

/** Upper bound of the configurable idle time, in minutes. */
export const patchHistoryLockMaxIdleMinutes = 240;

/** The settings clamp the idle time to at least one minute when the idle mode is chosen. */
export const patchHistoryLockMinIdleMinutes = 1;

/** Longest password accepted (the hash can take any length; this only stops absurd input). */
export const patchHistoryPasswordMaxLength = 200;

/** When the work-folder history locks itself. It can never unlock. */
export type PatchHistoryLockMode = 'manual' | 'startup' | 'idle';

/**
The password file (scrypt, version 1).

`defaultPassword` is set while the password is still the built-in `123456`, so the settings can
warn about it. It is not a security signal: the default is public.
*/
export interface PatchHistoryPasswordRecord {
  version: 1;
  algorithm: 'scrypt';
  /** Random salt, base64. */
  salt: string;
  /** scrypt output, base64. */
  hash: string;
  /** Bytes of the scrypt output (the same on verification). */
  keyLength: number;
  /** Unix milliseconds. */
  createdAt: number;
  /** Set while the password is still `patchHistoryLockDefaultPassword`. */
  defaultPassword?: true;
}

export type PatchHistoryLockEventType = 'created' | 'reset' | 'changed' | 'unlocked';

/** One entry of the settings' "recent password events" list. */
export interface PatchHistoryLockEvent {
  /** Unix milliseconds; for a reset this is when the app noticed the missing file. */
  at: number;
  type: PatchHistoryLockEventType;
}

export interface PatchHistoryLockStatus {
  /** A password record is available (on disk or, after a write failure, in memory). */
  enabled: boolean;
  /** The history is shown in full for this app run. */
  unlocked: boolean;
  /** The password file the app uses (or would use). Shown in the settings for the reset hint. */
  filePath: string;
  /** The password is still the built-in default. */
  isDefaultPassword: boolean;
  /** Newest first, at most `patchHistoryLockEventLimit`. */
  events: PatchHistoryLockEvent[];
  /** The file could not be written; the app keeps working with the in-memory record. */
  writeFailed?: boolean;
}

export type PatchHistoryLockReason =
  | 'wrong-password'
  | 'unreadable'
  | 'unavailable'
  | 'empty'
  | 'too-long'
  | 'write-failed'
  | 'exists';

export type PatchHistoryLockResult =
  | { ok: true; status: PatchHistoryLockStatus }
  /**
  A failed action may still carry the status, when the failure itself changed what the settings must
  show (a write failure sets `writeFailed`). The renderer only updates its cached status from this.
  */
  | { ok: false; reason: PatchHistoryLockReason; status?: PatchHistoryLockStatus };
