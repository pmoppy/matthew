import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ortVersion: string = JSON.parse(
  readFileSync(new URL('./node_modules/onnxruntime-web/package.json', import.meta.url), 'utf8'),
).version;

const isolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'credentialless',
};

export default defineConfig(({ mode }) => {
  // "capacitor" = the Android APK build: everything is bundled inside the app,
  // so the ONNX Runtime WASM ships locally and no service worker is needed.
  const native = mode === 'capacitor';
  return {
  plugins: [
    react(),
    VitePWA({
      disable: native,
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'ShelfScan – shelf & top-seller checker',
        short_name: 'ShelfScan',
        description: 'Photograph a shelf, identify every product and get top-seller recommendations.',
        theme_color: '#26374f',
        background_color: '#f3efe7',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        // The ONNX Runtime WASM binaries are large; cache them at runtime instead of precaching.
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.hostname === 'cdn.jsdelivr.net' && url.pathname.includes('/onnxruntime-web@'),
            handler: 'CacheFirst',
            options: { cacheName: 'ort-runtime', expiration: { maxEntries: 8 } },
          },
        ],
      },
    }),
  ],
  // Use the non-bundled ORT build so its ~28 MB WASM binary is not copied into
  // dist (Cloudflare Pages caps files at 25 MB). It is fetched from jsDelivr on
  // first use and cached by the service worker for offline use.
  resolve: {
    alias: native
      ? []
      : [
          {
            find: /^onnxruntime-web\/webgpu$/,
            replacement: fileURLToPath(new URL('./node_modules/onnxruntime-web/dist/ort.webgpu.min.mjs', import.meta.url)),
          },
        ],
  },
  define: {
    __ORT_WASM_BASE__: JSON.stringify(native ? '' : `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ortVersion}/dist/`),
    __NATIVE__: JSON.stringify(native),
    __BUILD_NUMBER__: JSON.stringify(Number(process.env.VITE_BUILD_NUMBER || 0)),
    __REPO__: JSON.stringify(process.env.GITHUB_REPOSITORY || 'pmoppy/matthew'),
  },
  optimizeDeps: { exclude: ['onnxruntime-web'] },
  server: { headers: isolation },
  preview: { headers: isolation },
};
});
