export function ConfirmAction({
  prompt,
  confirmLabel,
  isPending,
  disabled,
  error,
  onReportProblem,
  onConfirm,
  onCancel,
}: {
  prompt: string;
  confirmLabel: string;
  isPending: boolean;
  disabled?: boolean;
  error?: string;
  onReportProblem?: () => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <section className="flow-card confirm-action">
      <h2>{prompt}</h2>
      {error ? <p role="alert">{error}</p> : null}
      <div className="confirm-actions">
        <button
          type="button"
          className="primary-action"
          disabled={disabled || isPending}
          onClick={onConfirm}
        >
          {isPending ? 'Sending…' : error ? 'Try again' : confirmLabel}
        </button>
        <button type="button" className="secondary-action" onClick={onCancel}>
          Cancel
        </button>
      </div>
      {error && onReportProblem ? (
        <button
          type="button"
          className="secondary-action"
          onClick={onReportProblem}
        >
          Report this problem
        </button>
      ) : null}
    </section>
  );
}
