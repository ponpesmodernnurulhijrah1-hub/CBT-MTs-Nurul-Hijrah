export const RELOADED_VERSION_STORAGE_KEY = 'cbt_reloaded_to_version';
export const RELOADED_BUILD_STORAGE_KEY = 'cbt_reloaded_to_build';
export const RELOAD_ATTEMPTS_STORAGE_KEY = 'cbt_reloaded_attempts_v2';
export const SW_RELOAD_TIMESTAMP_KEY = 'cbt_sw_reloaded_at';
export const SCHEMA_VERSION_STORAGE_KEY = 'cbt_app_schema_version';
export const APP_VERSION_STORAGE_KEY = 'cbt_app_version';
export const APP_BUILD_HASH_STORAGE_KEY = 'cbt_app_build_hash';
export const SW_HEARTBEAT_INTERVAL_MS = 30 * 60 * 1000;

const LEGACY_INCOMPATIBLE_STORAGE_KEYS = [
  'cbt_mts_nurul_hijrah_db_v1',
  'cbt_mts_nurul_hijrah_seeded_v1',
  'cbt_pwa_version',
  'cbt_cached_version',
];

const DB_LS_KEY = 'cbt_mts_nurul_hijrah_db_v2';
const PRESERVED_CACHE_NAMES = new Set(['google-fonts-cache']);

export interface StorageLike {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
}

export interface StorageMigrationResult {
  migrated: boolean;
  previousSchemaVersion: number | null;
  currentSchemaVersion: number;
  removedKeys: string[];
  sanitizedDb: boolean;
}

/**
 * Cleans legacy/incompatible localStorage keys across old PWA versions
 * and sanitizes malformed db_v2 snapshots while preserving valid records and offline sync queues.
 */
export function migrateLegacyStorageSchema(
  storage: StorageLike | null | undefined,
  targetSchemaVersion: number
): StorageMigrationResult {
  const result: StorageMigrationResult = {
    migrated: false,
    previousSchemaVersion: null,
    currentSchemaVersion: targetSchemaVersion,
    removedKeys: [],
    sanitizedDb: false,
  };
  if (!storage) return result;

  try {
    const rawPrev = storage.getItem(SCHEMA_VERSION_STORAGE_KEY);
    const parsedPrev = rawPrev ? Number.parseInt(rawPrev, 10) : NaN;
    result.previousSchemaVersion = Number.isFinite(parsedPrev) ? parsedPrev : null;

    if (result.previousSchemaVersion !== targetSchemaVersion) {
      result.migrated = true;
      for (const legacyKey of LEGACY_INCOMPATIBLE_STORAGE_KEYS) {
        if (storage.getItem(legacyKey) !== null) {
          storage.removeItem(legacyKey);
          result.removedKeys.push(legacyKey);
        }
      }

      const rawDb = storage.getItem(DB_LS_KEY);
      if (rawDb) {
        try {
          const parsed = JSON.parse(rawDb) as Record<string, unknown> | null;
          const isValidObject =
            parsed !== null &&
            typeof parsed === 'object' &&
            !Array.isArray(parsed) &&
            Array.isArray(parsed.subjects) &&
            Array.isArray(parsed.classes) &&
            Array.isArray(parsed.exams);
          if (!isValidObject) {
            storage.removeItem(DB_LS_KEY);
            result.removedKeys.push(DB_LS_KEY);
            result.sanitizedDb = true;
          }
        } catch {
          storage.removeItem(DB_LS_KEY);
          result.removedKeys.push(DB_LS_KEY);
          result.sanitizedDb = true;
        }
      }

      storage.setItem(SCHEMA_VERSION_STORAGE_KEY, String(targetSchemaVersion));
    }
  } catch {
    // Ignore restricted storage environments (e.g. Safari private mode)
  }

  return result;
}

/**
 * Parses release version strings such as '2026.11.22-v7' or '1.2.3' into numeric tuples
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
 * Supports both semantic version comparison AND compile-time `buildHash` / `buildId` mismatch detection
 * with bounded retry cooldowns to avoid infinite reload loops.
 */
