import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'coverage/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      eqeqeq: ['error', 'always'],
      curly: ['error', 'all'],
      'no-console': 'error',
    },
  },
  {
    files: ['homebridge-ui/**/*.js', '*.js', '*.mjs'],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    files: ['homebridge-ui/public/**/*.js'],
    languageOptions: { globals: { ...globals.browser, homebridge: 'readonly' } },
  },
);

