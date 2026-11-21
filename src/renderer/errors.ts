export class DirectoryAccessDeclinedError extends Error {
  constructor() {
    super();
    this.name = 'DirectoryAccessDeclinedError';
  }
}

export class UnsupportedFileError extends Error {
  constructor(message: string, opts?: ErrorOptions) {
    super(message, opts);
    this.name = 'UnsupportedFileError';
  }
}

export class UserFacingError extends Error {
  // patch: keep the underlying failure (e.g. the ffmpeg error a check replaced with a readable
  // message) reachable for the error report.
  constructor(message: string, opts?: ErrorOptions) {
    super(message, opts);
    this.name = 'UserFacingError';
  }
}
