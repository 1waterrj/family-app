import {
  MAX_FEEDBACK_DESCRIPTION_LENGTH,
  type FeedbackCategory,
} from '@family/contracts';
import { useEffect, useRef, useState } from 'react';

import type { ReportProblemContext } from '../features/feedback/contextual-feedback';

export type DashboardFeedbackSubmission = {
  category: FeedbackCategory;
  description: string;
};

export type DashboardFeedbackSubmissionResult = {
  status: 'delivered' | 'queued' | 'rate-limited' | 'saved';
};

const choices: ReadonlyArray<{
  category: FeedbackCategory;
  label: string;
  picture: string;
}> = [
  { category: 'BROKEN', label: 'Something broke', picture: '🧩' },
  { category: 'CONFUSING', label: 'This is confusing', picture: '🤔' },
  { category: 'IDEA', label: 'I have an idea', picture: '💡' },
];

export function FeedbackScreen({
  onClose,
  onSubmit,
  onAcknowledged,
  context,
}: {
  onClose(): void;
  onSubmit(
    submission: DashboardFeedbackSubmission,
  ): Promise<DashboardFeedbackSubmissionResult>;
  onAcknowledged?(result: DashboardFeedbackSubmissionResult): void;
  context?: ReportProblemContext;
}) {
  const dialogRef = useRef<HTMLElement>(null);
  const backButtonRef = useRef<HTMLButtonElement>(null);
  const mountedRef = useRef(true);
  const submissionGenerationRef = useRef(0);
  const [category, setCategory] = useState<FeedbackCategory | undefined>(
    context?.category,
  );
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] =
    useState<DashboardFeedbackSubmissionResult['status']>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    mountedRef.current = true;
    backButtonRef.current?.focus();
    return () => {
      mountedRef.current = false;
      submissionGenerationRef.current += 1;
    };
  }, []);

  async function sendFeedback() {
    if (!category || submitting || result) return;
    const submissionGeneration = ++submissionGenerationRef.current;
    setSubmitting(true);
    setError(undefined);
    try {
      const submissionResult = await onSubmit({ category, description });
      if (
        !mountedRef.current ||
        submissionGenerationRef.current !== submissionGeneration
      ) {
        return;
      }
      if (onAcknowledged) {
        onAcknowledged(submissionResult);
      } else {
        setResult(submissionResult.status);
        setCategory(undefined);
        setDescription('');
      }
    } catch {
      if (
        !mountedRef.current ||
        submissionGenerationRef.current !== submissionGeneration
      ) {
        return;
      }
      setError(
        'Feedback could not be saved. Your words are still here. Try again.',
      );
    } finally {
      if (
        mountedRef.current &&
        submissionGenerationRef.current === submissionGeneration
      ) {
        setSubmitting(false);
      }
    }
  }

  function closeScreen() {
    submissionGenerationRef.current += 1;
    onClose();
  }

  function keepFocusInside(event: React.KeyboardEvent<HTMLElement>) {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeScreen();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>(
        'button:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])',
      ),
    );
    const first = focusable[0];
    const last = focusable.at(-1);
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <div className="feedback-overlay">
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="feedback-title"
        className="feedback-dialog"
        tabIndex={-1}
        onKeyDown={keepFocusInside}
      >
        <header className="feedback-header">
          <button
            ref={backButtonRef}
            type="button"
            className="secondary-action feedback-back"
            onClick={closeScreen}
          >
            Back
          </button>
          <div>
            <p className="eyebrow">HELP FAMILY KITCHEN</p>
            <h1 id="feedback-title">Tell us</h1>
          </div>
        </header>

        {result ? (
          <div className="feedback-result" role="status" aria-live="polite">
            <span aria-hidden="true">✓</span>
            <p>{resultMessage(result)}</p>
          </div>
        ) : (
          <>
            <p className="feedback-intro">
              Pick what matches. You do not need to tell us your name.
            </p>
            <div className="feedback-choices" aria-label="Feedback type">
              {choices.map((choice) => {
                const selected = category === choice.category;
                return (
                  <button
                    key={choice.category}
                    type="button"
                    className="feedback-choice"
                    aria-label={choice.label}
                    aria-pressed={selected}
                    disabled={submitting || context !== undefined}
                    onClick={() => setCategory(choice.category)}
                  >
                    <span className="feedback-picture" aria-hidden="true">
                      {choice.picture}
                    </span>
                    <span>{choice.label}</span>
                    <span className="feedback-selected" aria-hidden="true">
                      {selected ? '✓ Selected' : ''}
                    </span>
                  </button>
                );
              })}
            </div>

            <label className="feedback-field" htmlFor="feedback-description">
              <span>Tell us more (optional)</span>
              <textarea
                id="feedback-description"
                aria-label="Tell us more (optional)"
                value={description}
                maxLength={MAX_FEEDBACK_DESCRIPTION_LENGTH}
                rows={4}
                disabled={submitting}
                placeholder="What happened, or what would make this better?"
                onChange={(event) => setDescription(event.currentTarget.value)}
              />
              <small>
                {description.length.toLocaleString()} / 2,000 characters
              </small>
            </label>

            <details className="feedback-privacy">
              <summary>What gets sent?</summary>
              <p>
                Your choice, your optional message, and a short list of recent
                screen, connection, and app-result checks.
              </p>
              <p>
                Recent checks keep at most 15 minutes, 100 events, and 24 KiB.
                They never include names, chore notes, balances, credentials,
                web addresses, or request and response bodies.
              </p>
            </details>

            {error ? (
              <p className="feedback-error" role="alert">
                {error}
              </p>
            ) : null}
            <button
              type="button"
              className="primary-action feedback-send"
              aria-label="Send feedback"
              aria-busy={submitting}
              disabled={!category || submitting}
              onClick={() => void sendFeedback()}
            >
              {submitting ? 'Saving feedback…' : 'Send feedback'}
            </button>
          </>
        )}
      </section>
    </div>
  );
}

export function resultMessage(
  result: DashboardFeedbackSubmissionResult['status'],
): string {
  if (result === 'delivered') {
    return 'Thanks - your feedback was saved and sent.';
  }
  if (result === 'queued') {
    return 'Your feedback was saved. We will send it when the family server reconnects.';
  }
  if (result === 'rate-limited') {
    return "Your feedback was saved. We'll try again later.";
  }
  return 'Your feedback was saved. We could not check whether it sent yet.';
}
