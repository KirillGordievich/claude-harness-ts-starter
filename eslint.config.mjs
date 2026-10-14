// ESLint runs in `make check` for the rules Oxlint does not have yet; the rules Oxlint covers are turned off here
// (eslint-plugin-oxlint reads .oxlintrc.json), so each problem is reported once and ESLint has less to do.
import js from '@eslint/js';
import oxlint from 'eslint-plugin-oxlint';
import prettier from 'eslint-plugin-prettier/recommended';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/', 'coverage/', 'node_modules/'] },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      globals: globals.node,
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/explicit-function-return-type': ['error', { allowExpressions: true }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      'no-console': 'error',
    },
  },
  {
    // plain JavaScript (config files, Claude hooks): no type information, console allowed
    files: ['**/*.{js,mjs,cjs}'],
    ...tseslint.configs.disableTypeChecked,
    rules: { ...tseslint.configs.disableTypeChecked.rules, '@typescript-eslint/explicit-function-return-type': 'off', 'no-console': 'off' },
  },
  ...oxlint.buildFromOxlintConfigFile('./.oxlintrc.json'),
  prettier,
);
