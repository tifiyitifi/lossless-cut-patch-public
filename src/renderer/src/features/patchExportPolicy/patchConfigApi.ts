const { patchConfig } = window.require('@electron/remote').require('./index.js');

/**
Access to the patch settings store from the renderer (fork-owned).

The store itself lives in the main process (`main/features/patch/patchConfig.ts`); the renderer
only reads and writes single keys through it. Each feature slice keeps its own copy of this
one-liner so a slice can be deleted as a whole (same pattern as `features/patchWork` and
`features/patchNotice`).
*/
export default patchConfig;
