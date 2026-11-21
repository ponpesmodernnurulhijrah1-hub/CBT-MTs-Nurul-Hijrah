/// <reference lib="webworker" />
import { clientsClaim } from 'workbox-core';
import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching';
import { registerRoute } from 'workbox-routing';
import { CacheFirst, NetworkFirst, NetworkOnly, StaleWhileRevalidate } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';
import { APP_VERSION } from './config/version';

declare let self: ServiceWorkerGlobalScope;

const PAGES_CACHE = `cbt-nurul-hijrah-pages-${APP_VERSION}`;
const ASSETS_CACHE = `cbt-nurul-hijrah-assets-${APP_VERSION}`;
const IMAGES_CACHE = 'cbt-nurul-hijrah-images-v1';

// Immediately activate updated Service Worker across all installed PWA & browser devices
self.skipWaiting();
clientsClaim();

cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST || []);

// Never cache dynamic backend API or SSE version endpoints
registerRoute(
  ({ url }) => url.origin === self.location.origin && url.pathname.startsWith('/api/'),
  new NetworkOnly()
);

// Always check network first for HTML navigations so installed PWAs never boot stale UI
registerRoute(
  ({ request, url }) =>
    url.origin === self.location.origin &&
    !url.pathname.startsWith('/api/') &&
    (request.mode === 'navigate' || request.destination === 'document'),
  new NetworkFirst({
    cacheName: PAGES_CACHE,
    networkTimeoutSeconds: 2,
  })
);

// Network-First for scripts & styles so online PWAs always fetch latest chunks cleanly
registerRoute(
  ({ request, url }) =>
    url.origin === self.location.origin &&
    !url.pathname.startsWith('/api/') &&
    (request.destination === 'script' || request.destination === 'style'),
  new NetworkFirst({
    cacheName: ASSETS_CACHE,
    networkTimeoutSeconds: 2,
  })
);

// Stale-While-Revalidate for static icons and images
registerRoute(
  ({ request, url }) =>
    url.origin === self.location.origin &&
    !url.pathname.startsWith('/api/') &&
    request.destination === 'image',
  new StaleWhileRevalidate({
    cacheName: IMAGES_CACHE,
  })
);

// Cache Google Fonts cleanly
registerRoute(
  ({ url }) =>
    url.origin === 'https://fonts.googleapis.com' ||
    url.origin === 'https://fonts.gstatic.com',
  new CacheFirst({
    cacheName: 'google-fonts-cache',
    plugins: [
      new ExpirationPlugin({
        maxEntries: 20,
        maxAgeSeconds: 60 * 60 * 24 * 365,
      }),
    ],
  })
);

async function purgeOutdatedRuntimeCaches(purgeAllAppCaches = false) {
  const keys = await self.caches.keys();
  await Promise.all(
    keys.map((key) => {
      if (key === 'google-fonts-cache') return Promise.resolve(false);
      if (purgeAllAppCaches) {
        return self.caches.delete(key);
      }
      // Delete any legacy or previous-version runtime caches
      if (
        key.startsWith('cbt-nurul-hijrah-') &&
        key !== PAGES_CACHE &&
        key !== ASSETS_CACHE &&
        key !== IMAGES_CACHE
      ) {
        return self.caches.delete(key);
      }
      return Promise.resolve(false);
    })
  );
}

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      await purgeOutdatedRuntimeCaches(false);
      await self.clients.claim();
      const windowClients = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });
      for (const client of windowClients) {
        client.postMessage({ type: 'SW_ACTIVATED', version: APP_VERSION });
      }
    })()
  );
});

self.addEventListener('message', (event) => {
  if (!event.data) return;
  if (event.data.type === 'SKIP_WAITING') {
    void self.skipWaiting();
  } else if (event.data.type === 'PURGE_CACHES') {
    event.waitUntil(purgeOutdatedRuntimeCaches(true));
  }
});
