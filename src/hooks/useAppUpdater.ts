import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { APP_BUILD_HASH, APP_SCHEMA_VERSION, APP_VERSION } from '../config/version';
import {
  APP_BUILD_HASH_STORAGE_KEY,
  APP_VERSION_STORAGE_KEY,
  RELOADED_BUILD_STORAGE_KEY,
  RELOADED_VERSION_STORAGE_KEY,
  RELOAD_ATTEMPTS_STORAGE_KEY,
  SW_RELOAD_TIMESTAMP_KEY,
  buildCacheBustUrl,
  diagnoseVersionSync,
  isNewerAppVersion,
  migrateLegacyStorageSchema,
  shouldPurgeCacheName,
  shouldReloadForServiceWorkerUpdate,
  shouldTriggerAppUpdate,
  type VersionSyncDiagnosis,
} from '../utils/updaterLogic';
import { fetchWithTimeout } from '../utils/connectionUtils';

interface VersionPayload {
  version?: string;
  buildHash?: string;
  buildId?: string;
  schemaVersion?: number;
  builtAt?: string;
}

export interface ServerManifestSnapshot {
  version: string | null;
  buildHash: string | null;
  buildId: string | null;
  schemaVersion: number | null;
  source: '/api/version' | '/version.json' | 'sse' | null;
  checkedAt: string | null;
  error: string | null;
}

export interface ServiceWorkerDiagnosticInfo {
  supported: boolean;
  registrationsCount: number;
  controllerState: string | null;
  waitingPresent: boolean;
  installingPresent: boolean;
  updateViaCache: string | null;
  cacheBuckets: string[];
}

export interface VersionDiagnosticsBundle {
  clientVersion: string;
  clientBuildHash: string;
  clientSchemaVersion: number;
  runtimeMode: 'PWA Standalone' | 'Browser Web';
  serverManifest: ServerManifestSnapshot;
  swInfo: ServiceWorkerDiagnosticInfo;
  diagnosis: VersionSyncDiagnosis;
}

interface ReloadAttemptState {
  version: string;
  count: number;
  atMs: number;
}

const VERSION_BC_NAME = 'cbt_app_version_sync_v1';

async function inspectSwAndCaches(): Promise<ServiceWorkerDiagnosticInfo> {
  const info: ServiceWorkerDiagnosticInfo = {
    supported: typeof navigator !== 'undefined' && 'serviceWorker' in navigator,
    registrationsCount: 0,
    controllerState: null,
    waitingPresent: false,
    installingPresent: false,
    updateViaCache: null,
    cacheBuckets: [],
  };

  try {
    if (info.supported) {
      info.controllerState = navigator.serviceWorker.controller?.state ?? null;
      const regs = await navigator.serviceWorker.getRegistrations().catch(() => []);
      info.registrationsCount = regs.length;
      const primary = regs[0];
      if (primary) {
        info.waitingPresent = Boolean(primary.waiting);
        info.installingPresent = Boolean(primary.installing);
        info.updateViaCache = primary.updateViaCache ?? null;
      }
    }
  } catch {
    // Ignore SW inspection errors
  }

  try {
    if (typeof window !== 'undefined' && 'caches' in window) {
      info.cacheBuckets = await window.caches.keys();
    }
  } catch {
    // Ignore Cache Storage API errors
  }

  return info;
}

async function clearAllStaleAppCaches(unregisterServiceWorkers: boolean): Promise<void> {
  try {
    if ('serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations().catch(() => []);
      for (const reg of registrations) {
        try {
          reg.active?.postMessage({ type: 'PURGE_CACHES' });
          reg.waiting?.postMessage({ type: 'SKIP_WAITING' });
        } catch {
          // Ignore postMessage errors
        }
        if (unregisterServiceWorkers) {
          try {
            await reg.unregister();
          } catch {
            // Ignore unregister errors
          }
        }
      }
    }
  } catch {
    // Ignore SW errors
  }

  try {
    if ('caches' in window) {
      const keys = await window.caches.keys();
      await Promise.all(
        keys.filter((k) => shouldPurgeCacheName(k)).map((k) => window.caches.delete(k))
      );
    }
  } catch {
    // Ignore Cache Storage API errors
  }
}

