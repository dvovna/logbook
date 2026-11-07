import typescriptEslint from '@typescript-eslint/eslint-plugin';
import importPlugin from 'eslint-plugin-import';
import checkFile from 'eslint-plugin-check-file';
import tsParser from '@typescript-eslint/parser';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import js from '@eslint/js';
import { FlatCompat } from '@eslint/eslintrc';
import prettierRecommended from 'eslint-plugin-prettier/recommended';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const compat = new FlatCompat({
  baseDirectory: __dirname,
  recommendedConfig: js.configs.recommended,
  allConfig: js.configs.all
});

export default [{
  ignores: [
    '**/node_modules/',
    '**/build/',
    '**/dist/',
    '**/coverage/',
    '**/*.min.js',
    '**/*.js',
    '**/*.js',
    '**/*.mjs',
    '**/migrations/',
    '.history/',
    '**/database.types.ts'
  ],
}, ...compat.extends(
  'eslint:recommended',
  'plugin:@typescript-eslint/eslint-recommended',
  'plugin:@typescript-eslint/recommended',
), {
  plugins: {
    '@typescript-eslint': typescriptEslint,
    'import': importPlugin,
    'check-file': checkFile,
  },

  settings: {
    'import/resolver': {
      typescript: {
        project: ['./tsconfig.json'],
        alwaysTryTypes: true,
      },
      node: {
        extensions: ['.ts', '.tsx', '.js', '.jsx', '.mjs'],
      },
    },
  },

  languageOptions: {
    parser: tsParser,
  },

  // Formatting (quotes, commas, indent, line breaks) is Prettier's: see
  // .prettierrc and the prettier config at the end.
  rules: {
    eqeqeq: 'warn',
    'no-cond-assign': ['warn', 'always'],
    'no-unused-vars': 'off',
    'no-console': 'warn',
    strict: ['error', 'safe'],

    '@typescript-eslint/naming-convention': ['error', {
      selector: 'interface',
      format: ['PascalCase'],

      custom: {
        regex: '^I[A-Z]',
        match: true,
      },
    }],

    '@typescript-eslint/no-var-requires': 'off',
    '@typescript-eslint/explicit-module-boundary-types': 'off',
    '@typescript-eslint/no-non-null-assertion': 'off',
    '@typescript-eslint/no-unused-vars': ['off', { varsIgnorePattern: '^_' }],

    'object-shorthand': ['error', 'always', {
      avoidQuotes: true,
    }],

    'check-file/filename-naming-convention': ['error', { '**/*.{ts,tsx}': 'KEBAB_CASE' }, {
      ignoreMiddleExtensions: true,
    }],

    'no-restricted-imports': ['error', {
      patterns: [{
        group: ['../*'],
        message: 'Relative parent imports (..) are forbidden. Use same-level (./) or absolute imports (@libs, @apps).',
      }],
    }],

    'import/no-relative-packages': 'error',
    'import/no-cycle': ['error', {
      maxDepth: 10,
      ignoreExternal: true,
    }],
    'no-restricted-syntax': [
      'off',
      {
        selector: 'ExportAllDeclaration',
        message: 'Avoid export *, use named exports for better tree-shaking and clarity',
      },
    ],
  },
}, {
  files: ['bin/**/*.ts'],
  rules: {
    'no-restricted-imports': 'off',
  },
},
// Reports code Prettier would format differently, and turns off the ESLint
// rules that disagree with it. Keep it last.
prettierRecommended,
];
