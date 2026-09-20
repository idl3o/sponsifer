/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // `npm run dev:api` serves the workspace on 5181. Without it, /api fails and
  // the app runs from this browser's copy alone.
  server: { port: 5180, proxy: { '/api': { target: 'http://127.0.0.1:5181', changeOrigin: true } } },
  // The OBS overlay is its own page, so a browser source loads nothing of the app. The dock is a third:
  // a panel inside OBS that reads the same workspace and starts the logger.
  build: { rollupOptions: { input: { app: 'index.html', overlay: 'overlay.html', dock: 'dock.html' } } },
  test: {
    // Domain tests run in node; component tests need a DOM. Vitest 4 dropped
    // environmentMatchGlobs, so the split is two projects sharing this config.
    projects: [
      { extends: true, test: { name: 'domain', environment: 'node', include: ['src/**/*.test.ts'] } },
      { extends: true, test: { name: 'components', environment: 'jsdom', include: ['src/**/*.test.tsx'] } },
    ],
  },
});
