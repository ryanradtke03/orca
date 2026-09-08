import js from '@eslint/js'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: [
      'out/**',
      'dist/**',
      'node_modules/**',
      // Agent scratch worktrees - separate git checkouts that carry their own
      // tsconfig/eslint config, which otherwise makes the TS parser's root
      // detection ambiguous and breaks linting for the whole repo.
      '.claude/**',
      'scripts/fix-node-pty-permissions.cjs',
      'src/main/engine/claude-cli/fake-cli.cjs'
    ]
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module'
      }
    }
  }
)
