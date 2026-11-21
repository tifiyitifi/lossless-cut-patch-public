const remote = window.require('@electron/remote');
const { patchConfig } = remote.require('./index.js');

export default patchConfig;
