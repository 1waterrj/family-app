import { describe, expect, it } from 'vitest';

import { choreImageAssetFilename, choreImageCatalog } from '../src/index.js';

describe('chore image catalogue', () => {
  it('presents every contracted picture with its label and asset filename', () => {
    expect(
      choreImageCatalog.map(({ key, label, assetFilename }) => ({
        key,
        label,
        assetFilename,
      })),
    ).toEqual([
      {
        key: 'tidy-toys',
        label: 'Tidy toys',
        assetFilename: 'tidy-toys.png',
      },
      { key: 'dishes', label: 'Dishes', assetFilename: 'dishes.png' },
      {
        key: 'set-table',
        label: 'Set the table',
        assetFilename: 'set-table.png',
      },
      { key: 'laundry', label: 'Laundry', assetFilename: 'laundry.png' },
      {
        key: 'feed-pet',
        label: 'Feed a pet',
        assetFilename: 'feed-pet.png',
      },
      {
        key: 'make-bed',
        label: 'Make the bed',
        assetFilename: 'make-bed.png',
      },
      {
        key: 'wipe-counter',
        label: 'Wipe a counter',
        assetFilename: 'wipe-counter.png',
      },
      {
        key: 'help-garden',
        label: 'Help in the garden',
        assetFilename: 'help-garden.png',
      },
    ]);
  });

  it('resolves the asset filename for a contracted picture key', () => {
    expect(choreImageAssetFilename('set-table')).toBe('set-table.png');
  });
});
