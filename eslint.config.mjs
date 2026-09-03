import js from '@eslint/js'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: [
      'out/**',
      'dist/**',
      'node_modules/**',
      'scripts/fix-node-pty-permissions.cjs',
      'src/main/engine/real-process-adapter.fake-cli.cjs'
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
