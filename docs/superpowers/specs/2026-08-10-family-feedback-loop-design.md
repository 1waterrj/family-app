# Family Feedback Loop Design

**Date:** August 10, 2026  
**Status:** Approved for implementation planning

## 1. Purpose

Add a private, local-first feedback loop across the Family parent application,
kitchen dashboard, and local API. Any family member should be able to report a
problem, confusing experience, or idea without understanding GitHub. Parents
review feedback and remove private information before a designated maintainer
device prepares an issue for the project's public GitHub repository.

The feature must make useful diagnostics easy to collect while treating family
data as private by default. No feedback or diagnostic data may be published
without an explicit parent review and a separate confirmation in GitHub.

## 2. Goals

- Make feedback easy to submit from the iPhone and Android parent application
  and the Raspberry Pi kitchen dashboard.
- Attach a bounded, useful diagnostic window automatically.
- Keep all submitted feedback on the household's Ubuntu server until a parent
  chooses to export it.
- Give both parents a shared Feedback Inbox with equal review and editing
  permissions.
- Keep GitHub terminology and authentication out of the ordinary parent and
  child submission experiences.
- Allow a designated maintainer phone to prepare a public-safe GitHub issue
  without storing a GitHub credential in the Family applications or server.
- Fail closed when a public report cannot be sanitized or validated.

## 3. Non-goals

- Automatically creating GitHub issues through the GitHub API.
- Storing a GitHub personal access token, OAuth token, or GitHub App credential.
- Uploading screenshots, photos, raw application logs, server logs, request
  bodies, or database records.
- Creating an in-product conversation or support ticket system.
- Sending feedback to a third-party analytics, crash-reporting, or support
  platform.
- Confirming that an issue was submitted after GitHub opens in the browser.
- Changing either parent's family-management permissions.

## 4. Repository and deployment model

The Family code remains a monorepo containing:

- `apps/parent`: the Expo/React Native parent application built for iPhone and
  Android.
- `apps/dashboard`: the Raspberry Pi kitchen PWA.
- `apps/api`: the local Ubuntu server API.
- `packages`: shared contracts, diagnostics, API-client behavior, design tokens,
  and assets.

All feedback concerns the same public source repository. Reports identify their
source as `parent-ios`, `parent-android`, `dashboard`, or `server` so the public
issue can be categorized without splitting the applications into separate
repositories.

The deployment must explicitly set a non-secret
`FAMILY_FEEDBACK_GITHUB_REPOSITORY` value in `owner/repository` form before
GitHub export becomes available. An absent or malformed value disables export
with an actionable local message. The application must not guess a repository
from a developer account, workstation configuration, package-registry setting,
or unrelated infrastructure.

## 5. Roles and permissions

### Dashboard device

A paired dashboard may:

- Create a feedback report for its household.
- Attach its own sanitized diagnostic snapshot.
- Receive the identifier and local submission status of the new report.

A dashboard may not list, read, edit, export, close, or delete feedback reports.
The dashboard never identifies which child initiated a report.

### Parent

Both parents may:

- Submit feedback from the parent application.
- List and read feedback for their household.
- Edit the title and user description.
- Inspect and remove diagnostic fields or the entire diagnostic section.
- Change workflow status.
- Delete a feedback report.
- Generate a server-sanitized public preview.

### Maintainer device

Maintainer mode is a device-local parent-app preference that is disabled by
default. Enabling it reveals public-export controls on that phone. It does not
create a new household role or reduce the other parent's family permissions.

The server continues to authorize the maintainer phone as a normal parent. The
browser's existing GitHub session is the final authority for creating the public
issue, so the Family application cannot publish silently even when maintainer
mode is enabled.

## 6. User experience

### 6.1 Parent application submission

The parent application adds a fifth `Feedback` tab with two destinations:

- **Send Feedback**
- **Feedback Inbox**

Send Feedback starts with three plain-language categories:

- Something broke
- This is confusing
- I have an idea

The parent may enter an optional description and inspect a concise list of the
diagnostic categories that will be attached. Ordinary submission does not
mention GitHub. Success says, `Thanks - your feedback was saved.`

Relevant error states throughout the parent application also offer
`Report this problem`. That action opens Send Feedback with the source screen,
error category, and current diagnostic snapshot already selected. The user can
edit the description before submitting.

### 6.2 Kitchen dashboard submission

The dashboard provides a small, consistently placed `Tell us` action that does
not compete with primary chore controls. It opens three large, illustrated
choices matching the parent categories. After choosing a category, the user may
type an optional message with the on-screen keyboard or submit immediately.

