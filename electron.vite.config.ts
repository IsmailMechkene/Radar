import { resolve } from 'node:path';
import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        // The passes worker is its own entry: main starts it with new Worker(<out>/passes-worker.js).
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
          'passes-worker': resolve(__dirname, 'src/main/passes-worker.ts'),
        },
      },
    },
  },
  preload: {
    build: {
      // Sandboxed preloads can only require 'electron', so bundle everything else (zod).
      externalizeDeps: false,
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/preload/index.ts') },
      },
    },
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    plugins: [react(), tailwindcss()],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/renderer/index.html') },
      },
    },
  },
});
