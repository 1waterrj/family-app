import { formatCents } from '@family/api-client';
import type { DashboardChore } from '@family/contracts';

import { ChorePicture } from './chore-picture';

export function ChoreTile({
  chore,
  disabled = false,
  onOpen,
}: {
  chore: DashboardChore;
  disabled?: boolean;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      className="chore-tile"
      disabled={disabled}
      onClick={onOpen}
    >
      <ChorePicture chore={chore} className="chore-picture" />
      <strong>Open chore {chore.name}</strong>{' '}
      <span>{formatCents(chore.valueCents, 'en-US')}</span>{' '}
      <span>
        {chore.durationMinutes}{' '}
        {chore.durationMinutes === 1 ? 'minute' : 'minutes'}
      </span>
    </button>
  );
}
