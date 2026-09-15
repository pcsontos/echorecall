// @nuxt/eslint generates the base flat config under .nuxt after `nuxt prepare`.
import withNuxt from './.nuxt/eslint.config.mjs'

export default withNuxt({
  rules: {
    // Domain code is strict TS; allow explicit, justified exceptions only.
    '@typescript-eslint/no-explicit-any': 'error',
  },
}).append({
  ignores: ['**/node_modules/**', 'dist/**', 'build/**', 'coverage/**', '**/*.min.js'],
})
