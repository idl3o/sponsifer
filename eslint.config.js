// Lint rules, including two house rules made mechanical: no function over
// 50 lines and no module over 500. Tests are exempt from the function limit,
// because a describe block is a list of cases, not a function to read.
import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig(
  { ignores: ['dist/', 'dist-site/', 'python/', '.venv/', 'playtest-shots/'] },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
      'max-lines-per-function': ['error', { max: 50 }],
      'max-lines': ['error', { max: 500 }],
    },
  },
  {
    files: ['src/**/*.test.{ts,tsx}'],
    rules: { 'max-lines-per-function': 'off' },
  },
  {
    files: ['scripts/**/*.mjs', '*.config.{js,ts}'],
    languageOptions: { globals: globals.node },
  },
  {
    // The play test hands callbacks to page.evaluate, which run in the browser.
    files: ['scripts/playtest.mjs'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
);
