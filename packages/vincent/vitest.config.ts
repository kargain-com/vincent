import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        // Auto-generated static data — no executable logic to cover
        'src/wmi.generated.ts',
        // Vendored third-party inflate (tiny-inflate); validated via lookupWmi integration
        'src/inflate.vendored.ts',
      ],
      thresholds: {
        statements: 100,
        branches: 100,
        functions: 100,
        lines: 100,
      },
    },
  },
  resolve: {
    alias: {
      '@kargain/vincent': new URL('./src/index.ts', import.meta.url).pathname,
    },
  },
});
