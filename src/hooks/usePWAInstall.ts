import { useCallback, useEffect, useState } from 'react';
import {
  detectInstallContext,
  resolveInstallAvailability,
  type InstallAvailabilityMode,
  type InstallContext,
} from '../utils/pwaInstallUtils';

export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

interface GlobalPWAState {
  deferredPrompt: BeforeInstallPromptEvent | null;
  isInstalled: boolean;
  swActive: boolean;
  manifestReady: boolean;
}

const listeners = new Set<() => void>();
let initialized = false;

const globalState: GlobalPWAState = {
  deferredPrompt: null,
  isInstalled: false,
  swActive: false,
  manifestReady: false,
};

function notifyListeners() {
  listeners.forEach((listener) => {
    try {
      listener();
    } catch {
      // Ignore subscriber errors
    }
  });
}

function readIsStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    window.matchMedia?.('(display-mode: window-controls-overlay)').matches ||
    (window.navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

export async function probePWAPrerequisites(): Promise<void> {
  if (typeof window === 'undefined') return;

  let nextSwActive = globalState.swActive;
  let nextManifestReady = globalState.manifestReady;

  try {
    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.getRegistration();
      nextSwActive = Boolean(navigator.serviceWorker.controller || reg?.active || reg?.waiting);
    }
  } catch {
    // Ignore SW inspection errors
  }

  try {
    const manifestEl = document.querySelector('link[rel="manifest"]');
    const href = manifestEl?.getAttribute('href') || '/manifest.webmanifest';
    const res = await fetch(href, { credentials: 'include', cache: 'no-cache' });
    if (res.ok) {
      const json = (await res.json()) as { name?: string; start_url?: string } | null;
      nextManifestReady = Boolean(json && json.name && json.start_url);
    }
  } catch {
    // Ignore transient network errors
  }

  if (nextSwActive !== globalState.swActive || nextManifestReady !== globalState.manifestReady) {
    globalState.swActive = nextSwActive;
    globalState.manifestReady = nextManifestReady;
    notifyListeners();
  }
}

/**
 * Attaches global window listeners eagerly at startup so `beforeinstallprompt`
 * is never missed while modals or secondary portals are lazily mounted.
 */
export function initPWAInstallListener(): void {
  if (initialized || typeof window === 'undefined') return;
  initialized = true;

  globalState.isInstalled = readIsStandalone();

  const onBeforeInstallPrompt = (e: Event) => {
    e.preventDefault();
    globalState.deferredPrompt = e as BeforeInstallPromptEvent;
    notifyListeners();
  };

  const onAppInstalled = () => {
    globalState.isInstalled = true;
    globalState.deferredPrompt = null;
    notifyListeners();
  };

  window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
  window.addEventListener('appinstalled', onAppInstalled);

  const standaloneMq = window.matchMedia?.('(display-mode: standalone)');
  const onDisplayChange = () => {
    const standalone = readIsStandalone();
    if (standalone !== globalState.isInstalled) {
      globalState.isInstalled = standalone;
      if (standalone) globalState.deferredPrompt = null;
      notifyListeners();
    }
  };
  if (standaloneMq?.addEventListener) {
    standaloneMq.addEventListener('change', onDisplayChange);
  }

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      void probePWAPrerequisites();
    });
  }

  void probePWAPrerequisites();
}

// Initialize immediately on module import as well so earliest events are captured.
if (typeof window !== 'undefined') {
  initPWAInstallListener();
}

function getClientInstallContext(): InstallContext {
  if (typeof window === 'undefined') {
    return detectInstallContext({});
  }
  let isInIframe = false;
  try {
    isInIframe = window.self !== window.top;
  } catch {
    isInIframe = true;
  }
  return detectInstallContext({
    userAgent: window.navigator.userAgent,
    maxTouchPoints: window.navigator.maxTouchPoints,
    matchMediaStandalone: globalState.isInstalled || readIsStandalone(),
    navigatorStandalone: (window.navigator as unknown as { standalone?: boolean }).standalone,
    isInIframe,
    isSecureContext: window.isSecureContext,
  });
}

export interface PWAInstallHookResult {
  isInstallable: boolean;
  isInstalled: boolean;
  isIOS: boolean;
  isAndroid: boolean;
  isEmbeddedIframe: boolean;
  isInAppBrowser: boolean;
  isSecureContext: boolean;
  swActive: boolean;
  manifestReady: boolean;
  availabilityMode: InstallAvailabilityMode;
  install: () => Promise<boolean>;
  refreshChecks: () => Promise<void>;
}

export function usePWAInstall(): PWAInstallHookResult {
  const [, setTick] = useState(0);

  useEffect(() => {
    initPWAInstallListener();
    const bump = () => setTick((t) => t + 1);
    listeners.add(bump);
    return () => {
      listeners.delete(bump);
    };
  }, []);

  const install = useCallback(async () => {
    const promptEvent = globalState.deferredPrompt;
    if (!promptEvent) return false;
    try {
      await promptEvent.prompt();
      const { outcome } = await promptEvent.userChoice;
      if (outcome === 'accepted') {
        globalState.isInstalled = true;
        globalState.deferredPrompt = null;
        notifyListeners();
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }, []);

  const refreshChecks = useCallback(async () => {
    await probePWAPrerequisites();
  }, []);

  const context = getClientInstallContext();
  const availabilityMode = resolveInstallAvailability({
    hasDeferredPrompt: Boolean(globalState.deferredPrompt),
    context,
  });

  return {
    isInstallable: Boolean(globalState.deferredPrompt),
    isInstalled: context.isStandalone || globalState.isInstalled,
    isIOS: context.isIOS,
    isAndroid: context.isAndroid,
    isEmbeddedIframe: context.isEmbeddedIframe,
    isInAppBrowser: context.isInAppBrowser,
    isSecureContext: context.isSecureContext,
    swActive: globalState.swActive,
    manifestReady: globalState.manifestReady,
    availabilityMode,
    install,
    refreshChecks,
  };
}
