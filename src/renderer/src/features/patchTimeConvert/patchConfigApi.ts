const { patchConfig } = window.require('@electron/remote').require('./index.js');

/**
Access to the patch settings store from the renderer (fork-owned).

The store itself lives in the main process (`main/features/patch/patchConfig.ts`); this slice only
reads and writes its own keys through it. Every slice keeps its own copy of this one-line accessor
so it can be deleted as a whole.
*/
export default patchConfig;
