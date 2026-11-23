declare const __APP_BUILD_HASH__: string | undefined;

const viteMetaEnv =
  typeof import.meta !== 'undefined'
    ? (import.meta as { env?: Record<string, string | undefined> }).env
    : undefined;

/**
 * Single source of truth for the application release version, schema generation,
 * and compile-time client build hash.
 * Comparing `APP_BUILD_HASH` against `/api/version` & `/version.json` lets installed PWAs
 * detect stale cached bundles even when a version string did not change.
 */
export const APP_VERSION = '2026.11.23-v10';
export const APP_SCHEMA_VERSION = 8;
export const APP_BUILD_HASH: string =
  viteMetaEnv?.VITE_APP_BUILD_HASH ||
  (typeof __APP_BUILD_HASH__ !== 'undefined' && __APP_BUILD_HASH__
    ? __APP_BUILD_HASH__
    : APP_VERSION);
