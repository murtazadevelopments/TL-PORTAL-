/** Build-time markers injected by Vite (`define` in vite.config.js). */

/* global __APP_COMMIT__, __APP_BUILT_AT__, __APP_SW_BUILD_ID__ */

export function getClientAppVersion() {
  let commit = 'dev';
  let builtAt = '';
  let swBuildId = '';
  try {
    commit = String(__APP_COMMIT__ || 'dev');
    builtAt = String(__APP_BUILT_AT__ || '');
    swBuildId = String(__APP_SW_BUILD_ID__ || '');
  } catch {
    /* define missing in unexpected environments */
  }
  return { commit, builtAt, swBuildId };
}
