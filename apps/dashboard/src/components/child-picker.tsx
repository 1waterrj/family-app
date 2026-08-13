import type { DashboardSnapshot } from '@family/contracts';

type SnapshotChild = DashboardSnapshot['children'][number];

export function ChildPicker({
  children,
  onSelect,
  onCancel,
}: {
  children: DashboardSnapshot['children'];
  onSelect: (child: SnapshotChild) => void;
  onCancel: () => void;
}) {
  return (
    <section className="flow-card child-picker">
      <h2>Who is doing it?</h2>
      <div className="child-picker-actions">
        {children.map((child) => (
          <button
            type="button"
            key={child.profile.id}
            style={{ borderColor: child.profile.color }}
            onClick={() => onSelect(child)}
          >
            {child.profile.name}
          </button>
        ))}
      </div>
      <button type="button" className="secondary-action" onClick={onCancel}>
        Cancel
      </button>
    </section>
  );
}