export function shouldTriggerAppUpdate(params: {
  clientVersion: string;
  serverVersion?: string | null;
  alreadyReloadedTarget?: string | null;
  clientBuildId?: string | null;
  serverBuildId?: string | null;
  alreadyReloadedBuildId?: string | null;
  clientBuildHash?: string | null;
  serverBuildHash?: string | null;
  versionReloadAttempts?: number;
  lastReloadAttemptAtMs?: number | null;
  nowMs?: number;
  maxAttempts?: number;
  retryCooldownMs?: number;
}): boolean {
  const serverVer = (params.serverVersion || '').trim();
  const clientVer = (params.clientVersion || '').trim();
  const serverBuild = (params.serverBuildHash || params.serverBuildId || '').trim();
  const clientBuild = (params.clientBuildHash || params.clientBuildId || '').trim();
  const maxAttempts = params.maxAttempts ?? 2;
  const retryCooldownMs = params.retryCooldownMs ?? 8_000;

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
      params.versionReloadAttempts < maxAttempts
    ) {
      const now = params.nowMs ?? Date.now();
      const last = params.lastReloadAttemptAtMs ?? 0;
      if (now - last >= retryCooldownMs) {
        versionChanged = true;
      }
    }
  }

  let buildChanged = false;
  if (!serverIsOlderThanClient && serverBuild && clientBuild && serverBuild !== clientBuild) {
    if (params.alreadyReloadedBuildId !== serverBuild) {
      buildChanged = true;
    } else if (
      typeof params.versionReloadAttempts === 'number' &&
      params.versionReloadAttempts > 0 &&
      params.versionReloadAttempts < maxAttempts
    ) {
      const now = params.nowMs ?? Date.now();
      const last = params.lastReloadAttemptAtMs ?? 0;
      if (now - last >= retryCooldownMs) {
        buildChanged = true;
      }
    }
  }

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

/**
 * Evaluates a Service Worker heartbeat response to decide whether the running UI bundle
 * should trigger a soft reload due to a buildHash or version mismatch.
 */
export function shouldSoftReloadFromSwHeartbeat(params: {
  clientVersion: string;
  clientBuildHash: string;
  swVersion?: string | null;
  swBuildHash?: string | null;
  alreadyReloadedForSwHash?: string | null;
}): boolean {
  const clientVer = (params.clientVersion || '').trim();
  const clientHash = (params.clientBuildHash || '').trim();
  const swVer = (params.swVersion || '').trim();
  const swHash = (params.swBuildHash || '').trim();

  if (swHash && clientHash && swHash !== clientHash) {
    if (params.alreadyReloadedForSwHash === swHash) {
      return false;
    }
    return true;
  }

  if (swVer && clientVer && swVer !== clientVer && isNewerAppVersion(swVer, clientVer)) {
    return true;
  }

  return false;
}

export type VersionSyncDiagnosisStatus =
  | 'synced'
  | 'stale_version'
  | 'stale_hash'
  | 'stale_pulse'
  | 'client_ahead'
  | 'offline_or_unreachable';

export interface VersionSyncDiagnosis {
  status: VersionSyncDiagnosisStatus;
  isSynced: boolean;
  headline: string;
  explanation: string;
  clientVersion: string;
  serverVersion: string | null;
  clientBuildHash: string;
  serverBuildHash: string | null;
  pulseVersion: string | null;
  pulseBuildHash: string | null;
}

/**
 * Evaluates why an installed PWA might be stuck on an older cached version by comparing
 * compile-time client hash & version against the live server manifest and Firestore cross-device pulse.
 */
