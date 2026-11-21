// eslint-disable-next-line import-js/no-extraneous-dependencies
import { describe, expect, it } from 'vitest';

import { isPatchFinishBusyError, isPatchFinishFilesInUseError, patchFinishBusyMarker, patchFinishFilesInUseMarker } from './busy.js';

describe('isPatchFinishBusyError', () => {
  it('recognizes the marker the main process sends', () => {
    expect(isPatchFinishBusyError(new Error(patchFinishBusyMarker))).toBe(true);
    expect(isPatchFinishBusyError(new Error('A finish job is already running.'))).toBe(false);
  });

  it('recognizes the marker after Electron wrapped the message', () => {
    // ipcRenderer.invoke rejects with `Error invoking remote method '…': Error: <message>`.
    expect(isPatchFinishBusyError(new Error(`Error invoking remote method '__electron_rpc__': Error: ${patchFinishBusyMarker}`))).toBe(true);
  });

  it('ignores anything that is not an error message', () => {
    expect(isPatchFinishBusyError(undefined)).toBe(false);
    expect(isPatchFinishBusyError({ code: patchFinishBusyMarker })).toBe(false);
  });
});

describe('isPatchFinishFilesInUseError', () => {
  it('recognizes the marker the main process sends, wrapped or not', () => {
    expect(isPatchFinishFilesInUseError(new Error(patchFinishFilesInUseMarker))).toBe(true);
    expect(isPatchFinishFilesInUseError(new Error(`Error invoking remote method '__electron_rpc__': Error: ${patchFinishFilesInUseMarker}`))).toBe(true);
  });

  it('does not confuse the two refusals', () => {
    expect(isPatchFinishFilesInUseError(new Error(patchFinishBusyMarker))).toBe(false);
    expect(isPatchFinishBusyError(new Error(patchFinishFilesInUseMarker))).toBe(false);
  });

  it('ignores anything that is not an error message', () => {
    expect(isPatchFinishFilesInUseError(undefined)).toBe(false);
    expect(isPatchFinishFilesInUseError({ code: patchFinishFilesInUseMarker })).toBe(false);
  });
});
