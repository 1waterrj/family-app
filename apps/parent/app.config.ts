import type { ConfigContext, ExpoConfig } from 'expo/config';

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'CaperKeeper',
  slug: 'caperkeeper-parent',
  scheme: 'caperkeeper',
  version: '0.1.0',
  orientation: 'portrait',
  experiments: {
    typedRoutes: true,
  },
  extra: {
    ...config.extra,
    router: {
      root: 'app',
    },
  },
  ios: {
    bundleIdentifier: 'net.jordanwaters.caperkeeper',
    supportsTablet: true,
  },
  android: {
    package: 'net.jordanwaters.caperkeeper',
  },
  plugins: ['expo-router', 'expo-secure-store'],
});
