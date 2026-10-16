import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import prettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig(
  { ignores: ['out/', 'dist/', 'release/', 'node_modules/', 'design/'] },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    languageOptions: { globals: globals.node },
    rules: {
      // `_name` marks an intentionally unused binding; rest siblings drop fields (e.g. `raw`).
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],
    },
  },
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    extends: [reactHooks.configs.flat.recommended],
    languageOptions: { globals: globals.browser },
  },
  {
    // Ground rule: core must run headless under plain Node.
    files: ['src/core/**/*.ts', 'src/cli.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [{ name: 'electron', message: 'src/core must never import Electron.' }],
          patterns: [
            { group: ['electron/*'], message: 'src/core must never import Electron.' },
            {
              group: ['**/main/**', '**/renderer/**'],
              message: 'src/core must not depend on app layers.',
            },
          ],
        },
      ],
    },
  },
  prettier,
);
