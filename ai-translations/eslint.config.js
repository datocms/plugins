// ESLint flat config (v9+)
import tsParser from '@typescript-eslint/parser';
import jsdoc from 'eslint-plugin-jsdoc';
import tsdoc from 'eslint-plugin-tsdoc';

export default [
  {
    ignores: [
      'dist/**',
      'coverage/**',
      'node_modules/**',
      'vite.config.ts',
      'vitest.config.ts',
      'pnpm-lock.yaml',
      'src/components/**',
      'src/entrypoints/**',
      'src/prompts/**',
      'src/main.tsx',
    ],
  },
  // Global base for TS files (no strict rules here)
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 'latest',
      sourceType: 'module',
    },
    plugins: { jsdoc, tsdoc },
    rules: {
      'tsdoc/syntax': 'off',
      'jsdoc/require-jsdoc': 'off',
      'jsdoc/check-tag-names': 'off',
      'jsdoc/check-param-names': 'off',
      'jsdoc/require-param': 'off',
      'jsdoc/require-returns': 'off',
      'jsdoc/require-description': 'off',
    },
  },
  // Strict docs only for core logic in utils (excluding logging)
  {
    files: ['src/utils/**/*.ts', 'src/utils/**/*.tsx', '!src/utils/logging/**'],
    plugins: { jsdoc, tsdoc },
    rules: {
      'tsdoc/syntax': 'error',
      'jsdoc/require-jsdoc': [
        'error',
        {
          publicOnly: true,
          contexts: [
            'ClassDeclaration',
            'MethodDefinition',
            'FunctionDeclaration',
            'TSInterfaceDeclaration',
            'TSTypeAliasDeclaration',
            'TSEnumDeclaration',
          ],
        },
      ],
      'jsdoc/check-tag-names': 'error',
      'jsdoc/check-param-names': 'off',
      'jsdoc/require-param': ['error', { checkDestructured: false }],
      'jsdoc/require-returns': 'error',
      'jsdoc/require-description': 'error',
    },
    settings: { jsdoc: { mode: 'typescript' } },
  },
  // Turn off docs enforcement inside logging utilities (internal-only)
  {
    files: ['src/utils/logging/**'],
    rules: {
      'tsdoc/syntax': 'off',
      'jsdoc/require-jsdoc': 'off',
      'jsdoc/require-param': 'off',
      'jsdoc/require-returns': 'off',
      'jsdoc/check-param-names': 'off',
      'jsdoc/check-tag-names': 'off',
      'jsdoc/require-description': 'off',
    },
  },
];
