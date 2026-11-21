// patch: the fork has its own identity so it can live next to the official build on one machine.
// `app.name` also decides the userData directory (config, logs, cache, localStorage) and Electron's
// single-instance lock, both of which are per userData - so a distinct name keeps the two installs
// fully apart and lets them run at the same time.
export const appName = 'LosslessCut-Patch';
export const copyrightYear = 2026;
