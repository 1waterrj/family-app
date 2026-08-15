import type { ConfigContext } from 'expo/config';

import createAppConfig from '../app.config';

describe('CaperKeeper parent app configuration', () => {
  test('resolves the public install identity on both mobile platforms', () => {
    const resolved = createAppConfig({ config: {} } as ConfigContext);

    expect(resolved).toMatchObject({
      name: 'CaperKeeper',
      slug: 'caperkeeper-parent',
      scheme: 'caperkeeper',
      ios: { bundleIdentifier: 'net.jordanwaters.caperkeeper' },
      android: { package: 'net.jordanwaters.caperkeeper' },
    });
  });
});
