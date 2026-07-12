import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/validate-full-sim.integration.test.ts'],
  },
});
