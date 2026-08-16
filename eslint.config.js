// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      // NOT '**/build/**': that glob doesn't match any real build-output
      // directory in this repo (both packages emit to `dist`, per
      // vite.config.ts/tsconfig.json) but it DID silently match Agent C's
      // entire source zone, `packages/app/src/scenes/build/**` — a plain
      // `pnpm lint` was reporting a clean pass while never actually parsing
      // any file under `scenes/build/`. Fixed by Agent C (outside its file
      // zone, but necessary — see the report).
      '**/node_modules/**',
      // temporary agent worktrees: separate checkouts of this repo, linted on their own
      '.claude/**',
      '**/playwright-report/**',
      '**/test-results/**',
      'src-tauri/target/**',
      '**/*.d.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts', '**/*.tsx'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    // @karman/core must never touch the DOM — enforced again for browser-ish globals
    // that are not covered by no-restricted-globals (constructors, not identifiers).
    files: ['packages/core/src/**/*.ts'],
    rules: {
      'no-restricted-globals': [
        'error',
        { name: 'document', message: 'DOM access is forbidden in @karman/core.' },
        { name: 'window', message: 'DOM access is forbidden in @karman/core.' },
        { name: 'localStorage', message: 'DOM access is forbidden in @karman/core.' },
        { name: 'performance', message: 'DOM access is forbidden in @karman/core.' },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: "NewExpression[callee.name='Image']",
          message: 'DOM access is forbidden in @karman/core.',
        },
      ],
    },
  }
);