The dashboard does not request a name or child profile. After submission it
returns to the previous screen and displays `Thanks - your feedback was saved.`

### 6.3 Feedback Inbox

The Inbox displays reports with:

- Category
- Source application and platform
- Submission time
- Workflow status
- Short description preview
- An indicator when diagnostics are attached

Opening a report allows either parent to edit its title and description, inspect
the exact diagnostic snapshot, remove individual fields, remove all diagnostics,
delete the report, or update its status.

Potential personal information is highlighted with an explanation. Highlighting
is assistance, not a guarantee; a parent must confirm the exact public preview
before export.

### 6.4 Maintainer export

On a maintainer-enabled phone, a reviewed report includes
`Prepare public issue`. The resulting screen shows the exact Markdown title and
body that will leave the local system. The maintainer may edit the public title
and description or omit any diagnostic section. Every edit invalidates the
current preview and sends the draft through server sanitization again. Copy and
GitHub actions remain disabled until the displayed content matches the latest
validated preview.

`Continue to GitHub` opens the operating system's normal browser at the public
repository's new-issue composer with the sanitized title and body prefilled.
The browser uses the maintainer's existing GitHub login. GitHub presents its own
final submit button.

The local application records only that the issue composer was opened. It must
not claim that the issue was published. The maintainer may later mark the local
report closed and optionally paste the public issue URL for convenient linking.

## 7. Diagnostic collection

### 7.1 Safe event model

The parent and dashboard clients maintain a rolling structured diagnostic
buffer. It covers at most the latest 15 minutes and is also bounded by event
count and serialized byte size. The implementation drops the oldest event first
when any bound is reached.

Allowed fields include:

- Source application, platform, build version, and runtime version
- Screen or route identifier from a fixed allowlist
- Event type from a fixed allowlist
- Network online/offline state
- Request method and templated API route
- Response status and application error code
- Request duration bucket rather than raw high-precision timing
- Local event timestamp
- Opaque request correlation reference used only inside the private Inbox

The diagnostic API accepts structured fields only. It does not accept an
arbitrary log message.

### 7.2 Forbidden diagnostic content

The collector must never record:

- Authorization headers, cookies, credentials, tokens, secrets, or session
  storage values
- Request or response bodies
- Arbitrary URLs or query strings
- Parent or child names
- Household names or identifiers
- Device identifiers
- Calendar names, event titles, descriptions, attendees, or locations
- Chore names, instructions, notes, or images
- Balances, ledger values, payouts, or purchase descriptions
- Text entered into any application form
- Stack traces containing local file paths or uncontrolled values

Application code records diagnostic events through typed helper functions. It
must not pass an unfiltered error object or arbitrary context map into the
collector.

The buffer is reset to the allowlisted `SETUP` screen whenever an authenticated
household/session scope ends or changes directly. That reset happens before a
new-scope event can be recorded and clears all prior screens, network history,
and request correlation references. Ordinary rerenders and access-token refresh
within the same normalized scope do not reset it. Activity recorded while no
authenticated scope exists remains useful for a setup draft and can bind only
to the first valid session. Each diagnostic request captures the current buffer
epoch before transport starts. A success, contracted error, or thrown transport
result records only if that epoch is still current, so a request started in an
old scope cannot repopulate the buffer after reset.

### 7.3 Snapshot creation

When the user submits feedback, the client copies the current bounded buffer
into the feedback draft. Subsequent diagnostic events do not change that draft.
If the server is unavailable, the entire draft and captured snapshot remain in
the device's local feedback outbox until delivery succeeds or the user deletes
it.

The API does not attach raw Pino output to feedback. Private request correlation
references allow a maintainer to locate relevant server logs locally if deeper
investigation is required. Public export replaces those references with
incident-local labels such as `<request-1>`.

## 8. Local data model and workflow

A feedback report stores:

- UUID primary key
- Household identifier
- Submitting actor identifier and role for local auditing
- Category: `BROKEN`, `CONFUSING`, or `IDEA`
- Parent-editable title and description
- Source application, platform, version, and screen
- Captured diagnostic events
- Status: `NEW`, `REVIEWING`, `READY`, `EXPORTED`, or `CLOSED`
- Reviewer identifier and review timestamp when applicable
- Optional public issue URL entered by a parent
- Creation, update, export, close, and deletion timestamps as applicable

The submitting actor and household identifiers remain private. The public report
contains neither value.

`EXPORTED` means the application opened or copied the GitHub issue draft. It does
not mean GitHub accepted or published the issue.

