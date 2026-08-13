import { forwardRef } from 'react';

export const TellUsButton = forwardRef<HTMLButtonElement, { onPress(): void }>(
  function TellUsButton({ onPress }, ref) {
    return (
      <button
        ref={ref}
        type="button"
        className="tell-us-button"
        onClick={onPress}
      >
        <span aria-hidden="true">💬</span>
        Tell us
      </button>
    );
  },
);
