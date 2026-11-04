const ESM_PACKAGES = [
  'bail', 'ccount', 'character-entities', 'decode-named-character-reference', 'devlop',
  'escape-string-regexp', 'is-plain-obj', 'longest-streak', 'markdown-table',
  'mdast-util-[^/]+', 'micromark', 'micromark-[^/]+', 'remark', 'remark-gfm', 'remark-parse',
  'remark-stringify', 'trough', 'unified', 'unist-util-[^/]+', 'vfile', 'vfile-message', 'zwitch',
  'react-markdown', 'remark-rehype', 'hast-util-[^/]+', 'estree-util-[^/]+', 'property-information',
  'comma-separated-tokens', 'space-separated-tokens', 'style-to-js', 'style-to-object',
  'inline-style-parser', 'html-url-attributes', 'trim-lines', 'html-void-elements',
];

module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>'],
  testMatch: ['**/*.test.ts', '**/*.test.tsx'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
  },
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        tsconfig: {
          jsx: 'preserve',
          jsxImportSource: 'react',
          noEmit: true,
        },
      },
    ],
    '^.+\\.tsx$': '<rootDir>/jest.tsx-transform.cjs',
    '^.+\\.js$': [
      'ts-jest',
      {
        tsconfig: {
          allowJs: true,
          module: 'commonjs',
          noEmit: false,
        },
      },
    ],
  },
  transformIgnorePatterns: [`/node_modules/(?!(${ESM_PACKAGES.join('|')})/)`],
  collectCoverageFrom: ['utils/**/*.ts', 'app/api/**/*.ts'],
  testPathIgnorePatterns: ['<rootDir>/.next/', '<rootDir>/node_modules/', '<rootDir>/.claude/worktrees/'],
};
