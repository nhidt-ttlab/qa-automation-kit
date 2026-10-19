import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

/**
 * Vitest ran with no config until now: the two existing specs are pure store tests, so the
 * default `node` environment was enough. Component tests need a DOM, so this adds jsdom plus the
 * jest-dom matchers that were already in devDependencies but never wired up.
 *
 * Kept separate from vite.config.ts so the dev server config and the test config can move
 * independently — the alias below is the only thing they have to agree on.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      // Resolve the workspace package to source, matching tsconfig paths, so tests do not
      // require a build of reporting-shared first.
      '@qakit/reporting-shared': path.resolve(__dirname, '../reporting-shared/src/index.ts'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: false,
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.spec.{ts,tsx}'],
  },
});
