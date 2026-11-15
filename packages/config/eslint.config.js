// Shared flat ESLint config. Safety rules here are part of the product's
// guarantees (SECURITY.md S3, S10), not style.
import tseslint from 'typescript-eslint';
import globals from 'globals';

/** Surfaces that must never touch research-only code (rule 2.8). */
export const NON_RESEARCH_SURFACES = [
  'apps/web/**',
  'apps/sponsor/**',
  // Every API module that serves a care, ops or sponsor surface. Only apps/api/src/research and
  // the worker may import research code.
  ...['actions', 'auth', 'calls', 'desk', 'events', 'family', 'medicines', 'sponsor', 'system'].map(
    (d) => `apps/api/src/${d}/**`,
  ),
];

const researchImportBan = {
  files: NON_RESEARCH_SURFACES.flatMap((g) => [`${g}/*.ts`, `${g}/*.tsx`, `**/${g}/*.ts`, `**/${g}/*.tsx`]),
  rules: {
    'no-restricted-imports': [
      'error',
      {
        patterns: [
          {
            group: ['@tomoni/research', '@tomoni/research/*', '**/packages/research/**'],
            message:
              'Research-only code is not allowed on care or sponsor surfaces (BUILD_PROMPT rule 2.8, SECURITY S3).',
          },
        ],
      },
    ],
  },
};

const noRawHtml = {
  files: ['**/*.tsx', '**/*.jsx'],
  rules: {
    'no-restricted-syntax': [
      'error',
      {
        selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']",
        message: 'Raw HTML is banned (SECURITY S10). Render text, or add a reviewed sanitizer component.',
      },
    ],
  },
};

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/.turbo/**',
      '**/coverage/**',
      '**/storybook-static/**',
      '**/drizzle/meta/**',
      '**/next-env.d.ts',
      '**/*.config.{js,mjs,cjs}',
      '**/test/fixtures/**',
    ],
  },
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
      'no-console': ['error', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'always'],
    },
  },
  researchImportBan,
  noRawHtml,
);
