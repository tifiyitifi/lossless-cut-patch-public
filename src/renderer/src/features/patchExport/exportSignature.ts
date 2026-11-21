const { createHash } = window.require('node:crypto') as typeof import('node:crypto');

/**
Fingerprint of everything that decides the bytes of a cut result (fork-owned).

The source file's stat covers edits of the video; the caller adds the export settings that
change the output (format, streams, keyframe mode, smart cut, ...). Two exports with the same
fingerprint produce the same result, so the previous file can be reused.
*/
export default function hashExportSignature(input: Record<string, unknown>) {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex');
}
