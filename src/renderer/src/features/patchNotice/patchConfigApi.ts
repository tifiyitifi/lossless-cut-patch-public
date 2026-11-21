const remote = window.require('@electron/remote');
const { patchConfig } = remote.require('./index.js');

/**
Access to the patch settings store from the renderer (fork-owned).

The store itself lives in the main process (`main/features/patch/patchConfig.ts`); the renderer
only reads and writes single keys through it. Every fork slice keeps its own copy so the slice
stays deletable as a whole.
*/
export default patchConfig;
