// Fork-only: the update check talks to this fork's own GitHub releases (see `forkReleaseOwner` in
// common/constants.ts). These types are the whole vocabulary between the main process (which does
// the network call), the pure classifier and the dialog; keeping them in `common` lets both sides
// agree without either one importing the other.

/** Why a check could not produce an answer. */
export type UpdateFailure =
  /** The request never reached GitHub (DNS, proxy, TLS, offline). */
  | 'network'
  /** GitHub accepted the connection but answered too late. */
  | 'timeout'
  /** GitHub answered with a non-2xx status (403 rate limit, 5xx outage, ...). */
  | 'http'
  /** The running build or the published tag is not a version this build can compare. */
  | 'malformedTag'
  /** The release payload was not the JSON we expect. */
  | 'malformedRelease'
  /** A release exists, but it ships nothing this build could install. */
  | 'noAsset';

export interface UpdateAsset {
  name: string;
  url: string;
  /** Byte count as advertised by the release, or 0 when it carried none. */
  size: number;
}

/** A published release, narrowed to what the check needs. */
export interface LatestRelease {
  tag: string;
  /** [tag] without its leading `v`. */
  version: string;
  /** The release page a user can open to download by hand. */
  pageUrl: string;
  notes: string;
  assets: UpdateAsset[];
}

/** The outcome of one check. */
export type UpdateCheckResult =
  /** The fork's release repository is not configured in this build. */
  | { status: 'notConfigured' }
  /** The repository answered, but has never published a release (an empty repository answers 404). */
  | { status: 'noRelease' }
  /** Nothing newer than [version] was published. */
  | { status: 'upToDate'; version: string }
  | {
    status: 'available';
    version: string;
    tag: string;
    pageUrl: string;
    notes: string;
    /** The Windows x64 archive an update would install. */
    asset: UpdateAsset;
    // The `SHA256SUMS.txt` of the same release. Absent when the release publishes none, which is
    // reason enough to keep the manual download path and refuse the automatic one.
    checksum?: UpdateAsset;
  }
  | { status: 'failed'; reason: UpdateFailure; detail?: string };

/** Why a download produced no usable package. */
export type DownloadFailure =
  /** GitHub answered, but not with the package (404, 403, 429, 5xx). */
  | 'http'
  /** The host could not be reached at all. */
  | 'network'
  /** The release names the asset in a way that is not a plain file name. */
  | 'name'
  /** The bytes stopped short of the advertised size, or exceeded it. */
  | 'size'
  /** The digest does not match the published checksum. */
  | 'checksum'
  /** The bytes arrived but the file could not be written (no space, no permission). */
  | 'storage'
  /** The caller cancelled on purpose. Never shown as a problem. */
  | 'cancelled';
