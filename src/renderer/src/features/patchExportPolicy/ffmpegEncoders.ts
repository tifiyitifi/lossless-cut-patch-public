/**
The ffmpeg encoder list seen by the renderer (fork-owned).

The join repair pins `libx264`, but a custom or trimmed ffmpeg build may not have it. The main
process probes `ffmpeg -encoders` once per binary (see `main/features/patchExport/ffmpegEncoders`),
so this module only turns the IPC answer into a cached promise: every segment of an export would
otherwise ask again. `undefined` means the probe failed, and the caller keeps the pinned encoder.
*/
let cached: Promise<string[] | undefined> | undefined;

// eslint-disable-next-line import/prefer-default-export
export function getFfmpegEncoders() {
  cached ??= window.electron.patchGetFfmpegEncoders().catch(() => undefined);
  return cached;
}