The client records that transition only after the operating-system clipboard
accepts the complete validated Markdown or the operating-system browser accepts
the issue-composer URL. Each completed handoff gets one compare-and-swap update
against the reviewed report revision and one idempotency key that is reused if
the local status request must be retried. A clipboard failure never changes
status. If the external action succeeds but the status request fails, the exact
preview remains visible and the retry action marks that already-completed
handoff without copying or opening it again.

## 9. API boundary

The versioned API provides these conceptual operations:

- `POST /v1/feedback`: parents and paired dashboards create a household report.
- `GET /v1/feedback`: parents list their household's reports.
- `GET /v1/feedback/:id`: parents read one household report.
- `PATCH /v1/feedback/:id`: parents edit content, remove diagnostic fields,
  update status, or record a public issue URL.
- `DELETE /v1/feedback/:id`: parents delete a report.
- `POST /v1/feedback/:id/public-preview`: parents request a validated,
  public-safe Markdown preview.

All reads and mutations enforce household isolation on the server. IDs supplied
by the client never establish authorization. Submission bodies have strict
schemas, field lengths, event-count bounds, and total byte limits.

Dashboard submission is rate-limited per device credential and household. A
rate-limited dashboard receives a child-friendly acknowledgement without
revealing security or household details, while the local outbox avoids rapid
automatic retries.

## 10. Public sanitization

Public preview generation occurs on the server after normal schema validation.
It applies these layers in order:

1. Reconstruct the output from explicitly allowed fields rather than serializing
   the private database record.
2. Replace household, parent, child, and device names known to the server.
3. Replace local and public IP addresses, hostnames, email addresses, UUIDs,
   credential-like strings, and correlation references.
4. Remove control characters and Markdown constructs that could create hidden
   content or unsafe links.
5. Enforce public title, section, event-count, and total-size limits.
6. Validate the resulting public-report schema.

The preview contains:

- User-edited public title and description
- Feedback category
- Source application and platform
- App version
- Public-safe route and error categories
- Coarse connection state
- A short sanitized event timeline
- A statement that the report was generated by the self-hosted feedback tool

The preview omits the diagnostic timeline entirely if sanitization cannot prove
that every event conforms to the public schema. The UI explains the omission and
still allows the parent to file the descriptive portion.

## 11. GitHub handoff

The parent app constructs the issue-composer URL from the validated server
configuration by adding `/issues/new` and encoded title/body parameters. It may
request repository labels corresponding to source and category; missing or
unauthorized labels must not block issue creation.

The generated issue uses consistent metadata such as:

- `app:parent`, `app:dashboard`, or `app:server`
- `platform:ios`, `platform:android`, or `platform:raspberry-pi`
- `type:bug`, `type:confusing`, or `type:idea`

If the encoded URL exceeds the product's conservative handoff limit, the app
copies the validated Markdown to the clipboard and opens the repository's blank
new-issue page. It explains where to paste the content. If the browser cannot be
opened, the content remains visible and copyable.

No GitHub token is present in source, builds, environment variables, the local
database, mobile secure storage, or browser URLs.

## 12. Offline and error behavior

- A feedback draft survives application restart until it is delivered or
  deleted.
- While a client stays online, delivery retries eligible transport, HTTP 5xx,
  and 429 failures after 5 seconds, 30 seconds, and 2 minutes, then stops. The
  deterministic schedule has no jitter; manual/network/visibility triggers may
  accelerate the next attempt but coalesce with in-flight work. Offline,
  scope/session change, success, and unmount reset or cancel pending work.
- Duplicate retry submissions use an idempotency key so they create one report.
- Outbox delivery durably transitions from queued, to delivery-attempted before
  network I/O, to a private-content-free delivered-cleanup tombstone after a
  valid receipt, and finally to removal. A failed boundary write can therefore
  be retried idempotently or reported as outcome-unknown instead of being
  mislabeled as deletion of an unsent draft.
- Failed submission preserves the user's text and explains that the report is
  waiting for the family server.
- Inbox failures preserve the last successful local cache and label it stale.
- Failed public-preview generation keeps the private report unchanged.
- Failed GitHub handoff leaves the validated Markdown visible and copyable.
- GitHub availability never affects the dashboard, parent application, or local
  feedback submission.

## 13. Retention and deletion

Unresolved reports remain on the local server until a parent closes or deletes
them. Closed reports and their diagnostic snapshots are automatically deleted
30 days after closure. Deletion removes the local report and diagnostics; it
does not affect an issue that was separately published on GitHub.

