// React Native Testing Library 13 registers its Jest matchers automatically.

jest.mock('expo-crypto', () => {
  let sequence = 0;
  return {
    randomUUID: () =>
      `00000000-0000-4000-8000-${String(++sequence).padStart(12, '0')}`,
  };
});
