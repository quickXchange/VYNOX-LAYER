import path from 'path';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

import runtimeErrorOverlay from '@replit/vite-plugin-runtime-error-modal';
import { accessGateVitePlugin } from '../../lib/production-access-gate/index.mjs';

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

if (!basePath) {
  throw new Error(
    'BASE_PATH environment variable is required but was not provided.',
  );
}

// Deterministic source fingerprint, with no environment variables or secret material.
const buildHash = createHash('sha256');
function hashSource(directory: string) {
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) hashSource(file);
    else { buildHash.update(path.relative(import.meta.dirname, file)); buildHash.update(readFileSync(file)); }
  }
}
hashSource(path.resolve(import.meta.dirname, 'src'));
hashSource(path.resolve(import.meta.dirname, '../../lib/api-client-react/src'));
buildHash.update(readFileSync(new URL(import.meta.url)));
const websiteBuildId = `site-${buildHash.digest('hex').slice(0, 16)}`;

export default defineConfig({
  base: basePath,
  define: { __QX_SITE_BUILD_ID__: JSON.stringify(websiteBuildId) },
  plugins: [
    accessGateVitePlugin(),
    react(),
    tailwindcss(),
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
      '@assets': path.resolve(
        import.meta.dirname,
        '..',
        '..',
        'attached_assets',
      ),
    },
    // Workspace hooks and this app must share the same QueryClient context,
    // even when pnpm resolves separate React peer dependency variants.
    dedupe: ['react', 'react-dom', '@tanstack/react-query'],
  },
  optimizeDeps: { force: true },
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
      deny: ["**/.env", "**/.env.*", "**/*.{crt,pem}", "**/.git/**", "**/generated-artifacts/**", "**/deploy/env/**"],
    },
  },
  preview: {
    port,
    host: '0.0.0.0',
    allowedHosts: true,
  },
});
