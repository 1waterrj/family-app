import type { ConfigContext } from 'expo/config';

import createAppConfig from '../app.config';

describe('Managed Mischief parent app configuration', () => {
  test('resolves the public install identity on both mobile platforms', () => {
    const resolved = createAppConfig({ config: {} } as ConfigContext);

    expect(resolved).toMatchObject({
      name: 'Managed Mischief',
      slug: 'managed-mischief-parent',
      scheme: 'managed-mischief',
      ios: { bundleIdentifier: 'net.jordanwaters.managedmischief' },
      android: { package: 'net.jordanwaters.managedmischief' },
    });
  });
});
