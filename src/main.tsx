import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { stripCacheBustParam } from './utils/updaterLogic';

// Clean temporary cache-bust query param after forced PWA update reload
if (typeof window !== 'undefined') {
  const cleanedPath = stripCacheBustParam(window.location.href);
  if (cleanedPath) {
    try {
      window.history.replaceState(null, '', cleanedPath);
    } catch {
      // Ignore history restrictions
    }
  }

  // Register Service Worker explicitly bypassing HTTP cache so installed PWAs always pull fresh updates
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      const swUrl = import.meta.env.DEV ? '/dev-sw.js?dev-sw' : '/sw.js';
      const swOptions: RegistrationOptions = import.meta.env.DEV
        ? { scope: '/', type: 'module', updateViaCache: 'none' }
        : { scope: '/', updateViaCache: 'none' };

      navigator.serviceWorker
        .register(swUrl, swOptions)
        .then((registration) => {
          void registration.update().catch(() => {});
        })
        .catch(() => {
          // Ignore registration errors in restricted browser contexts
        });
    });
  }
}

createRoot(document.getElementById('root')!).render(<App />);
