export function ConnectionStatus({
  isOnline,
  isRefreshing,
}: {
  isOnline: boolean;
  isRefreshing: boolean;
}) {
  let symbol = '✓';
  let label = 'Connected';
  if (!isOnline) {
    symbol = '↯';
    label = 'Offline — showing saved data';
  } else if (isRefreshing) {
    symbol = '↻';
    label = 'Reconnecting — showing saved data';
  }

  return (
    <p className="connection-status" role="status">
      <span aria-hidden="true">{symbol}</span> {label}
    </p>
  );
}
