import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { APP_BUILD_HASH, APP_SCHEMA_VERSION, APP_VERSION } from './config/version';
import { migrateLegacyStorageSchema, stripCacheBustParam } from './utils/updaterLogic';
import { initPWAInstallListener } from './hooks/usePWAInstall';
import { syncDocumentDeviceAttributes } from './utils/deviceViewport';

if (typeof window !== 'undefined') {
  syncDocumentDeviceAttributes();
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

  // Register Service Worker in production builds; clean up any stale dev SW in dev mode
  if ('serviceWorker' in navigator) {
    if (import.meta.env.PROD) {
      navigator.serviceWorker.addEventListener('message', (event) => {
        if (event.data?.type === 'PING_CLIENT_VERSION' && event.ports?.[0]) {
          event.ports[0].postMessage({
            version: APP_VERSION,
            buildHash: APP_BUILD_HASH,
          });
        }
      });

      const registerSw = () => {
        navigator.serviceWorker
          .register('/sw.js', { scope: '/', updateViaCache: 'none' })
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
    } else {
      navigator.serviceWorker
        .getRegistrations()
        .then((regs) => Promise.all(regs.map((r) => r.unregister())))
        .catch(() => {});
    }
  }
}

createRoot(document.getElementById('root')!).render(<App />);
