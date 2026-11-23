import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { APP_BUILD_HASH, APP_SCHEMA_VERSION, APP_VERSION } from './config/version';
import { migrateLegacyStorageSchema, stripCacheBustParam } from './utils/updaterLogic';
import { initPWAInstallListener } from './hooks/usePWAInstall';

if (typeof window !== 'undefined') {
  initPWAInstallListener();
  // Run schema migration & incompatible legacy cache cleanup immediately on boot
  try {
    migrateLegacyStorageSchema(window.localStorage, APP_SCHEMA_VERSION);
  } catch {
    // Ignore storage access errors
  }

  // Clean temporary cache-bust query param after forced PWA update reload
  const cleanedPath = stripCacheBustParam(window.location.href);
  if (cleanedPath) {
    try {
      window.history.replaceState(null, '', cleanedPath);
    } catch {
      // Ignore history restrictions
    }
  }

  // Register Service Worker immediately bypassing HTTP cache so installed PWAs always check for fresh releases
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', (event) => {
      if (event.data?.type === 'PING_CLIENT_VERSION' && event.ports?.[0]) {
        event.ports[0].postMessage({
          version: APP_VERSION,
          buildHash: APP_BUILD_HASH,
        });
      }
    });

    const registerSw = () => {
      const swUrl = import.meta.env.DEV ? '/dev-sw.js?dev-sw' : '/sw.js';
      const swOptions: RegistrationOptions = import.meta.env.DEV
        ? { scope: '/', type: 'module', updateViaCache: 'none' }
        : { scope: '/', updateViaCache: 'none' };

      navigator.serviceWorker
        .register(swUrl, swOptions)
        .then((registration) => {
          void registration.update().catch(() => {});
          if (registration.waiting && navigator.serviceWorker.controller) {
            registration.waiting.postMessage({ type: 'SKIP_WAITING' });
          }
          registration.addEventListener('updatefound', () => {
            const installing = registration.installing;
            if (!installing) return;
            const onStateChange = () => {
              if (installing.state === 'installed' && navigator.serviceWorker.controller) {
                installing.postMessage({ type: 'SKIP_WAITING' });
              }
              if (installing.state === 'activated' || installing.state === 'redundant') {
                installing.removeEventListener('statechange', onStateChange);
              }
            };
            installing.addEventListener('statechange', onStateChange);
          });
        })
        .catch(() => {
          // Ignore registration errors in restricted browser contexts
        });
    };

    if (document.readyState === 'loading') {
      window.addEventListener('DOMContentLoaded', registerSw, { once: true });
    } else {
      registerSw();
    }
  }
}

createRoot(document.getElementById('root')!).render(<App />);
