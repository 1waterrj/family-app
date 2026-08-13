import { choreImageAssetFilename } from '@family/chore-images';
import type { DashboardChore } from '@family/contracts';

export function ChorePicture({
  chore,
  className,
}: {
  chore: Pick<DashboardChore, 'name' | 'imageKey' | 'imageUrl'>;
  className?: string;
}) {
  const source = chore.imageKey
    ? `/chore-images/${choreImageAssetFilename(chore.imageKey)}`
    : chore.imageUrl;
  if (!source) {
    return (
      <div className={className} role="img" aria-label={chore.name}>
        <span aria-hidden="true">◇</span>
      </div>
    );
  }
  return <img className={className} src={source} alt={chore.name} />;
}
