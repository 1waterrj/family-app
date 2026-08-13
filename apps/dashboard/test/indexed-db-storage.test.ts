import { createIndexedDbStorage } from '../src/query/indexed-db-storage';

describe('dashboard IndexedDB storage identity', () => {
  test('shares one explicit coordination identity across adapter instances', () => {
    // Break caught: production remounts create wrappers that cannot identify their shared durable IndexedDB backend.
    const first = createIndexedDbStorage();
    const second = createIndexedDbStorage();

    expect(first.coordinationIdentity).toBeDefined();
    expect(second.coordinationIdentity).toBe(first.coordinationIdentity);
  });
});
