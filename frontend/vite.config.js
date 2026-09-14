import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // The React UI talks to the backend through the same origin (no CORS issues).
      '/api': { target: 'http://localhost:4000', changeOrigin: true },
    },
  },
});