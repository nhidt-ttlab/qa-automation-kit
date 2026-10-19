import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

/**
 * Testing Library registers its own auto-cleanup only when Vitest globals are enabled. This
 * project keeps `globals: false` (the existing specs import `describe`/`it`/`expect` explicitly),
 * so cleanup has to be wired by hand — without it the DOM accumulates across tests in a file and
 * every `getByText` in the second test onward fails with "found multiple elements".
 */
afterEach(() => {
  cleanup();
});
