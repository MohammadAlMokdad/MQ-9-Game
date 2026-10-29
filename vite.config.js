import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: { open: !process.env.NO_OPEN },
  build: { chunkSizeWarningLimit: 1200 },
});
