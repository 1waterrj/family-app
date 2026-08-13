import { choreImageCatalog } from '@family/chore-images';

import { dashboardPwaOptions } from '../vite.config';

describe('Family Kitchen PWA configuration', () => {
  test('installs as a standalone landscape dashboard with exact raster icons', () => {
    expect(dashboardPwaOptions.registerType).toBe('prompt');
    expect(dashboardPwaOptions.manifest).toMatchObject({
      name: 'Family Kitchen',
      display: 'standalone',
      orientation: 'landscape',
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
    });
  });

  test('precaches all chore pictures without runtime caching authenticated API routes', () => {
    const expectedPictures = choreImageCatalog.map(
      ({ assetFilename }) => `/chore-images/${assetFilename}`,
    );
    expect(dashboardPwaOptions.includeAssets).toEqual(
      expect.arrayContaining(expectedPictures),
    );
    expect(dashboardPwaOptions.workbox?.runtimeCaching ?? []).toEqual([]);
  });
});
