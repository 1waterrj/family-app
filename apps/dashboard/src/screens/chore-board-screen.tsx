import type { DashboardChore } from '@family/contracts';

import { ChoreTile } from '../components/chore-tile';

export function ChoreBoardScreen({
  chores,
  pendingClaimChoreIds = new Set(),
  onOpenChore,
  onBack,
}: {
  chores: DashboardChore[];
  pendingClaimChoreIds?: ReadonlySet<DashboardChore['id']>;
  onOpenChore: (chore: DashboardChore) => void;
  onBack: () => void;
}) {
  const available = chores
    .filter(({ status }) => status === 'AVAILABLE')
    .slice()
    .sort(
      (left, right) =>
        left.createdAt.localeCompare(right.createdAt) ||
        left.id.localeCompare(right.id),
    );
  return (
    <main className="chore-flow-screen">
      <header className="flow-header">
        <button type="button" className="secondary-action" onClick={onBack}>
          Home
        </button>
        <div>
          <p className="eyebrow">CHORE BOARD</p>
          <h1>Pick a chore</h1>
        </div>
      </header>
      {available.length ? (
        <section className="chore-grid" aria-label="Available chores">
          {available.map((chore) => (
            <ChoreTile
              key={chore.id}
              chore={chore}
              disabled={pendingClaimChoreIds.has(chore.id)}
              onOpen={() => onOpenChore(chore)}
            />
          ))}
        </section>
      ) : (
        <p className="empty-state">No chores are ready right now.</p>
      )}
    </main>
  );
}
