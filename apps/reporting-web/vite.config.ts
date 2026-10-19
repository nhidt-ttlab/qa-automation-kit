import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  // Build-time VITE_* values come from the deploying project's folder when it keeps its .env outside this app.
  envDir: process.env.REPORTING_WEB_ENV_DIR || __dirname,
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
    host: '0.0.0.0'
  },
  preview: {
    port: 5173,
    strictPort: true,
    host: '0.0.0.0',
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});