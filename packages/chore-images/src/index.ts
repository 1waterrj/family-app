import type { ChoreImageKey } from '@family/contracts';

type ChoreImage = {
  key: ChoreImageKey;
  label: string;
  assetFilename: `${ChoreImageKey}.png`;
};

export const choreImageCatalog = [
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
] as const satisfies readonly ChoreImage[];

export function choreImageAssetFilename(
  key: ChoreImageKey,
): `${ChoreImageKey}.png` {
  return `${key}.png`;
}
