import js from '@eslint/js';
import globals from 'globals';

// Vendor libraries are classic scripts that define browser globals.
const vendor = {
  L: 'readonly',
  maplibregl: 'readonly',
  topojson: 'readonly'
};

export default [
  {
    ignores: ['_site/', 'node_modules/', 'vendor/', 'assets/vendor/', 'assets/data/', 'archive/']
  },
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.browser, ...vendor }
    },
    rules: {
      'no-unused-vars': ['error', { caughtErrors: 'none' }],
      // Storage access can throw in private windows; those failures are ignored.
      'no-empty': ['error', { allowEmptyCatch: true }],
      // Correctness and clarity, following the Airbnb and Google style guides.
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      curly: ['error', 'multi-line'],
      'no-var': 'error',
      'prefer-const': 'error',
      'object-shorthand': 'error',
      'prefer-template': 'error',
      'no-implicit-coercion': 'error',
      'no-nested-ternary': 'error',
      'no-param-reassign': 'error',
      'no-shadow': 'error',
      'no-use-before-define': ['error', { functions: false, classes: true, variables: true }],
      'consistent-return': 'error',
      'no-promise-executor-return': 'error',
      'no-console': ['error', { allow: ['warn', 'error'] }],
      'max-params': ['error', 4],
      'max-depth': ['error', 4],
      complexity: ['error', 15],
      'max-lines-per-function': ['error', { max: 80, skipBlankLines: true, skipComments: true }]
    }
  },
  {
    // Runs in <head> before first paint, so it stays a classic script.
    files: ['assets/js/navigation.js'],
    languageOptions: { sourceType: 'script' }
  },
  {
    files: ['*.config.js', 'tests/**/*.js'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: { 'no-console': 'off' }
  }
];
