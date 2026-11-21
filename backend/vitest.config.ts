import { defineConfig } from 'vitest/config';

// `npm test`: fast unit tests. No Docker, no network. Integration tests have their own config.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    exclude: ['test/integration/**', 'node_modules/**'],
  },
});
