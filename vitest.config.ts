import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: { include: ['packages/*/src/**/*.test.ts', 'importers/*/src/**/*.test.ts', 'connectors/*/src/**/*.test.ts', 'apps/*/src/**/*.test.ts'], testTimeout: 20000, setupFiles: ['./vitest.setup.ts'] },
});
