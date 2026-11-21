const { patchConfig } = window.require('@electron/remote').require('./index.js');

/**
Access to the patch settings store from the renderer (fork-owned).

Each feature slice keeps its own copy of this one-liner so a slice can be deleted as a whole
(same pattern as `features/patchWork` and `features/patchExportPolicy`).
*/
export default patchConfig;
