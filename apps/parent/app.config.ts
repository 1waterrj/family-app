import type { ConfigContext, ExpoConfig } from 'expo/config';

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'Managed Mischief',
  slug: 'managed-mischief-parent',
  scheme: 'managed-mischief',
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
    bundleIdentifier: 'net.jordanwaters.managedmischief',
    supportsTablet: true,
  },
  android: {
    package: 'net.jordanwaters.managedmischief',
  },
  plugins: ['expo-router', 'expo-secure-store'],
});
