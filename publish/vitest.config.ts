import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    exclude: [...configDefaults.exclude, 'test/validate-full-sim.integration.test.ts'],
    coverage: {
      provider: 'v8',
      include: [
        'src/publish-epoch.ts',
        'src/resolve-epoch-parent.ts',
        'src/adapters/sha256-bytes32.ts',
      ],
      exclude: ['src/cli/**', 'src/adapters/irys-devnet-uploader.ts'],
      thresholds: {
        statements: 100,
        branches: 100,
        functions: 100,
        lines: 100,
      },
    },
  },
});
