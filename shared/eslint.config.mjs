import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**'] },
  {
    // Anchored explicitly, because every workspace config registers its own
    // directory as a candidate root and the candidate list is process-wide. An
    // editor's language server lints files from several workspaces in one
    // process, so it ends up with more than one candidate and typescript-eslint
    // refuses to guess: "No tsconfigRootDir was set, and multiple candidate
    // TSConfigRootDirs are present". Setting it skips the inference entirely.
    languageOptions: {
      parserOptions: {
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  // Must stay last: disables the stylistic rules that would fight Prettier.
  prettier,
);
