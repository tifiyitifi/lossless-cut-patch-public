/** A media file discovered while scanning a work directory. */
export interface PatchVideoFile {
  /** File name only. */
  name: string;
  /** Absolute path. */
  path: string;
  /** Size in bytes (0 when it could not be determined). */
  size: number;
}
