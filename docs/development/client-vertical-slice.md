# Family client vertical slice: local run and Raspberry Pi preview

> **LAN/local-development only. Do not expose this milestone through public
> ingress, port forwarding, or a public reverse proxy.**
> The fixture tokens are replayable development credentials, production parent
> authentication is not configured, and this stack is not approved for Internet
> access.

This runbook starts the family API, parent Expo app, and kitchen dashboard on a
trusted home network. It uses only the local `family-app-postgres` container and
its named `family-app-postgres-data` volume. The commands do not delete the
volume.

## Prerequisites and one-time install

Use Node.js 24, pnpm 11.16.0, a local Docker-compatible engine, and a trusted
LAN. Native Docker Engine on Ubuntu is sufficient. Colima is an optional macOS
container runtime, not a deployment dependency. From the repository root:

```bash
pnpm install
pnpm exec playwright install chromium
```

Use public package registries and personal/local infrastructure only. Do not use
company accounts, credentials, registries, cloud resources, or network services
for this project. This milestone has no cloud deployment and no public ingress.

On Ubuntu, use the Docker CLI's normal local socket; no Colima variables are
needed. On macOS with Colima, start Colima and point Docker/Testcontainers at
its local socket only in terminals that need them:

```bash
export FAMILY_APP_USER_HOME='/absolute/path/to/your/home'
export DOCKER_HOST="unix://${FAMILY_APP_USER_HOME}/.colima/default/docker.sock"
export TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock
```

Do not replace the shell's `HOME` variable. The Family app configuration and
data model are the same on Ubuntu and Colima; only the local container socket
selection differs.

## Start and migrate PostgreSQL

```bash
./scripts/dev-db.sh start
export DATABASE_URL="$(./scripts/dev-db.sh url)"
pnpm --filter @family/api db:migrate
```

`dev-db.sh start` reuses the named container and volume. It never resets family
data. The deterministic development seed below refreshes only its fixed Example
Family fixture.

## Seed local parent and dashboard credentials

Choose the Ubuntu/Mac development host's private LAN address. Do not use a
public address. Keep the same terminal open so the API can use the same fresh
secret that issued the credentials:

```bash
export FAMILY_APP_LAN_IP='192.168.1.20'
export NODE_ENV=development
export DEVELOPMENT_AUTH_SECRET="$(openssl rand -hex 48)"
export DEV_PARENT_API_ORIGIN="http://${FAMILY_APP_LAN_IP}:3000"
export DEV_DASHBOARD_API_ORIGIN="http://${FAMILY_APP_LAN_IP}:5173"
export FAMILY_FEEDBACK_GITHUB_REPOSITORY='owner/repository'
pnpm dev:seed
```

`FAMILY_FEEDBACK_GITHUB_REPOSITORY` is the only feedback-specific environment
variable. It must be exactly an `owner/repository` slug for the public
repository that accepts sanitized app feedback. The slug is public metadata.
Do not put a GitHub token, repository URL, issue number, hostname, or family
value in it. There is no feedback retention or GitHub-token environment
variable. Omit the slug to keep all feedback local and disable preparation of
public previews.

The seed writes owner-only files under ignored `.local/dev-fixtures/`. Open
`parent.json` or `dashboard.json` in a local editor when importing it. Never
paste either credential into chat, source control, screenshots, or normal logs.
Running the seed again rotates both fixture tokens and restores the fixed local
household.

## Start the API, phone app, and dashboard

In the seed terminal, start the API on the LAN:

```bash
export API_HOST=0.0.0.0
pnpm --filter @family/api build
pnpm --filter @family/api start
```

In a second terminal, start Expo and import the contents of
`.local/dev-fixtures/parent.json` on the local-development setup screen:

```bash
pnpm --filter @family/parent exec expo start --lan
```

In a third terminal, start the kitchen dashboard:

```bash
pnpm --filter @family/dashboard dev -- --host 0.0.0.0
```

On the Raspberry Pi, open
`http://<FAMILY_APP_LAN_IP>:5173` in Chromium and import the contents of
`.local/dev-fixtures/dashboard.json`. The dashboard credential is restricted to
dashboard reads and child chore actions; approvals remain parent-only.

Plain LAN HTTP is not a browser secure context, so Chromium may omit
`crypto.randomUUID()` there even while exposing `crypto.getRandomValues()`.
Family Kitchen generates the same secure RFC 4122 version-4 operation IDs from
`getRandomValues()` in that case. It never falls back to `Math.random`; a browser
with neither secure source fails the operation clearly instead of creating a
predictable idempotency key.

## Feedback review and maintainer workflow

The kitchen dashboard's `Tell us` control accepts a category and optional
message without asking for a name. It never exposes an Inbox, edit/delete
controls, maintainer settings, GitHub, or export. A connected dashboard sends
to the local API; while disconnected it retains a local outbox item for a later
retry.

