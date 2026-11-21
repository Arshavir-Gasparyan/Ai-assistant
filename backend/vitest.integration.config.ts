import { defineConfig } from 'vitest/config';

// `npm run test:integration`: real PostgreSQL (docker compose up -d postgres).
// Uses a separate database, `knowledge_test`, so tests never touch your real data.
export default defineConfig({
  test: {
    include: ['test/integration/**/*.test.ts'],
    globalSetup: ['test/integration/global-setup.ts'],
    // Test files share one database. Run them one at a time so they don't clash.
    fileParallelism: false,
  },
});
