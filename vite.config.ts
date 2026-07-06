import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

// Server-side proxy target for `/api`. `BUDDY_DEV_API_TARGET` (not exposed to
// the client bundle) is used in --host mode so the browser talks to buddy only
// through this proxy — keeping API + SSE on the same origin, which is what makes
// dev mode reachable from other devices on the network.
const apiTarget =
  process.env.VITE_BUDDY_API_URL || process.env.BUDDY_DEV_API_TARGET || 'http://localhost:4966';

export default defineConfig({
  plugins: [react()],
  root: 'src/client',
  publicDir: '../../public',
  build: {
    outDir: '../../dist/client',
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      '@/types': resolve(__dirname, 'src/types'),
    },
  },
  css: {
    postcss: './postcss.config.js',
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: apiTarget,
        changeOrigin: true,
      },
    },
  },
});
