import { useCallback, useEffect, useRef, useState } from 'react';
import { APP_VERSION } from '../config/version';
import {
  RELOADED_BUILD_STORAGE_KEY,
  RELOADED_VERSION_STORAGE_KEY,
  RELOAD_ATTEMPTS_STORAGE_KEY,
  SW_RELOAD_TIMESTAMP_KEY,
  buildCacheBustUrl,
  isNewerAppVersion,
  shouldPurgeCacheName,
  shouldReloadForServiceWorkerUpdate,
  shouldTriggerAppUpdate,
} from '../utils/updaterLogic';

interface VersionPayload {
  version?: string;
  buildId?: string;
}

interface ReloadAttemptState {
  version: string;
  count: number;
  atMs: number;
}

const VERSION_BC_NAME = 'cbt_app_version_sync_v1';

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

export function useAppUpdater(isExamActive: boolean, remotePulseVersion?: string | null) {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [isReloading, setIsReloading] = useState(false);
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);
  const [latestKnownVersion, setLatestKnownVersion] = useState<string>(APP_VERSION);

  const examActiveRef = useRef(isExamActive);
  const baselineBuildIdRef = useRef<string | null>(null);
  const pendingTargetRef = useRef<{ version?: string; buildId?: string; forceCacheBreak?: boolean } | null>(null);
  const hasTriggeredRef = useRef(false);
  const bcRef = useRef<BroadcastChannel | null>(null);

  const triggerSmoothReload = useCallback(
    (target?: { version?: string; buildId?: string; forceCacheBreak?: boolean }) => {
      if (hasTriggeredRef.current) return;
      hasTriggeredRef.current = true;

      const targetVersion = (target?.version || '').trim();
      const targetBuild = (target?.buildId || '').trim();

      try {
        if (targetVersion) {
          window.sessionStorage.setItem(RELOADED_VERSION_STORAGE_KEY, targetVersion);
          const prevAttempts = readReloadAttempts();
          const nextCount =
            prevAttempts && prevAttempts.version === targetVersion ? prevAttempts.count + 1 : 1;
          window.sessionStorage.setItem(
            RELOAD_ATTEMPTS_STORAGE_KEY,
            JSON.stringify({ version: targetVersion, count: nextCount, atMs: Date.now() })
          );
        }
        if (targetBuild) {
          window.sessionStorage.setItem(RELOADED_BUILD_STORAGE_KEY, targetBuild);
        }
        if (!targetVersion && !targetBuild) {
          window.sessionStorage.setItem(SW_RELOAD_TIMESTAMP_KEY, String(Date.now()));
        }
      } catch {
        // Ignore sessionStorage restrictions
      }

      setUpdateAvailable(true);
      setIsReloading(true);

      // On version mismatch or explicit cache-break, unregister stale SW so the browser
      // cannot serve cached old index.html, then navigate with a fresh _pwa_v param.
      const shouldUnregisterSw = Boolean(targetVersion || target?.forceCacheBreak);
      clearAllStaleAppCaches(shouldUnregisterSw).finally(() => {
        window.setTimeout(() => {
          const cacheKey = targetVersion || targetBuild || String(Date.now());
          if (shouldUnregisterSw) {
            const bustUrl = buildCacheBustUrl(window.location.href, cacheKey);
            window.location.replace(bustUrl);
          } else {
            window.location.reload();
          }
        }, 400);
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

  // React to Firestore cbt_sync_pulse version changes across all installed PWA/web devices
  useEffect(() => {
    const serverVer = (remotePulseVersion || '').trim();
    if (!serverVer || hasTriggeredRef.current) return;

    if (isNewerAppVersion(serverVer, APP_VERSION)) {
      setLatestKnownVersion(serverVer);
    }

    let alreadyReloadedTarget: string | null = null;
    try {
      alreadyReloadedTarget = window.sessionStorage.getItem(RELOADED_VERSION_STORAGE_KEY);
    } catch {
      // Ignore
    }
    const attempts = readReloadAttempts();

    if (
      shouldTriggerAppUpdate({
        clientVersion: APP_VERSION,
        serverVersion: serverVer,
        alreadyReloadedTarget,
        versionReloadAttempts:
          attempts && attempts.version === serverVer ? attempts.count : undefined,
        lastReloadAttemptAtMs:
          attempts && attempts.version === serverVer ? attempts.atMs : undefined,
      })
    ) {
      const target = { version: serverVer, forceCacheBreak: true };
      if (examActiveRef.current) {
        pendingTargetRef.current = target;
        setUpdateAvailable(true);
      } else {
        triggerSmoothReload(target);
      }
    }
  }, [remotePulseVersion, triggerSmoothReload]);

  useEffect(() => {
    let cancelled = false;

    const evaluateServerPayload = (data: VersionPayload, broadcastToTabs = true) => {
      if (cancelled || hasTriggeredRef.current) return;

      const serverVersion = (data.version || '').trim();
      const serverBuildId = (data.buildId || '').trim();

      if (serverVersion && isNewerAppVersion(serverVersion, APP_VERSION)) {
        setLatestKnownVersion(serverVersion);
      }

      // Record baseline buildId on the first healthy handshake after page load
      if (!baselineBuildIdRef.current && serverBuildId) {
        baselineBuildIdRef.current = serverBuildId;
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

      const shouldUpdate = shouldTriggerAppUpdate({
        clientVersion: APP_VERSION,
        serverVersion,
        alreadyReloadedTarget,
        clientBuildId: baselineBuildIdRef.current,
        serverBuildId,
        alreadyReloadedBuildId,
        versionReloadAttempts:
          attempts && attempts.version === serverVersion ? attempts.count : undefined,
        lastReloadAttemptAtMs:
          attempts && attempts.version === serverVersion ? attempts.atMs : undefined,
      });

      if (shouldUpdate) {
        const target = {
          version: serverVersion,
          buildId: serverBuildId,
          forceCacheBreak: Boolean(serverVersion && serverVersion !== APP_VERSION),
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
    };

    const checkServerVersion = async () => {
      if (hasTriggeredRef.current) return;
      try {
        const res = await fetch('/api/version', { cache: 'no-store' });
        if (!res.ok) return;
        const data = (await res.json()) as VersionPayload;
        evaluateServerPayload(data);
      } catch {
        // Ignore transient network errors
      }
    };

    // Real-time SSE listener for instant (<500ms) push updates whenever any build or file changes
    let es: EventSource | null = null;
    if (typeof window !== 'undefined' && 'EventSource' in window) {
      try {
        es = new EventSource('/api/version-stream');
        const handleSsePayload = (ev: MessageEvent) => {
          try {
            const parsed = JSON.parse(String(ev.data || '{}')) as VersionPayload;
            evaluateServerPayload(parsed);
          } catch {
            // Ignore malformed keepalive/event payloads
          }
        };
        es.addEventListener('version', handleSsePayload as EventListener);
        es.onmessage = handleSsePayload;
      } catch {
        // Fallback polling continues seamlessly if EventSource fails
      }
    }

    // Cross-tab instant synchronization
    if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
      try {
        const bc = new BroadcastChannel(VERSION_BC_NAME);
        bcRef.current = bc;
        bc.onmessage = (ev) => {
          const msg = ev.data as { type?: string; version?: string; buildId?: string } | null;
          if (msg?.type === 'UPDATE_AVAILABLE') {
            evaluateServerPayload({ version: msg.version, buildId: msg.buildId }, false);
          }
        };
      } catch {
        // Ignore
      }
    }

    const triggerSwReloadGuarded = (swVersion?: string) => {
      if (swVersion && swVersion !== APP_VERSION) {
        if (examActiveRef.current) {
          pendingTargetRef.current = { version: swVersion, forceCacheBreak: true };
          setUpdateAvailable(true);
        } else {
          triggerSmoothReload({ version: swVersion, forceCacheBreak: true });
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
        triggerSwReloadGuarded(swVer);
      }
    };

    // Service Worker update detection in production builds (installed PWAs + web)
    if ('serviceWorker' in navigator && import.meta.env.PROD) {
      navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);
      navigator.serviceWorker.addEventListener('message', onSwMessage);

      navigator.serviceWorker
        .getRegistration()
        .then((reg) => {
          if (!reg) return;
          if (reg.waiting && navigator.serviceWorker.controller) {
            reg.waiting.postMessage({ type: 'SKIP_WAITING' });
          }
          reg.addEventListener('updatefound', () => {
            const installing = reg.installing;
            if (!installing) return;
            installing.addEventListener('statechange', () => {
              if (installing.state === 'installed' && navigator.serviceWorker.controller) {
                installing.postMessage({ type: 'SKIP_WAITING' });
                triggerSwReloadGuarded();
              }
            });
          });
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
    checkServerVersion();
    const intervalId = window.setInterval(checkServerVersion, 10_000);
    const onFocusOrOnline = () => {
      checkServerVersion();
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
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('focus', onFocusOrOnline);
      window.removeEventListener('online', onFocusOrOnline);
      window.removeEventListener('pageshow', onFocusOrOnline);
      if ('serviceWorker' in navigator && import.meta.env.PROD) {
        navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
        navigator.serviceWorker.removeEventListener('message', onSwMessage);
      }
      if (es) es.close();
      if (bcRef.current) {
        bcRef.current.close();
        bcRef.current = null;
      }
    };
  }, [triggerSmoothReload]);

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

        const res = await fetch('/api/version', { cache: 'no-store' }).catch(() => null);
        if (res && res.ok) {
          const data = (await res.json()) as VersionPayload;
          const serverVer = (data.version || '').trim();
          const serverBuild = (data.buildId || '').trim();
          const remoteVer = (remotePulseVersion || '').trim();
          const targetVer =
            remoteVer && isNewerAppVersion(remoteVer, serverVer || APP_VERSION)
              ? remoteVer
              : serverVer;

          const hasUpdate =
            Boolean(targetVer && targetVer !== APP_VERSION && !isNewerAppVersion(APP_VERSION, targetVer)) ||
            Boolean(serverBuild && baselineBuildIdRef.current && serverBuild !== baselineBuildIdRef.current);

          if (hasUpdate || forceRefreshEvenIfSameVersion) {
            triggerSmoothReload({
              version: targetVer || APP_VERSION,
              buildId: serverBuild || undefined,
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

  return {
    updateAvailable,
    isReloading,
    isCheckingUpdate,
    currentVersion: APP_VERSION,
    latestKnownVersion,
    checkAndApplyUpdateNow,
  };
}
