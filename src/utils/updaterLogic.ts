export const RELOADED_VERSION_STORAGE_KEY = 'cbt_reloaded_to_version';
export const RELOADED_BUILD_STORAGE_KEY = 'cbt_reloaded_to_build';
export const RELOAD_ATTEMPTS_STORAGE_KEY = 'cbt_reloaded_attempts_v2';
export const SW_RELOAD_TIMESTAMP_KEY = 'cbt_sw_reloaded_at';

const PRESERVED_CACHE_NAMES = new Set(['google-fonts-cache']);

/**
 * Parses release version strings such as '2026.11.21-v6' or '1.2.3' into numeric tuples
 * for reliable monotonic comparisons across devices.
 */
export function parseAppVersionTuple(version?: string | null): number[] | null {
  const trimmed = (version || '').trim();
  if (!trimmed) return null;
  const parts = trimmed.match(/\d+/g);
  if (!parts || parts.length === 0) return null;
  return parts.map((p) => Number.parseInt(p, 10)).filter((n) => Number.isFinite(n));
}

/**
 * Returns > 0 if `a` is newer than `b`, < 0 if older, 0 if equivalent.
 */
export function compareAppVersions(a?: string | null, b?: string | null): number {
  const normA = (a || '').trim();
  const normB = (b || '').trim();
  if (normA === normB) return 0;

  const tupleA = parseAppVersionTuple(normA);
  const tupleB = parseAppVersionTuple(normB);

  if (tupleA && tupleB) {
    const maxLen = Math.max(tupleA.length, tupleB.length);
    for (let i = 0; i < maxLen; i++) {
      const va = tupleA[i] ?? 0;
      const vb = tupleB[i] ?? 0;
      if (va !== vb) return va - vb;
    }
    return normA.localeCompare(normB);
  }

  return normA.localeCompare(normB);
}

/**
 * Returns true strictly when `candidate` represents a newer release than `current`.
 */
export function isNewerAppVersion(
  candidate?: string | null,
  current?: string | null
): boolean {
  const cand = (candidate || '').trim();
  const curr = (current || '').trim();
  if (!cand || !curr || cand === curr) return false;
  return compareAppVersions(cand, curr) > 0;
}

/**
 * Prevents older cached PWAs from ever downgrading the Firestore sync-pulse version.
 */
export function resolveMonotonicPulseVersion(
  localVersion: string,
  remoteVersion?: string | null
): string {
  const local = (localVersion || '').trim();
  const remote = (remoteVersion || '').trim();
  if (!remote) return local;
  if (!local) return remote;
  return isNewerAppVersion(remote, local) ? remote : local;
}

/**
 * Determines whether a Cache Storage bucket should be deleted during app updates.
 * Purges ALL Workbox precaches and CBT runtime caches while preserving Google Fonts.
 */
export function shouldPurgeCacheName(cacheName: string): boolean {
  const name = (cacheName || '').trim();
  if (!name) return false;
  return !PRESERVED_CACHE_NAMES.has(name);
}

/**
 * Builds a cache-busting navigation URL for installed PWAs so stubborn
 * Workbox/WebView HTML caches cannot serve the stale shell after reload.
 */
export function buildCacheBustUrl(currentHref: string, cacheKey: string): string {
  try {
    const url = new URL(currentHref);
    url.searchParams.set('_pwa_v', cacheKey);
    return url.toString();
  } catch {
    const sep = currentHref.includes('?') ? '&' : '?';
    return `${currentHref}${sep}_pwa_v=${encodeURIComponent(cacheKey)}`;
  }
}

/**
 * Removes temporary `_pwa_v` cache-busting query params cleanly on startup.
 */
export function stripCacheBustParam(currentHref: string): string | null {
  try {
    const url = new URL(currentHref);
    if (!url.searchParams.has('_pwa_v')) return null;
    url.searchParams.delete('_pwa_v');
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}

/**
 * Determines whether the client should trigger an update reload.
 * Returns true when the server/pulse reports a different (non-older) version OR a different buildId
 * AND we have not already exceeded retry limits for that exact target.
 */
export function shouldTriggerAppUpdate(params: {
  clientVersion: string;
  serverVersion?: string | null;
  alreadyReloadedTarget?: string | null;
  clientBuildId?: string | null;
  serverBuildId?: string | null;
  alreadyReloadedBuildId?: string | null;
  versionReloadAttempts?: number;
  lastReloadAttemptAtMs?: number | null;
  nowMs?: number;
}): boolean {
  const serverVer = (params.serverVersion || '').trim();
  const clientVer = (params.clientVersion || '').trim();
  const serverBuild = (params.serverBuildId || '').trim();
  const clientBuild = (params.clientBuildId || '').trim();

  // Never downgrade a newer client to an older remote version
  const serverIsOlderThanClient = Boolean(
    serverVer && clientVer && isNewerAppVersion(clientVer, serverVer)
  );

  let versionChanged = false;
  if (serverVer && clientVer && serverVer !== clientVer && !serverIsOlderThanClient) {
    if (params.alreadyReloadedTarget !== serverVer) {
      versionChanged = true;
    } else if (
      typeof params.versionReloadAttempts === 'number' &&
      params.versionReloadAttempts > 0 &&
      params.versionReloadAttempts < 2
    ) {
      const now = params.nowMs ?? Date.now();
      const last = params.lastReloadAttemptAtMs ?? 0;
      if (now - last >= 8_000) {
        versionChanged = true;
      }
    }
  }

  const buildChanged = Boolean(
    !serverIsOlderThanClient &&
      serverBuild &&
      clientBuild &&
      serverBuild !== clientBuild &&
      params.alreadyReloadedBuildId !== serverBuild
  );

  return versionChanged || buildChanged;
}

/**
 * Guards Service Worker update reloads so they only run in production builds
 * and never repeat within a cooldown window.
 */
export function shouldReloadForServiceWorkerUpdate(params: {
  isProd: boolean;
  lastSwReloadAtMs?: number | null;
  nowMs?: number;
  cooldownMs?: number;
}): boolean {
  if (!params.isProd) return false;
  const now = params.nowMs ?? Date.now();
  const cooldown = params.cooldownMs ?? 20_000;
  if (
    typeof params.lastSwReloadAtMs === 'number' &&
    Number.isFinite(params.lastSwReloadAtMs) &&
    now - params.lastSwReloadAtMs < cooldown
  ) {
    return false;
  }
  return true;
}