Both parents can open the parent app's Feedback tab, review the same
household-local reports, edit private text and diagnostics, change status, or
delete a report. Server authorization is identical for both parents.

### Non-maintainer parent workflow

Leave `Advanced` > maintainer tools off (the default) on a non-maintainer phone.
That parent can still submit, review, edit, close, reopen, and delete feedback.
The phone shows no GitHub handoff action. This preference is stored only on
that device; changing it does not change the other parent's phone or grant a
new server permission.

### Maintainer phone workflow

On the designated phone, open Feedback > `Advanced` and enable maintainer
tools. Review the private report first, choose `Prepare public issue`, and enter
a public title and description that are safe to leave the home network. The
server reconstructs a preview from those parent-entered public fields and
allowlisted diagnostics, sanitizes it again, and shows the exact body before
handoff.

The final action opens a prefilled GitHub issue in the system browser, or uses
a clipboard fallback when the prefilled URL is too long. This is a browser
handoff, not an API publication: the Family app stores no GitHub credential,
does not navigate or submit silently, and cannot bypass GitHub's confirmation.
The maintainer must already be signed into GitHub in that browser, review the
draft once more, and press GitHub's submit button. A local `EXPORTED` status or
saved issue URL records what the parent told the app; it does not prove an issue
was published. Treat all submitted issue content as public, especially when the
configured repository is public.

`Copy Markdown` is also a completed handoff. The app copies the full validated
title and body first, then marks the reviewed report `EXPORTED` with a
compare-and-swap update. `Continue to GitHub` marks it only after the operating
system accepts the composer URL; for an oversized draft, clipboard success
comes before the blank composer opens. If that composer cannot open, the
successful copy still counts as `EXPORTED`. Clipboard false/error results never
change local status.

If copying or opening succeeds but the local status request cannot be
confirmed, the exact preview stays visible and both external handoff buttons
remain disabled. Use the displayed status-retry action; it reuses the original
idempotency key and reviewed revision and does not copy or open the draft again.
This timeline records only the local handoff, never GitHub publication.

## Offline behavior and 30-day retention

Feedback can describe an earlier failure, but it cannot repair or contact a
currently unreachable family server. While the app remains online, the parent
and dashboard outboxes retry transport, HTTP 5xx, and rate-limit failures after
5 seconds, then 30 seconds, then 2 minutes, and stop after that bounded sequence.
Network reconnection, session arrival, a manual parent retry, or dashboard
visibility can start the next attempt sooner; simultaneous triggers coalesce.
Going offline, changing household/session scope, or unmounting cancels pending
work. A rate-limit response remains queued with calm guidance and no rapid loop.
Idempotency keys make an acknowledged retry return the original receipt instead
of duplicating a report.

Before a network delivery, the outbox durably marks the command with a unique
delivery-attempt generation. Storage state transitions are serialized, but the
storage lock is released before awaiting the network. A hung request therefore
cannot block listing, deleting, or saving feedback, or delivery for a newly
active household scope. A second drain skips an already active entry and can
deliver later entries in the same scope. Within one JavaScript runtime, all
outbox instances with the same durable storage key share the operation lock and
active-attempt registry even when remounting created different storage adapter
objects; different keys remain independent. This single-delivery guard does not
coordinate separate browser tabs or processes, so durable idempotency remains
the cross-runtime protection. The dashboard normally has one page runtime.

After a valid server receipt, a compare-and-swap on the entry, scope, state, and
attempt generation replaces the private command with a content-free
delivered-cleanup tombstone before removing the local record. If a write fails
at either boundary, a reload can retry the same idempotency key or finish cleanup
without creating another server report. Parent deletion copy distinguishes an
unsent draft, a delivered tombstone, and an attempted delivery whose final
server outcome is unknown; a late ACK or rejection cannot recreate a locally
removed private command.

Dashboard drafts expire from kiosk storage after 30 days. Parent drafts remain
until delivery or explicit local deletion so a parent's report is not silently
lost. The Feedback tab (and setup screen for device-local unbound drafts) lists
only drafts visible in the current scope, with category, saved time, diagnostics
indicator, and a short description preview. A parent can open the full locally
saved draft and delete one entry after confirmation; a delivery/deletion race is
reported honestly. Bound drafts from another household are never shown. On the
server, unresolved reports remain until a parent closes or deletes
them. A report is eligible for automatic deletion only after it has remained
`CLOSED` for more than 30 days; cleanup runs at server startup and every six
hours. That deletion removes the report, its private diagnostics, and the exact
private update-replay payload. It does not remove open/recent reports or
unrelated records from the same or another household.

## Feedback privacy threat model

The protected data is the original report text, family names and household
content, network details, diagnostic events, local credentials, and replay
payloads. The controls for this LAN-only milestone are:

- dashboard actors can create receipt-only reports but cannot list, read,
  update, delete, preview, or export them;
