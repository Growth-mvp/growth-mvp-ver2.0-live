module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>'],
  testMatch: ['**/*.test.ts'],
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
  },
  collectCoverageFrom: ['utils/**/*.ts', 'app/api/**/*.ts'],
  testPathIgnorePatterns: ['<rootDir>/.next/', '<rootDir>/node_modules/', '<rootDir>/.claude/worktrees/'],
};
