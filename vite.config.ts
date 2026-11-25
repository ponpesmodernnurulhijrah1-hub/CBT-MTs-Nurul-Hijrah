import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import {
  SCHEMA_VERSION,
  computeDeterministicSourceHash,
  readSourceAppVersion,
} from './buildHash';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig(() => {
  const appVersion = readSourceAppVersion(__dirname);
  const buildHash = computeDeterministicSourceHash(__dirname, appVersion);
  process.env.VITE_APP_BUILD_HASH = buildHash;

  return {
    define: {
      __APP_BUILD_HASH__: JSON.stringify(buildHash),
      'import.meta.env.VITE_APP_BUILD_HASH': JSON.stringify(buildHash),
    },
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        strategies: 'injectManifest',
        srcDir: 'src',
        filename: 'sw.ts',
        registerType: 'autoUpdate',
        injectRegister: false,
        includeAssets: [
          'icon.svg',
          'apple-touch-icon.png',
          'pwa-192x192.png',
          'pwa-512x512.png',
          'pwa-maskable-512x512.png',
        ],
        manifest: {
          id: '/',
          name: 'CBT MTs Nurul Hijrah',
          short_name: 'CBT Nurul',
          description:
            'Sistem Ujian Online CBT Real-Time, Live Proctoring & Bank Soal MTs Nurul Hijrah.',
          lang: 'id',
          dir: 'ltr',
          theme_color: '#065f46',
          background_color: '#ffffff',
          display: 'standalone',
          display_override: ['standalone', 'minimal-ui'],
          orientation: 'any',
          start_url: '/',
          scope: '/',
          prefer_related_applications: false,
          categories: ['education'],
          icons: [
            {
              src: '/pwa-192x192.png',
              sizes: '192x192',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: '/pwa-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: '/pwa-maskable-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
          ],
          shortcuts: [
            {
              name: 'Masuk Ruang Ujian',
              short_name: 'Ujian',
              url: '/',
              icons: [{ src: '/pwa-192x192.png', sizes: '192x192', type: 'image/png' }],
            },
          ],
        },
        injectManifest: {
          globPatterns: ['**/*.{js,css,ico,png,svg,woff,woff2}'],
          maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        },
        devOptions: {
          enabled: false,
          type: 'module',
        },
      }),
      // Writes dist/version.json on production build, stamps build hash, and ensures manifest link sends credentials.
      {
        name: 'write-version-manifest-and-stamp-html',
        transformIndexHtml: {
          order: 'post',
          handler(html: string): string {
            let out = html
              .replace(/__APP_BUILD_HASH__/g, buildHash)
              .replace(/__APP_VERSION__/g, appVersion);
            if (/<link\s+rel=["']manifest["'][^>]*>/i.test(out)) {
              out = out.replace(
                /<link\s+rel=["']manifest["'][^>]*>/i,
                '<link rel="manifest" href="/manifest.webmanifest" crossorigin="use-credentials" />'
              );
            } else {
              out = out.replace(
                '</head>',
                '    <link rel="manifest" href="/manifest.webmanifest" crossorigin="use-credentials" />\n  </head>'
              );
            }
            return out;
          },
        },
        closeBundle(error?: Error): void {
          if (error) return;
          const distDir = path.resolve(__dirname, 'dist');
          if (fs.existsSync(distDir)) {
            const manifest = {
              version: appVersion,
              buildHash,
              buildId: buildHash,
              schemaVersion: SCHEMA_VERSION,
              builtAt: new Date().toISOString(),
            };
            fs.writeFileSync(
              path.resolve(distDir, 'version.json'),
              JSON.stringify(manifest, null, 2),
              'utf8'
            );
          }
        },
      },
    ],
    resolve: {
      dedupe: ['react', 'react-dom'],
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    optimizeDeps: {
      include: [
        'react',
        'react-dom',
        'react-dom/client',
        'react/jsx-runtime',
        'react/jsx-dev-runtime',
        'qrcode.react',
        'recharts',
        'lucide-react',
        'firebase/app',
        'firebase/auth',
        'firebase/firestore',
        'xlsx',
        'mammoth',
        'pdfjs-dist',
        'workbox-core',
        'workbox-expiration',
        'workbox-precaching',
        'workbox-routing',
        'workbox-strategies',
      ],
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes('node_modules')) return;
            if (id.includes('firebase')) return 'vendor-firebase';
            if (id.includes('recharts') || id.includes('d3-')) return 'vendor-charts';
            if (id.includes('xlsx')) return 'vendor-xlsx';
            if (id.includes('mammoth')) return 'vendor-mammoth';
            if (id.includes('pdfjs-dist')) return 'vendor-pdfjs';
            if (id.includes('lucide-react')) return 'vendor-icons';
          },
        },
      },
    },
    server: {
      hmr: false,
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