async function fetchServerVersionManifest(): Promise<{
  payload: VersionPayload;
  source: '/api/version' | '/version.json';
} | null> {
  const cb = Date.now();
  try {
    const res = await fetchWithTimeout(
      `/api/version?_cb=${cb}`,
      {
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-cache' },
      },
      5000
    );
    if (res.ok) {
      const payload = (await res.json()) as VersionPayload;
      if (payload && (payload.version || payload.buildHash || payload.buildId)) {
        return { payload, source: '/api/version' };
      }
    }
  } catch {
    // Fallback to static /version.json
  }

  try {
    const fallbackRes = await fetchWithTimeout(
      `/version.json?_cb=${cb}`,
      {
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-cache' },
      },
      5000
    );
    if (fallbackRes.ok) {
      const payload = (await fallbackRes.json()) as VersionPayload;
      if (payload && (payload.version || payload.buildHash || payload.buildId)) {
        return { payload, source: '/version.json' };
      }
    }
  } catch {
    // Unreachable / offline
  }

  return null;
}

function readReloadAttempts(): ReloadAttemptState | null {
  try {
    const raw = window.sessionStorage.getItem(RELOAD_ATTEMPTS_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ReloadAttemptState>;
    if (
      typeof parsed.version === 'string' &&
      typeof parsed.count === 'number' &&
      typeof parsed.atMs === 'number'
    ) {
      return parsed as ReloadAttemptState;
    }
  } catch {
    // Ignore
  }
  return null;
}

export function useAppUpdater(
  isExamActive: boolean,
  remotePulseVersion?: string | null,
  remotePulseBuildHash?: string | null
) {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [isReloading, setIsReloading] = useState(false);
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);
  const [latestKnownVersion, setLatestKnownVersion] = useState<string>(APP_VERSION);
  const [serverManifest, setServerManifest] = useState<ServerManifestSnapshot>({
    version: null,
    buildHash: null,
    buildId: null,
    schemaVersion: null,
    source: null,
    checkedAt: null,
    error: null,
  });
  const [swInfo, setSwInfo] = useState<ServiceWorkerDiagnosticInfo>({
    supported: typeof navigator !== 'undefined' && 'serviceWorker' in navigator,
    registrationsCount: 0,
    controllerState: null,
    waitingPresent: false,
    installingPresent: false,
    updateViaCache: null,
    cacheBuckets: [],
  });

  const examActiveRef = useRef(isExamActive);
  const pendingTargetRef = useRef<{
    version?: string;
    buildId?: string;
    buildHash?: string;
    forceCacheBreak?: boolean;
  } | null>(null);
  const hasTriggeredRef = useRef(false);
  const bcRef = useRef<BroadcastChannel | null>(null);
  const reloadTimerRef = useRef<number | null>(null);

  const runtimeMode: 'PWA Standalone' | 'Browser Web' = useMemo(() => {
    if (typeof window === 'undefined') return 'Browser Web';
    const isStandalone =
      window.matchMedia?.('(display-mode: standalone)').matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true;
    return isStandalone ? 'PWA Standalone' : 'Browser Web';
  }, []);

  const triggerSmoothReload = useCallback(
    (target?: {
      version?: string;
      buildId?: string;
      buildHash?: string;
      forceCacheBreak?: boolean;
    }) => {
      if (hasTriggeredRef.current) return;
      hasTriggeredRef.current = true;

      const targetVersion = (target?.version || '').trim();
      const targetBuild = (target?.buildHash || target?.buildId || '').trim();

      try {
        migrateLegacyStorageSchema(window.localStorage, APP_SCHEMA_VERSION);
      } catch {
        // Ignore storage errors
      }

      try {
        if (targetVersion) {
          window.localStorage.setItem(APP_VERSION_STORAGE_KEY, targetVersion);
          window.sessionStorage.setItem(RELOADED_VERSION_STORAGE_KEY, targetVersion);
          const attemptKey = targetBuild ? `${targetVersion}:${targetBuild}` : targetVersion;
          const prevAttempts = readReloadAttempts();
          const nextCount =
            prevAttempts && prevAttempts.version === attemptKey ? prevAttempts.count + 1 : 1;
          window.sessionStorage.setItem(
            RELOAD_ATTEMPTS_STORAGE_KEY,
            JSON.stringify({ version: attemptKey, count: nextCount, atMs: Date.now() })
          );
        }
        if (targetBuild) {
          window.localStorage.setItem(APP_BUILD_HASH_STORAGE_KEY, targetBuild);
          window.sessionStorage.setItem(RELOADED_BUILD_STORAGE_KEY, targetBuild);
        }
        if (!targetVersion && !targetBuild) {
          window.sessionStorage.setItem(SW_RELOAD_TIMESTAMP_KEY, String(Date.now()));
        }
      } catch {
        // Ignore sessionStorage/localStorage restrictions
      }

      setUpdateAvailable(true);
      setIsReloading(true);

      const shouldUnregisterSw = Boolean(targetVersion || targetBuild || target?.forceCacheBreak);
      const cacheKey = targetBuild || targetVersion || String(Date.now());

      clearAllStaleAppCaches(shouldUnregisterSw)
        .then(async () => {
          if (shouldUnregisterSw) {
            try {
              await fetchWithTimeout(
                buildCacheBustUrl(window.location.href, cacheKey),
                { cache: 'reload' },
                4500
              );
            } catch {
              // Ignore warm-fetch failures when offline or slow
            }
          }
        })
        .finally(() => {
          if (reloadTimerRef.current !== null) window.clearTimeout(reloadTimerRef.current);
          reloadTimerRef.current = window.setTimeout(() => {
            reloadTimerRef.current = null;
            if (shouldUnregisterSw) {
              const bustUrl = buildCacheBustUrl(window.location.href, cacheKey);
              window.location.replace(bustUrl);
            } else {
              window.location.reload();
            }
          }, 350);
        });
    },
    []
  );

  useEffect(() => {
    examActiveRef.current = isExamActive;
    if (!isExamActive && pendingTargetRef.current !== null) {
      const pending = pendingTargetRef.current;
      pendingTargetRef.current = null;
      triggerSmoothReload(pending);
    }
  }, [isExamActive, triggerSmoothReload]);

  // React to Firestore cbt_sync_pulse version/buildHash updates by verifying authoritative server manifest
  useEffect(() => {
    const serverVer = (remotePulseVersion || '').trim();
    const pulseHash = (remotePulseBuildHash || '').trim();
    if ((!serverVer && !pulseHash) || hasTriggeredRef.current) return;

    if (serverVer && isNewerAppVersion(serverVer, APP_VERSION)) {
      setLatestKnownVersion(serverVer);
    }

    // If authoritative server manifest already matches this client's buildHash & version,
    // ignore stale buildHash values coming from an older device's Firestore pulse write.
    const serverVersionKnown = serverManifest.version;
    const serverHashKnown = serverManifest.buildHash;
    if (
      serverHashKnown &&
      serverHashKnown === APP_BUILD_HASH &&
      (!serverVer || !isNewerAppVersion(serverVer, APP_VERSION))
    ) {
      return;
    }

    // If pulse announces a different version/hash, check authoritative server manifest right away
    let cancelled = false;
    void fetchServerVersionManifest().then((manifest) => {
      if (cancelled || hasTriggeredRef.current || !manifest) return;
      const authVer = (manifest.payload.version || '').trim();
      const authHash = (manifest.payload.buildHash || manifest.payload.buildId || '').trim();
      setServerManifest({
        version: authVer || null,
        buildHash: authHash || null,
        buildId: (manifest.payload.buildId || authHash || '').trim() || null,
        schemaVersion:
          typeof manifest.payload.schemaVersion === 'number'
            ? manifest.payload.schemaVersion
            : null,
        source: manifest.source,
        checkedAt: new Date().toISOString(),
        error: null,
      });

      let alreadyReloadedTarget: string | null = null;
      let alreadyReloadedBuildId: string | null = null;
      try {
        alreadyReloadedTarget = window.sessionStorage.getItem(RELOADED_VERSION_STORAGE_KEY);
        alreadyReloadedBuildId = window.sessionStorage.getItem(RELOADED_BUILD_STORAGE_KEY);
      } catch {
        // Ignore
      }
      const attempts = readReloadAttempts();
      const attemptKey = authHash ? `${authVer}:${authHash}` : authVer;

      if (
        shouldTriggerAppUpdate({
          clientVersion: APP_VERSION,
          serverVersion: authVer || serverVersionKnown || APP_VERSION,
          alreadyReloadedTarget,
          clientBuildHash: APP_BUILD_HASH,
          serverBuildHash: authHash,
          alreadyReloadedBuildId,
          versionReloadAttempts:
            attempts && attempts.version === attemptKey ? attempts.count : undefined,
          lastReloadAttemptAtMs:
            attempts && attempts.version === attemptKey ? attempts.atMs : undefined,
          maxAttempts: 3,
          retryCooldownMs: 6_000,
        })
      ) {
        const target = {
          version: authVer || APP_VERSION,
          buildHash: authHash || undefined,
          forceCacheBreak: true,
        };
        if (examActiveRef.current) {
          pendingTargetRef.current = target;
          setUpdateAvailable(true);
        } else {
          triggerSmoothReload(target);
        }
      }
    });

    return () => {
      cancelled = true;
    };
  }, [
    remotePulseVersion,
    remotePulseBuildHash,
    serverManifest.version,
    serverManifest.buildHash,
    triggerSmoothReload,
  ]);

  const evaluateServerPayload = useCallback(
    (
      data: VersionPayload,
      source: '/api/version' | '/version.json' | 'sse',
      broadcastToTabs = true
    ) => {
      if (hasTriggeredRef.current) return;

      const serverVersion = (data.version || '').trim();
      const serverBuildHash = (data.buildHash || data.buildId || '').trim();
      const serverBuildId = (data.buildId || data.buildHash || '').trim();

      setServerManifest({
        version: serverVersion || null,
        buildHash: serverBuildHash || null,
        buildId: serverBuildId || null,
        schemaVersion: typeof data.schemaVersion === 'number' ? data.schemaVersion : null,
        source,
        checkedAt: new Date().toISOString(),
        error: null,
      });

      if (serverVersion && isNewerAppVersion(serverVersion, APP_VERSION)) {
        setLatestKnownVersion(serverVersion);
      }

      let alreadyReloadedTarget: string | null = null;
      let alreadyReloadedBuildId: string | null = null;
      try {
        alreadyReloadedTarget = window.sessionStorage.getItem(RELOADED_VERSION_STORAGE_KEY);
        alreadyReloadedBuildId = window.sessionStorage.getItem(RELOADED_BUILD_STORAGE_KEY);
      } catch {
        // Ignore
      }
      const attempts = readReloadAttempts();
      const attemptKey = serverBuildHash
        ? `${serverVersion}:${serverBuildHash}`
        : serverVersion;

      const shouldUpdate = shouldTriggerAppUpdate({
        clientVersion: APP_VERSION,
        serverVersion,
        alreadyReloadedTarget,
        clientBuildHash: APP_BUILD_HASH,
        serverBuildHash,
        alreadyReloadedBuildId,
        versionReloadAttempts:
          attempts && attempts.version === attemptKey ? attempts.count : undefined,
        lastReloadAttemptAtMs:
          attempts && attempts.version === attemptKey ? attempts.atMs : undefined,
        maxAttempts: 3,
        retryCooldownMs: 6_000,
      });

      if (shouldUpdate) {
        const target = {
          version: serverVersion,
          buildId: serverBuildId,
          buildHash: serverBuildHash,
          forceCacheBreak: true,
        };
        if (broadcastToTabs && bcRef.current) {
          try {
            bcRef.current.postMessage({ type: 'UPDATE_AVAILABLE', ...target });
          } catch {
            // Ignore BC errors
          }
        }
        if (examActiveRef.current) {
          pendingTargetRef.current = target;
          setUpdateAvailable(true);
        } else {
          triggerSmoothReload(target);
        }
      }
    },
    [triggerSmoothReload]
  );

  useEffect(() => {
    let cancelled = false;

    const checkServerVersion = async () => {
      if (cancelled || hasTriggeredRef.current) return;
      const manifest = await fetchServerVersionManifest();
      if (cancelled) return;
      if (manifest) {
        evaluateServerPayload(manifest.payload, manifest.source);
      } else {
        setServerManifest((prev) => ({
          ...prev,
          checkedAt: new Date().toISOString(),
          error: 'Endpoint manifest server tidak terjangkau',
        }));
      }
      const nextSw = await inspectSwAndCaches();
      if (!cancelled) setSwInfo(nextSw);
    };

    // Defer real-time SSE listener slightly so initial UI hydration & database sync take priority
    let es: EventSource | null = null;
    let sseStartTimerId: number | null = null;
    if (typeof window !== 'undefined' && 'EventSource' in window) {
      sseStartTimerId = window.setTimeout(() => {
        if (cancelled) return;
        try {
          es = new EventSource('/api/version-stream');
          const handleSsePayload = (ev: MessageEvent) => {
            if (cancelled) return;
            try {
              const parsed = JSON.parse(String(ev.data || '{}')) as VersionPayload;
              evaluateServerPayload(parsed, 'sse');
            } catch {
              // Ignore malformed keepalive/event payloads
            }
          };
          es.addEventListener('version', handleSsePayload as EventListener);
          es.onmessage = handleSsePayload;
        } catch {
          // Fallback polling continues seamlessly if EventSource fails
        }
      }, 1200);
    }

    // Cross-tab instant synchronization
    if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
      try {
        const bc = new BroadcastChannel(VERSION_BC_NAME);
        bcRef.current = bc;
        bc.onmessage = (ev) => {
          const msg = ev.data as {
            type?: string;
            version?: string;
            buildId?: string;
            buildHash?: string;
          } | null;
          if (msg?.type === 'UPDATE_AVAILABLE') {
            evaluateServerPayload(
              { version: msg.version, buildId: msg.buildId, buildHash: msg.buildHash },
              'sse',
              false
            );
          }
        };
      } catch {
        // Ignore
      }
    }

    const triggerSwReloadGuarded = (swVersion?: string, swBuildHash?: string) => {
      const hashMismatch = Boolean(swBuildHash && swBuildHash !== APP_BUILD_HASH);
      const versionMismatch = Boolean(swVersion && swVersion !== APP_VERSION);
      if (versionMismatch || hashMismatch) {
        const target = {
          version: swVersion || APP_VERSION,
          buildHash: swBuildHash || undefined,
          forceCacheBreak: true,
        };
        if (examActiveRef.current) {
          pendingTargetRef.current = target;
          setUpdateAvailable(true);
        } else {
          triggerSmoothReload(target);
        }
        return;
      }

      let lastSwReloadAtMs: number | null = null;
      try {
        const raw = window.sessionStorage.getItem(SW_RELOAD_TIMESTAMP_KEY);
        if (raw) lastSwReloadAtMs = Number(raw);
      } catch {
        // Ignore
      }

      if (
        !shouldReloadForServiceWorkerUpdate({
          isProd: import.meta.env.PROD,
          lastSwReloadAtMs,
        })
      ) {
        return;
      }

      if (examActiveRef.current) {
        pendingTargetRef.current = {};
        setUpdateAvailable(true);
      } else {
        triggerSmoothReload();
      }
    };

    let swIntervalId: number | null = null;
    const onControllerChange = () => {
      triggerSwReloadGuarded();
    };
    const onSwMessage = (ev: MessageEvent) => {
      if (ev.data?.type === 'SW_ACTIVATED') {
        const swVer = typeof ev.data?.version === 'string' ? ev.data.version : undefined;
        const swHash = typeof ev.data?.buildHash === 'string' ? ev.data.buildHash : undefined;
        triggerSwReloadGuarded(swVer, swHash);
      }
    };

    let swReg: ServiceWorkerRegistration | null = null;
    let onUpdateFound: (() => void) | null = null;

    // Service Worker update detection in production builds (installed PWAs + web)
    if ('serviceWorker' in navigator && import.meta.env.PROD) {
      navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);
      navigator.serviceWorker.addEventListener('message', onSwMessage);

      navigator.serviceWorker
        .getRegistration()
        .then((reg) => {
          if (!reg || cancelled) return;
          swReg = reg;
          if (reg.waiting && navigator.serviceWorker.controller) {
            reg.waiting.postMessage({ type: 'SKIP_WAITING' });
          }
          onUpdateFound = () => {
            const installing = reg.installing;
            if (!installing) return;
            const onStateChange = () => {
              if (installing.state === 'installed' && navigator.serviceWorker.controller) {
                installing.removeEventListener('statechange', onStateChange);
                installing.postMessage({ type: 'SKIP_WAITING' });
                triggerSwReloadGuarded();
              } else if (installing.state === 'redundant' || installing.state === 'activated') {
                installing.removeEventListener('statechange', onStateChange);
              }
            };
            installing.addEventListener('statechange', onStateChange);
          };
          reg.addEventListener('updatefound', onUpdateFound);
        })
        .catch(() => {});

      swIntervalId = window.setInterval(() => {
        navigator.serviceWorker
          .getRegistration()
          .then((r) => r?.update())
          .catch(() => {});
      }, 20_000);
    }

    // Immediate baseline check + fast 10s fallback polling + focus/online/pageshow triggers
    void checkServerVersion();
    const intervalId = window.setInterval(() => {
      void checkServerVersion();
    }, 10_000);
    const onFocusOrOnline = () => {
      void checkServerVersion();
      if ('serviceWorker' in navigator && import.meta.env.PROD) {
        navigator.serviceWorker
          .getRegistration()
          .then((r) => r?.update())
          .catch(() => {});
      }
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        onFocusOrOnline();
      }
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('focus', onFocusOrOnline);
    window.addEventListener('online', onFocusOrOnline);
    window.addEventListener('pageshow', onFocusOrOnline);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      if (swIntervalId !== null) window.clearInterval(swIntervalId);
      if (reloadTimerRef.current !== null) {
        window.clearTimeout(reloadTimerRef.current);
        reloadTimerRef.current = null;
      }
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('focus', onFocusOrOnline);
      window.removeEventListener('online', onFocusOrOnline);
      window.removeEventListener('pageshow', onFocusOrOnline);
      if ('serviceWorker' in navigator && import.meta.env.PROD) {
        navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
        navigator.serviceWorker.removeEventListener('message', onSwMessage);
        if (swReg && onUpdateFound) {
          swReg.removeEventListener('updatefound', onUpdateFound);
        }
      }
      if (sseStartTimerId !== null) {
        window.clearTimeout(sseStartTimerId);
      }
      if (es) es.close();
      if (bcRef.current) {
        bcRef.current.close();
        bcRef.current = null;
      }
    };
  }, [evaluateServerPayload, triggerSmoothReload]);

  // Manual diagnostic inspection without forcing reload unless mismatch demands it
  const refreshDiagnostics = useCallback(async () => {
    setIsCheckingUpdate(true);
    try {
      if ('serviceWorker' in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations().catch(() => []);
        await Promise.all(regs.map((r) => r.update().catch(() => {})));
      }
      const manifest = await fetchServerVersionManifest();
      if (manifest) {
        setServerManifest({
          version: (manifest.payload.version || '').trim() || null,
          buildHash: (manifest.payload.buildHash || manifest.payload.buildId || '').trim() || null,
          buildId: (manifest.payload.buildId || manifest.payload.buildHash || '').trim() || null,
          schemaVersion:
            typeof manifest.payload.schemaVersion === 'number'
              ? manifest.payload.schemaVersion
              : null,
          source: manifest.source,
          checkedAt: new Date().toISOString(),
          error: null,
        });
      } else {
        setServerManifest((prev) => ({
          ...prev,
          checkedAt: new Date().toISOString(),
          error: 'Manifest server tidak dapat dijangkau',
        }));
      }
      const nextSw = await inspectSwAndCaches();
      setSwInfo(nextSw);
    } finally {
      setIsCheckingUpdate(false);
    }
  }, []);

  // Manual 1-tap hard cache purge & version check for installed PWAs
  const checkAndApplyUpdateNow = useCallback(
    async (forceRefreshEvenIfSameVersion = false): Promise<'updated' | 'up-to-date' | 'deferred'> => {
      if (examActiveRef.current) {
        setUpdateAvailable(true);
        return 'deferred';
      }
      setIsCheckingUpdate(true);
      try {
        if ('serviceWorker' in navigator) {
          const regs = await navigator.serviceWorker.getRegistrations().catch(() => []);
          await Promise.all(regs.map((r) => r.update().catch(() => {})));
        }

        const manifest = await fetchServerVersionManifest();
        if (manifest) {
          const data = manifest.payload;
          const serverVer = (data.version || '').trim();
          const serverHash = (data.buildHash || data.buildId || '').trim();
          setServerManifest({
            version: serverVer || null,
            buildHash: serverHash || null,
            buildId: (data.buildId || serverHash || '').trim() || null,
            schemaVersion: typeof data.schemaVersion === 'number' ? data.schemaVersion : null,
            source: manifest.source,
            checkedAt: new Date().toISOString(),
            error: null,
          });

          const remoteVer = (remotePulseVersion || '').trim();
          const targetVer =
            remoteVer && isNewerAppVersion(remoteVer, serverVer || APP_VERSION)
              ? remoteVer
              : serverVer;

          const hasVersionDiff = Boolean(
            targetVer && targetVer !== APP_VERSION && !isNewerAppVersion(APP_VERSION, targetVer)
          );
          const hasHashDiff = Boolean(serverHash && serverHash !== APP_BUILD_HASH);

          if (hasVersionDiff || hasHashDiff || forceRefreshEvenIfSameVersion) {
            triggerSmoothReload({
              version: targetVer || APP_VERSION,
              buildHash: serverHash || undefined,
              forceCacheBreak: true,
            });
            return 'updated';
          }
        } else if (forceRefreshEvenIfSameVersion) {
          triggerSmoothReload({ version: APP_VERSION, forceCacheBreak: true });
          return 'updated';
        }
        return 'up-to-date';
      } finally {
        setIsCheckingUpdate(false);
      }
    },
    [remotePulseVersion, triggerSmoothReload]
  );

  // Explicit force-reset button in diagnostics UI: clears reload retry guards + all caches + reloads
  const forceHardResetAndReload = useCallback(async () => {
    if (examActiveRef.current) {
      setUpdateAvailable(true);
      return;
    }
    try {
      window.sessionStorage.removeItem(RELOADED_VERSION_STORAGE_KEY);
      window.sessionStorage.removeItem(RELOADED_BUILD_STORAGE_KEY);
      window.sessionStorage.removeItem(RELOAD_ATTEMPTS_STORAGE_KEY);
      window.sessionStorage.removeItem(SW_RELOAD_TIMESTAMP_KEY);
      window.localStorage.removeItem('cbt_app_schema_version');
      window.localStorage.removeItem(APP_VERSION_STORAGE_KEY);
      window.localStorage.removeItem(APP_BUILD_HASH_STORAGE_KEY);
    } catch {
      // Ignore storage errors
    }
    hasTriggeredRef.current = false;
    triggerSmoothReload({
      version: serverManifest.version || APP_VERSION,
      buildHash: serverManifest.buildHash || String(Date.now()),
      forceCacheBreak: true,
    });
  }, [serverManifest.buildHash, serverManifest.version, triggerSmoothReload]);

  const diagnosis = useMemo(
    () =>
      diagnoseVersionSync({
        clientVersion: APP_VERSION,
        clientBuildHash: APP_BUILD_HASH,
        serverVersion: serverManifest.version,
        serverBuildHash: serverManifest.buildHash,
        pulseVersion: remotePulseVersion,
        pulseBuildHash: remotePulseBuildHash,
      }),
    [
      serverManifest.version,
      serverManifest.buildHash,
      remotePulseVersion,
      remotePulseBuildHash,
    ]
  );

  const diagnostics: VersionDiagnosticsBundle = useMemo(
    () => ({
      clientVersion: APP_VERSION,
      clientBuildHash: APP_BUILD_HASH,
      clientSchemaVersion: APP_SCHEMA_VERSION,
      runtimeMode,
      serverManifest,
      swInfo,
      diagnosis,
    }),
    [runtimeMode, serverManifest, swInfo, diagnosis]
  );

  return {
    updateAvailable,
    isReloading,
    isCheckingUpdate,
    currentVersion: APP_VERSION,
    currentBuildHash: APP_BUILD_HASH,
    latestKnownVersion,
    diagnostics,
    refreshDiagnostics,
    checkAndApplyUpdateNow,
    forceHardResetAndReload,
  };
}
