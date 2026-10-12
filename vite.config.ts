import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0', port: 5173,
    allowedHosts: ['.e2b.app', 'localhost'],
    proxy: {
      '/api': { target: 'http://127.0.0.1:8080', changeOrigin: false },
      '/healthz': 'http://127.0.0.1:8080',
      '/readyz': 'http://127.0.0.1:8080',
      '/voice/browser': { target: 'ws://127.0.0.1:8080', ws: true, changeOrigin: false }
    }
  }
});
