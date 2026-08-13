import { parseDevelopmentCredential } from '@family/api-client/development-credential';
import { useState } from 'react';

import type { DashboardSessionStore } from '../auth/dashboard-session';
import {
  reportProblemContext,
  type OpenFeedbackDraft,
} from '../features/feedback/contextual-feedback';

export const DASHBOARD_DEVELOPMENT_CREDENTIAL_MARKER =
  'family-app-development-credential-import';

export function SetupScreen({
  sessionStore,
  browserOrigin,
  onComplete,
  onReportProblem,
}: {
  sessionStore: DashboardSessionStore;
  browserOrigin: string;
  onComplete: () => void;
  onReportProblem?: OpenFeedbackDraft;
}) {
  const [credential, setCredential] = useState('');
  const [error, setError] = useState<string>();
  const [isSaving, setIsSaving] = useState(false);
  const [reportableError, setReportableError] = useState(false);

  async function connect() {
    setError(undefined);
    setReportableError(false);
    let value: unknown;
    try {
      value = JSON.parse(credential);
    } catch {
      setError('Paste the dashboard credential JSON from your family server.');
      return;
    }
    const parsed = parseDevelopmentCredential(value);
    if (!parsed) {
      setError('Paste the dashboard credential JSON from your family server.');
      return;
    }
    if (parsed.session.role !== 'DASHBOARD') {
      setError('This dashboard needs a dashboard credential.');
      return;
    }
    setIsSaving(true);
    try {
      await sessionStore.save({
        ...parsed.session,
        apiOrigin: new URL(browserOrigin).origin,
      });
      onComplete();
    } catch {
      setError('The dashboard credential could not be saved.');
      setReportableError(true);
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <main className="setup-screen">
      <section className="setup-card">
        <p className="eyebrow">LOCAL SETUP</p>
        <h1>Connect Family Kitchen</h1>
        <p>
          Paste the dashboard credential created by your local family server.
        </p>
        <label htmlFor="dashboard-credential">Dashboard credential JSON</label>
        <textarea
          id="dashboard-credential"
          data-development-credential-import={
            DASHBOARD_DEVELOPMENT_CREDENTIAL_MARKER
          }
          value={credential}
          onChange={(event) => setCredential(event.currentTarget.value)}
          rows={8}
          autoCapitalize="off"
          autoComplete="off"
          spellCheck={false}
        />
        {error ? <p role="alert">{error}</p> : null}
        {error && reportableError && onReportProblem ? (
          <button
            className="secondary-action"
            type="button"
            onClick={() => onReportProblem(reportProblemContext('SETUP'))}
          >
            Report this problem
          </button>
        ) : null}
        <button
          className="primary-action"
          type="button"
          disabled={isSaving}
          onClick={() => void connect()}
        >
          {isSaving ? 'Connecting…' : 'Connect dashboard'}
        </button>
      </section>
    </main>
  );
}
