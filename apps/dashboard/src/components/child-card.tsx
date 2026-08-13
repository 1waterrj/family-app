import { formatCents } from '@family/api-client';
import type { DashboardChore, DashboardSnapshot } from '@family/contracts';

type SnapshotChild = DashboardSnapshot['children'][number];

export function ChildCard({
  child,
  activeChore,
  onOpenActiveChore,
}: {
  child: SnapshotChild;
  activeChore?: DashboardChore;
  onOpenActiveChore?: () => void;
}) {
  const content = (
    <article
      className="child-card"
      style={{ borderColor: child.profile.color }}
    >
      <div className="child-heading">
        <h2>{child.profile.name}</h2>
        <strong>{formatCents(child.balanceCents, 'en-US')}</strong>
      </div>
      <p className="child-chore-label">Right now</p>
      <p className="child-chore">
        {activeChore?.name ?? 'Ready for a new chore'}
      </p>
    </article>
  );
  if (!activeChore || !onOpenActiveChore) return content;
  return (
    <button
      type="button"
      className="child-card-button"
      aria-label={`Open ${child.profile.name}'s chore ${activeChore.name}`}
      onClick={onOpenActiveChore}
    >
      {content}
    </button>
  );
}
