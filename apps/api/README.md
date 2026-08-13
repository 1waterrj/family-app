# Family API

> **Production safety:** development fixture tokens are rejected when
> `NODE_ENV=production`. The current server intentionally fails startup in
> production until a real `ActorAuthenticator` is wired into `buildApp`. Never
> use the development signing secret as a production credential.

The API is a Fastify 5 JSON service for the versioned `/v1` family chores and
ledger boundary. It requires Node.js 24 and pnpm 11.16.0. Integration tests use
real PostgreSQL 17 containers.

For the complete API, Expo parent app, kitchen dashboard, credential-import,
and Raspberry Pi preview workflow, use
[`docs/development/client-vertical-slice.md`](../../docs/development/client-vertical-slice.md).
That runbook is LAN/local-development only and is not approved for public
ingress.

## Start the local database

From the repository root, start the explicit PostgreSQL 17 container and keep
its named volume between runs:

```bash
./scripts/dev-db.sh start
export DATABASE_URL="$(./scripts/dev-db.sh url)"
pnpm --filter @family/api db:migrate
```

`db:migrate` applies the immutable migrations in `db/migrations`. To run all
tests, including the HTTP end-to-end test:

```bash
pnpm test
```

On Colima, Testcontainers may need its socket made explicit:

```bash
export FAMILY_APP_USER_HOME="/absolute/path/to/your/home"
export DOCKER_HOST="unix://$FAMILY_APP_USER_HOME/.colima/default/docker.sock"
export TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock
pnpm test
```

Set `FAMILY_APP_USER_HOME` to the absolute path to your home directory; do not
repurpose the shell's `HOME` variable.

## Run the API

Set an explicit, unique development secret. There is no built-in default:

```bash
export NODE_ENV=development
export DEVELOPMENT_AUTH_SECRET="$(openssl rand -base64 48)"
export DATABASE_URL="$(./scripts/dev-db.sh url)"
export FAMILY_FEEDBACK_GITHUB_REPOSITORY='owner/repository'
pnpm --filter @family/api build
pnpm --filter @family/api start
```

The default listener is `127.0.0.1:3000`. Override it with `API_HOST` and
`API_PORT`.

`FAMILY_FEEDBACK_GITHUB_REPOSITORY` is the only feedback-specific environment
variable. It must be an exact `owner/repository` slug. It is public routing
metadata, not a credential; do not put a token, URL, issue number, or private
family value in it. Omitting it keeps local feedback submission and parent
review available but disables public-preview preparation. There is deliberately
no GitHub-token environment variable: the API neither calls GitHub nor creates
an issue automatically.

The feedback retention interval, batch size, and 30-day window are fixed
application policy, not operator environment variables. On startup and every
six hours, the worker deletes only reports that have been `CLOSED` for more than
30 days. It deletes the report's private diagnostics and matching private
update-replay payloads. Open reports, unrelated idempotency records, and other
households remain untouched. A parent can also delete a local report
immediately.

## Feedback privacy and authorization boundary

Dashboard sessions can submit feedback and receive a receipt, but cannot list,
read, update, delete, preview, or export reports. Parent operations are scoped
to the authenticated household; another household receives the same generic
not-found response as a missing report. Both parents have the same server-side
review, edit, and delete permissions. The optional maintainer setting is only a
device-local parent UI preference and grants no API role.

Diagnostics accept only contracted screen, online/offline, and API-result
events. They retain at most 15 minutes, 100 events, and 24 KiB and reject
arbitrary fields, log text, user/domain data, addresses, credentials, and HTTP
bodies. Audit records and retention logs contain bounded metadata such as
category, state, and deleted count, never the private description or diagnostic
payload.

A public preview is rebuilt from parent-entered public title/description and
allowlisted diagnostics, then sanitized on the server. It does not copy the
private report text. The parent app only prepares a GitHub issue URL or
clipboard fallback. GitHub authentication and the final submit action happen
in the maintainer's browser. Marking a local report `EXPORTED` records that the
validated draft was successfully copied or that the issue composer was opened;
it does not prove that GitHub received or published an issue. Clipboard failure
does not mark export. A retry after local status transport failure reuses the
same idempotency key and reviewed revision without repeating the external
handoff.

## Issue a development fixture token

Development authentication accepts only a signed Bearer token. Plain actor or
household headers are ignored. Actor and household IDs in a token must be UUIDs,
and authenticated HTTP roles are only `PARENT` or `DASHBOARD`; the helper will
not issue `SYSTEM` tokens.

After building the API, set IDs for fixture records and issue a parent token:

```bash
export FIXTURE_HOUSEHOLD_ID="$(uuidgen)"
export FIXTURE_PARENT_ID="$(uuidgen)"
export FIXTURE_ROLE=PARENT
export FIXTURE_ACTOR_ID="$FIXTURE_PARENT_ID"
node --input-type=module --eval '
  import { issueDevelopmentActorToken } from "./apps/api/dist/auth/actor-context.js";
  console.log(issueDevelopmentActorToken({
    role: process.env.FIXTURE_ROLE,
    actorId: process.env.FIXTURE_ACTOR_ID,
    householdId: process.env.FIXTURE_HOUSEHOLD_ID,
  }, process.env.DEVELOPMENT_AUTH_SECRET));
'
```

The signed prospective parent can call `POST /v1/households`; that authenticated
operation creates the household and parent membership. Dashboard fixture rows
are seeded by the integration-test fixture helper (or explicitly in a local
database) before issuing a token with `FIXTURE_ROLE=DASHBOARD`. There is no
unauthenticated onboarding endpoint.

Use the printed value as `Authorization: Bearer <token>`. Every `POST` endpoint
also requires a UUID `Idempotency-Key` header.

### Development-token replay boundary

The fixture token format is deliberately minimal: it has no expiry, audience,
issuer, session identifier, or revocation check. A captured fixture token can
therefore be replayed indefinitely while the same development secret remains
configured. Use it only for local development and tests; rotating
`DEVELOPMENT_AUTH_SECRET` invalidates previously issued fixture tokens. The API
rejects this authenticator in production rather than treating these tokens as
production credentials.

Production token lifetime, issuer/audience validation, session revocation,
Google-backed parent identity, and dashboard pairing belong to the separate
parent authentication plan. Database row-level security, restricted CORS,
public-endpoint and mutation rate limits, TLS/reverse-proxy policy, production
secret handling, and deployment monitoring belong to the later Ubuntu
deployment/auth work. This core currently enforces household scope in the API
and database foreign keys; it does not claim RLS as a deployed defense layer.

## Health checks

The liveness endpoint does not touch the database. Readiness executes a database
query:

```bash
curl --fail http://127.0.0.1:3000/health/live
curl --fail http://127.0.0.1:3000/health/ready
```

Both return `{"status":"ok"}` when healthy.

## Stop the local database

Stop the container without deleting its named volume:

```bash
./scripts/dev-db.sh stop
```

Do not run `docker volume rm family-app-postgres-data` if the local data should
be preserved.
