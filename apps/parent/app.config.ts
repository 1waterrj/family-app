import type { ConfigContext, ExpoConfig } from 'expo/config';

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'Family',
  slug: 'family-parent',
  scheme: 'family-app',
  version: '0.1.0',
  orientation: 'portrait',
  newArchEnabled: true,
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
    bundleIdentifier: 'org.jordanwaters.familyapp',
    supportsTablet: true,
  },
  android: {
    package: 'org.jordanwaters.familyapp',
  },
  plugins: ['expo-router', 'expo-secure-store'],
});
