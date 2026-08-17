import { choreImageCatalog } from '@family/chore-images';
import react from '@vitejs/plugin-react';
import { defineConfig, type UserConfig } from 'vite';
import { VitePWA, type VitePWAOptions } from 'vite-plugin-pwa';

const choreImageAssets = choreImageCatalog.map(
  ({ assetFilename }) => `/chore-images/${assetFilename}`,
);

export const dashboardPwaOptions = {
  registerType: 'prompt',
  includeAssets: [
    '/icons/family-kitchen-192.png',
    '/icons/family-kitchen-512.png',
    ...choreImageAssets,
  ],
  manifest: {
    name: 'Managed Mischief',
    short_name: 'Managed Mischief',
    description:
      'A local-first family dashboard for calendars, chores, rewards, and balances.',
    theme_color: '#FFF9F0',
    background_color: '#FFF9F0',
    display: 'standalone',
    orientation: 'landscape',
    start_url: '/',
    icons: [
      {
        src: '/icons/family-kitchen-192.png',
        sizes: '192x192',
        type: 'image/png',
      },
      {
        src: '/icons/family-kitchen-512.png',
        sizes: '512x512',
        type: 'image/png',
      },
    ],
  },
  workbox: {
    globPatterns: ['**/*.{html,js,css,png}'],
    runtimeCaching: [],
  },
} satisfies Partial<VitePWAOptions>;

const config: UserConfig = {
  define: {
    __FAMILY_APP_VERSION__: JSON.stringify(
      process.env.FAMILY_APP_VERSION ?? 'development',
    ),
  },
  plugins: [react(), VitePWA(dashboardPwaOptions)],
  server: {
    proxy: {
      '/v1': 'http://127.0.0.1:3000',
      '/health': 'http://127.0.0.1:3000',
    },
  },
};

export default defineConfig(config);
