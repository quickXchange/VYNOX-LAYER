import path from 'path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

import runtimeErrorOverlay from '@replit/vite-plugin-runtime-error-modal';
import { accessGateVitePlugin } from '../../lib/production-access-gate/index.mjs';
import { publicPreparation } from '../../lib/production-access-gate/public-preparation.mjs';

const rawPort = process.env.PORT;

if (!rawPort) {
  throw new Error(
    'PORT environment variable is required but was not provided.',
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const basePath = process.env.BASE_PATH;

// Public metadata only. Native publishing must not silently emit a Development
// client or require server secrets in the browser. This does not activate Auth.
if (process.env.QXLAYER_EXTERNAL_ENVIRONMENT === 'production') {
  const ref = process.env.QXLAYER_PRODUCTION_SUPABASE_AUTH_PROJECT_REF ?? '';
  if (process.env.QXLAYER_AUTH_PROVIDER !== 'supabase' ||
      !/^[a-z0-9]{20}$/.test(ref) ||
      ['nktstksmfpcsjnjbeqsk', 'muvedavhbpgpdrrnjrih'].includes(ref) ||
      process.env.QXLAYER_PRODUCTION_SUPABASE_AUTH_URL !==
        (process.env.QXLAYER_EXTERNAL_ACCEPTANCE_APPROVED === 'true' ?
          'https://qxlayer-acceptance-vynox3.vercel.app' :
          publicPreparation(process.env) ? process.env.QXLAYER_PUBLIC_PRODUCTION_ORIGIN : 'https://www.quicklychan.xyz')) {
    throw new Error('Production build requires isolated Supabase Auth public metadata.');
  }
  process.env.VITE_QXLAYER_AUTH_PROVIDER = 'supabase';
  process.env.VITE_QXLAYER_EXTERNAL_ENVIRONMENT = 'production';
  process.env.VITE_QXLAYER_PRODUCTION_SUPABASE_AUTH_PROJECT_REF = ref;
  process.env.VITE_QXLAYER_PRODUCTION_SUPABASE_AUTH_URL = process.env.QXLAYER_PRODUCTION_SUPABASE_AUTH_URL;
}

if (!basePath) {
  throw new Error(
    'BASE_PATH environment variable is required but was not provided.',
  );
}

export default defineConfig({
  base: basePath,
  plugins: [
    accessGateVitePlugin(),
    react(),
    tailwindcss({ optimize: false }),
    runtimeErrorOverlay(),
    ...(process.env.NODE_ENV !== 'production' &&
    process.env.REPL_ID !== undefined
      ? [
          await import('@replit/vite-plugin-cartographer').then((m) =>
            m.cartographer({
              root: path.resolve(import.meta.dirname, '..'),
            }),
          ),
          await import('@replit/vite-plugin-dev-banner').then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
      '@site': path.resolve(import.meta.dirname, '..', 'private-label-website', 'src'),
      '@assets': path.resolve(
        import.meta.dirname,
        '..',
        '..',
        'attached_assets',
      ),
    },
    dedupe: ['react', 'react-dom', '@tanstack/react-query'],
  },
  optimizeDeps: {
    force: true,
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, 'dist/public'),
    emptyOutDir: true,
  },
  server: {
    port,
    strictPort: true,
    host: '0.0.0.0',
    allowedHosts: true,
    fs: {
      strict: true,
    },
  },
  preview: {
    port,
    host: '0.0.0.0',
    allowedHosts: true,
  },
});
