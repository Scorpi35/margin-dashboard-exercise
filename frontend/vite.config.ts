import { fileURLToPath, URL } from 'node:url';

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    // jsdom for component tests; the format helpers would run happily in node.
    environment: 'jsdom',
    globals: false,
    setupFiles: ['./src/test-setup.ts'],
    restoreMocks: true,
  },
  server: {
    port: 5173,
    // Same-origin /api in development, so there is no CORS dance.
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
});
