import { fileURLToPath } from 'node:url';
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
        'src/wmi-core.generated.ts',
        'src/wmi-extended.generated.ts',
        // Vendored third-party inflate (tiny-inflate); validated via lookupWmi integration
        'src/inflate.vendored.ts',
        // sqlite-wasm glue; decode logic covered via DatasetDb mocks
        'src/decoder/sqlite-db.ts',
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
    alias: [
      {
        find: '@kargain/vincent/decoder',
        replacement: fileURLToPath(new URL('./src/decoder-export.ts', import.meta.url)),
      },
      {
        find: '@kargain/vincent/wmi',
        replacement: fileURLToPath(new URL('./src/wmi-export.ts', import.meta.url)),
      },
      {
        find: '@kargain/vincent/protocol',
        replacement: fileURLToPath(new URL('./src/protocol/index.ts', import.meta.url)),
      },
      {
        find: '@kargain/vincent',
        replacement: fileURLToPath(new URL('./src/index.ts', import.meta.url)),
      },
    ],
  },
});
