import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['eslint.config.js', '**/dist/**', '**/coverage/**', '**/node_modules/**', 'packages/vincent/src/wmi-core.generated.ts', 'packages/vincent/src/wmi-extended.generated.ts'] },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        project: [
          'packages/vincent/tsconfig.eslint.json',
          'pipeline/tsconfig.eslint.json',
        ],
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ['packages/**/src/**/*.ts'],
    rules: {
      'no-console': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
);
