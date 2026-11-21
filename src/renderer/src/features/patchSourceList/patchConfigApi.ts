const remote = window.require('@electron/remote');
const { patchConfig } = remote.require('./index.js');

/**
Access to the patch settings store from the renderer (fork-owned).

The store lives in the main process (`main/features/patch/patchConfig.ts`); the renderer only reads
and writes single keys through it. The source list keeps its own copy so the slice stays deletable
as a whole (same pattern as `features/patchNotice`).
*/
export default patchConfig;