Successfully delivered device outbox copies are removed after server
acknowledgement. Undelivered outbox items remain visible to a parent and can be
retried or deleted. The parent view lists only the current scope (or only
device-local unbound setup drafts while signed out), showing category, creation
time, diagnostics yes/no, and a whitespace-normalized description preview of at
most 80 characters. A parent can inspect the full local draft and delete one
entry after explicit confirmation. Storage failures remain actionable, and a
delivery/deletion race says whether the draft was already sent or removed.
An attempted entry whose acknowledgement could not be persisted is visibly
identified, and deleting its local copy says delivery may already have occurred.
Delivered tombstones contain no description or diagnostic snapshot and are
removed as soon as storage recovers. Other household scopes are never displayed.
The dashboard automatically expires an undelivered draft after 30 days to avoid
indefinite accumulation on the kiosk.

## 14. Accessibility and child safety

- Dashboard choices use large touch targets, illustrations, text labels, and
  color-independent selection states.
- Success and error messages use short, child-appropriate language.
- The dashboard never asks a child for a name, email address, or contact detail.
- Optional text is length-limited and never copied into diagnostic events.
- Parent review screens expose full labels to screen readers and do not rely on
  color alone for PII warnings or workflow state.
- Motion and sounds follow the household's existing accessibility preferences.

## 15. Testing strategy

### Shared diagnostics

- Verify the 15-minute, event-count, and byte-size bounds.
- Verify oldest-first eviction.
- Verify only allowlisted routes, screens, events, and fields compile and
  serialize.
- Attempt to inject credentials, headers, form values, names, calendar content,
  balances, notes, arbitrary errors, and local paths; collection must reject or
  omit them.

### API

- Verify parent and dashboard submission permissions.
- Verify dashboards cannot list, read, edit, delete, or export feedback.
- Verify parent household isolation for every operation.
- Verify validation, size limits, idempotency, rate limiting, and retention.
- Verify public preview redacts names, email addresses, IP addresses, hostnames,
  UUIDs, correlation references, credential-shaped values, and unsafe Markdown.
- Verify sanitization failures omit diagnostics or reject export rather than
  leaking a partial payload.

### Parent application

- Verify category selection, optional text, submission success, offline outbox,
  retry, and contextual error reporting.
- Verify Inbox list, edit, field removal, PII warnings, deletion, and statuses.
- Verify maintainer controls are hidden by default and appear only when enabled
  on that device.
- Verify exact public preview, browser URL encoding, oversize clipboard fallback,
  standalone-copy status semantics, status retry, double-action guards, and
  browser-open failure behavior.

### Dashboard

- Verify the three large choices, optional text, child-friendly confirmation,
  navigation return, offline outbox, retry behavior, expiry, and rate-limit
  handling.
- Verify dashboard UI and API access cannot reveal Inbox contents.

### End to end and release security

- Submit from the dashboard, review in the parent app, remove diagnostic fields,
  generate a public preview, and verify the GitHub handoff without publishing an
  issue.
- Run the same flow from iOS and Android parent configurations.
- Exercise the shared parent submission, Inbox, review, and export components
  in parameterized React Native/Jest acceptance tests for `PARENT_IOS` and
  `PARENT_ANDROID`, using injected Clipboard and Linking boundaries. This is
  native component acceptance, not simulator or real-device E2E.
- Retain the Playwright/API cross-client journey from the real dashboard browser
  through parent-authorized review, server sanitization, and handoff generation.
- Scan production bundles, source, fixtures, logs, and generated artifacts for
  GitHub credentials and seeded family values.
- Use adversarial fixtures containing names, email addresses, LAN IPs, UUIDs,
  authorization headers, calendar titles, balances, and chore notes. The public
  preview must redact them or fail closed.

## 16. Acceptance criteria

The feature is accepted when:

1. A parent or child can submit feedback without seeing or understanding GitHub.
2. A report includes a useful but strictly bounded diagnostic snapshot.
3. Feedback remains private on the Ubuntu server until a parent initiates
   export.
4. Both parents can review, edit, redact, close, and delete reports.
5. Only a phone with maintainer mode enabled displays GitHub export controls.
6. The maintainer sees and can edit the exact public content before handoff.
7. The Family system stores no GitHub credential and never claims that an opened
   composer proves issue publication.
8. Public export redacts or omits family names, content, financial data,
   credentials, identifiers, and network details.
9. Offline feedback survives restart and eventually submits once the local
   server is reachable.
10. Feedback and GitHub failures never block ordinary family workflows.
