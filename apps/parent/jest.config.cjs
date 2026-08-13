module.exports = {
  preset: 'jest-expo',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  testMatch: ['<rootDir>/test/**/*.test.ts?(x)'],
  moduleNameMapper: {
    '^@babel/runtime/(.*)$': '<rootDir>/node_modules/@babel/runtime/$1',
    '^@family/api-client$': '<rootDir>/../../packages/api-client/src/index.ts',
    '^@family/api-client/development-credential$':
      '<rootDir>/../../packages/api-client/src/development-credential.ts',
    '^@family/api-client/(.*)$':
      '<rootDir>/../../packages/api-client/src/$1.ts',
    '^@family/contracts$': '<rootDir>/../../packages/contracts/src/index.ts',
    '^@family/design-tokens$':
      '<rootDir>/../../packages/design-tokens/src/index.ts',
    '^@family/chore-images$':
      '<rootDir>/../../packages/chore-images/src/index.ts',
    '^@family/chore-images/assets/(.*)$':
      '<rootDir>/../../packages/chore-images/assets/$1',
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
};
