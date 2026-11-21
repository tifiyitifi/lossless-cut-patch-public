/**
Cache for the ffmpeg encoder list, keyed by the ffmpeg binary (fork-owned, pure).

Kept free of electron/ffmpeg imports so it can be tested: the caller injects both the path getter
and the probe. One probe per binary is enough; a failed probe is cached too (a broken custom ffmpeg
would otherwise cost a process spawn every time a segment is cut).
*/
// eslint-disable-next-line import/prefer-default-export
export function createFfmpegEncoderCache({ getPath, probe }: {
  getPath: () => string;
  probe: () => Promise<string[] | undefined>;
}) {
  let cached: { path: string; encoders: Promise<string[] | undefined> } | undefined;
  return async () => {
    const path = getPath();
    if (cached?.path !== path) cached = { path, encoders: probe() };
    return cached.encoders;
  };
}
