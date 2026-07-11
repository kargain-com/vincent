import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['eslint.config.js', '**/dist/**', '**/coverage/**', '**/node_modules/**', 'compiler/scripts/**', 'packages/vincent/src/wmi-core.generated.ts', 'packages/vincent/src/wmi-extended.generated.ts'] },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        project: [
          'packages/vincent/tsconfig.eslint.json',
          'pipeline/tsconfig.eslint.json',
          'compiler/tsconfig.eslint.json',
        ],
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ['packages/**/src/**/*.ts', 'compiler/src/**/*.ts'],
    rules: {
      'no-console': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@noble/hashes',
              message: 'Import @noble/hashes only from packages/vincent/src/protocol/crypto.ts',
            },
            {
              name: '@noble/curves',
              message: 'Import @noble/curves only from packages/vincent/src/protocol/crypto.ts',
            },
          ],
          patterns: [
            {
              group: ['@noble/hashes/*', '@noble/curves/*'],
              message: 'Import @noble/* only from packages/vincent/src/protocol/crypto.ts',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['packages/vincent/src/protocol/crypto.ts'],
    rules: {
      'no-restricted-imports': 'off',
    },
  },
);