- parent reads and mutations are household-scoped, and cross-household or stale
  membership access returns the same generic not-found response as a missing
  report;
- diagnostics accept only typed screen, connection, and API-result events from
  the last 15 minutes, capped at 100 events and 24 KiB; arbitrary logs,
  names/domain data, URLs, credentials, and request/response bodies are not
  accepted;
- parent and dashboard caches/outboxes include the complete local session scope
  so one household cannot receive another household's cached or queued data;
- public output is rebuilt only from the parent's public title/description and
  allowlisted diagnostics, then server-scrubbed; whole Unicode grapheme
  sequences and standards-complete HTML entities are canonicalized before the
  privacy scan, and raw HTML elements are removed with all of their contents
  before inert Markdown is reconstructed; private report text is never a
  public-preview fallback;
- audit and retention logs use bounded event metadata, deleted counts, request
  IDs, and error categories rather than report text, secrets, or diagnostic
  payloads; and
- release checks scan tracked source plus built parent/dashboard artifacts for
  development credentials and GitHub credential prefixes.

These controls do not make the current replayable development fixture tokens
safe for Internet use. A person with a valid parent credential can read that
household's private feedback, the local device stores pending drafts, and the
maintainer can still paste private information into GitHub after leaving the
app. Use a trusted LAN, protect the fixture files and devices, review every
public draft, and do not add port forwarding, a public reverse proxy, or other
public ingress in this milestone.

## Raspberry Pi production-build preview

First import the dashboard credential through the development server at port
5173 as described above. Browser storage is origin-bound. Stop that dashboard
server, then build and preview the production PWA on the same host and port:

```bash
pnpm --filter @family/dashboard build
pnpm --filter @family/dashboard exec vite preview --host 0.0.0.0 --port 5173
```

Open `http://<FAMILY_APP_LAN_IP>:5173` again on the Pi. The production preview
cannot import fixture credentials; it can reuse the already imported session
for this same local origin. This is a visual/LAN preview, not a deployment or a
public-ingress configuration.

## Verification commands

The parent Jest suite includes parameterized native component acceptance for
the shared submission, Inbox, review, and export screens under `PARENT_IOS` and
`PARENT_ANDROID`. It injects the React Native Clipboard and Linking boundaries
and is not simulator or real-device E2E. The existing Playwright journey remains
browser/API cross-client acceptance for dashboard submission,
parent-authorized review, server sanitization, and draft generation.

The browser test deliberately refreshes the fixed fixture and rotates its
credentials:

```bash
pnpm test:e2e
pnpm verify:production-bundles
```

Run all repository gates. Ubuntu Docker Engine uses its default socket with no
extra variables. For macOS Colima, export the optional socket variables shown
in Prerequisites first:

```bash
pnpm test
pnpm typecheck
pnpm build
pnpm lint
pnpm format:check
pnpm --filter @family/api exec drizzle-kit check --config drizzle.config.ts
```

## Feedback troubleshooting

- **`Prepare public issue` is absent:** on the intended maintainer phone, enable
  Feedback > `Advanced` > maintainer tools. The switch is device-local. If it is
  already on, confirm the API was started with a valid
  `FAMILY_FEEDBACK_GITHUB_REPOSITORY='owner/repository'`; restart the API after
  changing server environment.
- **Preview says it is not configured:** the repository slug was omitted or
  rejected. Use only `owner/repository`, without `https://`, `.git`, a query,
  fragment, or credentials.
- **The browser shows GitHub login or a draft:** that is expected. Sign in to
  GitHub in the browser, inspect the public title, body, labels, and destination,
  then decide whether to submit. The Family app cannot confirm publication.
- **The browser does not open:** copy the reviewed fallback text, open the
  configured repository's issue form yourself, and paste only that sanitized
  text. Never paste the private report, raw logs, names, calendar content,
  balances, credentials, or public/local addresses.
- **Feedback remains saved/queued:** reconnect the phone or kitchen dashboard to
  the trusted LAN and verify `/health/ready`. Retry after the API is reachable.
  Dashboard admission is five reports per ten minutes per dashboard; wait for
  the window rather than repeatedly pressing Send.
- **A report disappeared:** a parent may have deleted it, or it may have been
  `CLOSED` for more than 30 days and removed by retention. `EXPORTED` alone does
  not trigger retention.
- **Security verification fails:** run `pnpm test:e2e` first so owner-only local
  fixture credentials exist, then run `pnpm verify:production-bundles`. The gate
  reports offending file paths but never the credential value. Remove the
  credential from source/build inputs and rotate any real credential that was
  exposed; do not add an exclusion.

## Stop safely

Stop the API, Expo, and dashboard processes with `Ctrl-C`, then stop PostgreSQL
without deleting its named volume:

```bash
./scripts/dev-db.sh stop
```

Do not run `docker volume rm family-app-postgres-data` unless you intentionally
want to destroy the local database.
