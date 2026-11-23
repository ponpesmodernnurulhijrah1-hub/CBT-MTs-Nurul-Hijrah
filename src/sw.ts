/// <reference lib="webworker" />
import { clientsClaim } from 'workbox-core';
import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching';
import { registerRoute } from 'workbox-routing';
import { CacheFirst, NetworkFirst, NetworkOnly, StaleWhileRevalidate } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';
import { APP_BUILD_HASH, APP_VERSION } from './config/version';

declare let self: ServiceWorkerGlobalScope;

const HASH_TAG = APP_BUILD_HASH.slice(0, 10);
const PAGES_CACHE = `cbt-nurul-hijrah-pages-${APP_VERSION}-${HASH_TAG}`;
const ASSETS_CACHE = `cbt-nurul-hijrah-assets-${APP_VERSION}-${HASH_TAG}`;
const IMAGES_CACHE = 'cbt-nurul-hijrah-images-v2';
const MANIFEST_CACHE = `cbt-nurul-hijrah-manifest-${APP_VERSION}-${HASH_TAG}`;

// Aggressively activate updated Service Worker across all installed PWA & browser devices
self.skipWaiting();
clientsClaim();

cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST || []);

// Never cache dynamic backend API or live version manifests (/version.json, /api/*)
registerRoute(
  ({ url }) =>
    url.origin === self.location.origin &&
    (url.pathname.startsWith('/api/') || url.pathname === '/version.json'),
  new NetworkOnly()
);

// Always check network first for manifest.webmanifest while keeping offline fallback for installability checks
registerRoute(
  ({ url }) => url.origin === self.location.origin && url.pathname === '/manifest.webmanifest',
  new NetworkFirst({
    cacheName: MANIFEST_CACHE,
    networkTimeoutSeconds: 4,
  })
);

// Always check network first for HTML navigations & start_url ('/') so installed PWAs never boot stale UI
// yet still satisfy browser offline start_url installability checks
registerRoute(
  ({ request, url }) =>
    url.origin === self.location.origin &&
    !url.pathname.startsWith('/api/') &&
    (request.mode === 'navigate' || request.destination === 'document' || url.pathname === '/'),
  new NetworkFirst({
    cacheName: PAGES_CACHE,
    networkTimeoutSeconds: 5,
  })
);

// Cache-First for immutable content-hashed Vite scripts & styles (purged on every new HASH_TAG)
registerRoute(
  ({ request, url }) =>
    url.origin === self.location.origin &&
    !url.pathname.startsWith('/api/') &&
    (request.destination === 'script' || request.destination === 'style'),
  new CacheFirst({
    cacheName: ASSETS_CACHE,
    plugins: [
      new ExpirationPlugin({
        maxEntries: 80,
        maxAgeSeconds: 60 * 60 * 24 * 30,
      }),
    ],
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

async function purgeOutdatedRuntimeCaches(purgeAllAppCaches = false): Promise<boolean> {
  const keys = await self.caches.keys();
  const hadStaleCaches = keys.some(
    (key) =>
      (key.startsWith('cbt-nurul-hijrah-') || key.startsWith('workbox-')) &&
      key !== PAGES_CACHE &&
      key !== ASSETS_CACHE &&
      key !== IMAGES_CACHE &&
      key !== MANIFEST_CACHE &&
      !key.includes(HASH_TAG)
  );
  await Promise.all(
    keys.map((key) => {
      if (key === 'google-fonts-cache') return Promise.resolve(false);
      if (purgeAllAppCaches) {
        return self.caches.delete(key);
      }
      if (
        (key.startsWith('cbt-nurul-hijrah-') || key.startsWith('workbox-')) &&
        key !== PAGES_CACHE &&
        key !== ASSETS_CACHE &&
        key !== IMAGES_CACHE &&
        key !== MANIFEST_CACHE &&
        !key.includes('workbox-precache')
      ) {
        return self.caches.delete(key);
      }
      return Promise.resolve(false);
    })
  );
  return hadStaleCaches;
}

function pingWindowClientVersion(client: WindowClient, timeoutMs = 850): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      const channel = new MessageChannel();
      const timer = setTimeout(() => {
        try {
          channel.port1.close();
        } catch {
          // Ignore close errors
        }
        resolve(null);
      }, timeoutMs);

      channel.port1.onmessage = (ev) => {
        clearTimeout(timer);
        try {
          channel.port1.close();
        } catch {
          // Ignore close errors
        }
        const replyHash =
          ev.data && typeof ev.data.buildHash === 'string' ? ev.data.buildHash : null;
        resolve(replyHash);
      };

      client.postMessage(
        { type: 'PING_CLIENT_VERSION', version: APP_VERSION, buildHash: APP_BUILD_HASH },
        [channel.port2]
      );
    } catch {
      resolve(null);
    }
  });
}

async function fetchWithSwTimeout(url: string, timeoutMs = 4000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(new Request(url, { cache: 'reload', credentials: 'same-origin' }), {
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

async function warmStartUrlAndManifest(): Promise<void> {
  try {
    const pagesCache = await self.caches.open(PAGES_CACHE);
    const rootRes = await fetchWithSwTimeout('/', 4000);
    if (rootRes.ok) {
      await pagesCache.put('/', rootRes.clone());
    }
  } catch {
    // Ignore transient offline/timeout errors during install warm-up
  }
  try {
    const manifestCache = await self.caches.open(MANIFEST_CACHE);
    const manifestRes = await fetchWithSwTimeout('/manifest.webmanifest', 4000);
    if (manifestRes.ok) {
      await manifestCache.put('/manifest.webmanifest', manifestRes.clone());
    }
  } catch {
    // Ignore transient offline/timeout errors during install warm-up
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(warmStartUrlAndManifest());
  void self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const hadStaleCaches = await purgeOutdatedRuntimeCaches(false);
      await self.clients.claim();
      const windowClients = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });

      await Promise.all(
        windowClients.map(async (client) => {
          client.postMessage({
            type: 'SW_ACTIVATED',
            version: APP_VERSION,
            buildHash: APP_BUILD_HASH,
          });

          // If a legacy installed PWA runs ancient cached JS that ignores SW_ACTIVATED,
          // it won't answer PING_CLIENT_VERSION with APP_BUILD_HASH -> force navigate to bustUrl.
          if (client.url.includes(`_pwa_v=${APP_BUILD_HASH}`)) return;
          const clientHash = await pingWindowClientVersion(client);
          if (clientHash === APP_BUILD_HASH) return;

          if (hadStaleCaches && !clientHash) {
            try {
              const target = new URL(client.url);
              target.searchParams.set('_pwa_v', APP_BUILD_HASH);
              await client.navigate(target.toString());
            } catch {
              // Some platforms disallow navigate() on background tabs; reload happens on focus via NetworkFirst
            }
          }
        })
      );
    })()
  );
});

self.addEventListener('message', (event) => {
  if (!event.data) return;
  if (event.data.type === 'SKIP_WAITING') {
    void self.skipWaiting();
  } else if (event.data.type === 'PURGE_CACHES') {
    event.waitUntil(purgeOutdatedRuntimeCaches(true));
  } else if (event.data.type === 'PING_VERSION_HEARTBEAT') {
    const reply = {
      type: 'VERSION_HEARTBEAT_REPLY',
      version: APP_VERSION,
      buildHash: APP_BUILD_HASH,
    };
    if (event.ports && event.ports[0]) {
      event.ports[0].postMessage(reply);
    } else if (event.source && 'postMessage' in event.source) {
      event.source.postMessage(reply);
    }
  }
});
