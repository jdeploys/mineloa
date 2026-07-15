import js from '@eslint/js'
import babelParser from '@babel/eslint-parser'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'

const typedLanguageOptions = {
  parser: babelParser,
  parserOptions: {
    requireConfigFile: false,
    sourceType: 'module',
    babelOptions: {
      babelrc: false,
      configFile: false,
      presets: [
        ['@babel/preset-typescript', { allExtensions: true, isTSX: true }],
        ['@babel/preset-react', { runtime: 'automatic' }],
      ],
    },
  },
}

export default [
  {
    ignores: [
      'node_modules/**', 'out/**', 'dist/**', 'test-results/**', 'playwright-report/**',
      '.worktrees/**', '.superpowers/**', 'tests/visual/snapshots/**',
      'build/icons/**', 'tests/e2e/fixtures/**',
    ],
  },
  {
    files: ['**/*.{js,mjs,ts,tsx}'],
    ...js.configs.recommended,
    languageOptions: {
      ...typedLanguageOptions,
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      // Babel removes TypeScript-only references before ESLint's core rule
      // sees them, so unused symbols remain TypeScript's responsibility.
      'no-unused-vars': 'off',
      'react-hooks/rules-of-hooks': 'error',
    },
  },
]
