import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    target: 'esnext',
    chunkSizeWarningLimit: 2000,
  },
  server: {
    host: '127.0.0.1',
  },
});
