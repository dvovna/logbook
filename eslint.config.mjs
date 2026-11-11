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

    // The typescript-eslint version of the core rule: it can let type-only
    // imports through.
    'no-restricted-imports': 'off',
    '@typescript-eslint/no-restricted-imports': ['error', {
      patterns: [{
        group: ['../*'],
        message: 'Relative parent imports (..) are forbidden. Use same-level (./) or absolute imports (@libs, @apps).',
      }, {
        // Bolt is a devDependency, missing from the production image: a value
        // import builds and passes the tests, then crashes the app at startup.
        group: ['@slack/bolt', '@slack/bolt/*'],
        allowTypeImports: true,
        message: '@slack/bolt is a devDependency and not in the production image: import its types with `import type`.',
      }],
    }],

    // The Slack UI in src/slack (tabs, handlers, views, approvals) uses the
    // domain, never the other way round. Code both need belongs in the domain
    // module or in src/common.
    'import/no-restricted-paths': ['error', {
      zones: [{
        target: [
          './src/clients',
          './src/holidays',
          './src/projects',
          './src/slack-teams',
          './src/teams',
          './src/team-file',
          './src/time-entries',
          './src/time-off-logging',
          './src/users',
          './src/vacation-policies',
          './src/vacation-requests',
          './src/request-workflows',
          './src/common',
          './src/slack-communication',
          './src/api-clients',
          './src/database',
        ],
        from: './src/slack',
        message: 'Domain and shared code must not depend on the Slack UI (src/slack): move what both need into the domain module or src/common.',
      }, {
        // Shared code depends on no feature module: what needs one lives with
        // it (e.g. the Slack request guards in src/slack/guards).
        target: './src/common',
        from: [
          './src/clients',
          './src/holidays',
          './src/projects',
          './src/request-workflows',
          './src/slack-communication',
          './src/slack-teams',
          './src/team-setup',
          './src/teams',
          './src/team-file',
          './src/time-entries',
          './src/time-off-logging',
          './src/user-data-import',
          './src/users',
          './src/vacation-policies',
          './src/vacation-requests',
        ],
        message: 'src/common must not depend on feature modules: move the code to the module that needs it.',
      }, {
        // Queries live in repositories and query classes, which scope them to
        // a workspace (SqlRepository). Services, handlers and the Slack UI
        // group repository calls with TransactionService instead.
        target: [
          './src/!(database)/**/*.service.ts',
          './src/**/*.handler.ts',
          './src/slack/**',
        ],
        from: './src/database/database.service.ts',
        message: 'Only repositories and query classes use DatabaseService: put the query in a repository, and use TransactionService for transactions.',
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
  // A vacation request's edit or deletion can leave its logged time behind:
  // only TimeOffChangesService, which removes that time in the same
  // transaction, uses the writes it is built from.
  files: ['src/**/*.ts'],
  ignores: ['src/vacation-requests/**', 'src/time-off-logging/**'],
  rules: {
    'no-restricted-properties': ['error', {
      property: 'applyUpdate',
      message: 'Change a vacation request through TimeOffChangesService.update, which removes its logged time with it.',
    }, {
      property: 'applyDelete',
      message: 'Delete a vacation request through TimeOffChangesService.delete, which removes its logged time with it.',
    }],
  },
}, {
  files: ['bin/**/*.ts'],
  rules: {
    '@typescript-eslint/no-restricted-imports': 'off',
  },
},
// Reports code Prettier would format differently, and turns off the ESLint
// rules that disagree with it. Keep it last.
prettierRecommended,
];
