import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['src/publish-genesis.ts', 'src/adapters/sha256-bytes32.ts'],
      exclude: ['src/cli/**', 'src/adapters/irys-devnet-uploader.ts', 'src/adapters/base-sepolia-publisher.ts'],
      thresholds: {
        statements: 100,
        branches: 100,
        functions: 100,
        lines: 100,
      },
    },
  },
});