export function diagnoseVersionSync(params: {
  clientVersion: string;
  clientBuildHash: string;
  serverVersion?: string | null;
  serverBuildHash?: string | null;
  pulseVersion?: string | null;
  pulseBuildHash?: string | null;
}): VersionSyncDiagnosis {
  const clientVer = (params.clientVersion || '').trim();
  const clientHash = (params.clientBuildHash || '').trim();
  const serverVer = (params.serverVersion || '').trim() || null;
  const serverHash = (params.serverBuildHash || '').trim() || null;
  const pulseVer = (params.pulseVersion || '').trim() || null;
  const pulseHash = (params.pulseBuildHash || '').trim() || null;

  if (!serverVer && !serverHash) {
    if (pulseVer && isNewerAppVersion(pulseVer, clientVer)) {
      return {
        status: 'stale_pulse',
        isSynced: false,
        headline: 'Versi Tertinggal (Terdeteksi via Firestore Pulse)',
        explanation: `Manifest server tidak terjangkau, namun perangkat lain melaporkan rilis terbaru v${pulseVer} (klien masih v${clientVer}).`,
        clientVersion: clientVer,
        serverVersion: serverVer,
        clientBuildHash: clientHash,
        serverBuildHash: serverHash,
        pulseVersion: pulseVer,
        pulseBuildHash: pulseHash,
      };
    }
    return {
      status: 'offline_or_unreachable',
      isSynced: false,
      headline: 'Manifest Server Belum Terverifikasi',
      explanation:
        'Tidak dapat menghubungi endpoint manifest server (/api/version atau /version.json). Periksa koneksi internet lalu tekan Periksa Manifest.',
      clientVersion: clientVer,
      serverVersion: serverVer,
      clientBuildHash: clientHash,
      serverBuildHash: serverHash,
      pulseVersion: pulseVer,
      pulseBuildHash: pulseHash,
    };
  }

  if (serverVer && isNewerAppVersion(serverVer, clientVer)) {
    return {
      status: 'stale_version',
      isSynced: false,
      headline: 'PWA Memakai Cache Versi Lama',
      explanation: `Bundle klien masih menjalankan v${clientVer} sementara server telah merilis v${serverVer}. Service Worker atau cache browser lama perlu dibersihkan.`,
      clientVersion: clientVer,
      serverVersion: serverVer,
      clientBuildHash: clientHash,
      serverBuildHash: serverHash,
      pulseVersion: pulseVer,
      pulseBuildHash: pulseHash,
    };
  }

  if (serverVer && isNewerAppVersion(clientVer, serverVer)) {
    return {
      status: 'client_ahead',
      isSynced: true,
      headline: 'Versi Klien Lebih Baru dari Server Manifest',
      explanation: `Klien berjalan pada v${clientVer} sedangkan manifest server melaporkan v${serverVer}.`,
      clientVersion: clientVer,
      serverVersion: serverVer,
      clientBuildHash: clientHash,
      serverBuildHash: serverHash,
      pulseVersion: pulseVer,
      pulseBuildHash: pulseHash,
    };
  }

  if (serverHash && clientHash && serverHash !== clientHash) {
    return {
      status: 'stale_hash',
      isSynced: false,
      headline: 'Build Hash Tidak Cocok (Cache Bundle Lama)',
      explanation: `Nomor versi sama (v${clientVer}), tetapi hash build klien (${clientHash}) berbeda dengan manifest server (${serverHash}). Perangkat masih memuat bundel JS/CSS lama.`,
      clientVersion: clientVer,
      serverVersion: serverVer,
      clientBuildHash: clientHash,
      serverBuildHash: serverHash,
      pulseVersion: pulseVer,
      pulseBuildHash: pulseHash,
    };
  }

  if (pulseVer && isNewerAppVersion(pulseVer, clientVer)) {
    return {
      status: 'stale_pulse',
      isSynced: false,
      headline: 'Rilis Baru Aktif di Perangkat Lain',
      explanation: `Firestore Sync Pulse mencatat versi v${pulseVer} sudah aktif di perangkat lain, sedangkan perangkat ini masih di v${clientVer}.`,
      clientVersion: clientVer,
      serverVersion: serverVer,
      clientBuildHash: clientHash,
      serverBuildHash: serverHash,
      pulseVersion: pulseVer,
      pulseBuildHash: pulseHash,
    };
  }

  return {
    status: 'synced',
    isSynced: true,
    headline: 'Sinkron Sempurna & Versi Terbaru',
    explanation: `Versi (v${clientVer}) dan hash build (${clientHash}) identik dengan manifest server pusat.`,
    clientVersion: clientVer,
    serverVersion: serverVer,
    clientBuildHash: clientHash,
    serverBuildHash: serverHash,
    pulseVersion: pulseVer,
    pulseBuildHash: pulseHash,
  };
}
