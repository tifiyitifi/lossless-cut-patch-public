const { patchConfig } = window.require('@electron/remote').require('./index.js');

/**
Access to the patch settings store from the renderer (fork-owned).

The store itself lives in the main process (`main/features/patch/patchConfig.ts`); the renderer
only reads and writes single keys through it. The v1 copy of this helper lives in the frozen
`patchLegacy` slice and cannot be imported (it is not type-checked nor bundled).
*/
export default patchConfig;
