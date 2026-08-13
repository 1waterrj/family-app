# Family App

Family App is a local-first household dashboard and parent application for shared calendars, chore claiming, parent-gated approvals, adjustable rewards, and child balance tracking.

> **Current security boundary:** run this project on a trusted LAN only. The development authenticator is not approved for public ingress. Do not expose the API or dashboard through Cloudflare Tunnel until production authentication is implemented.

## Apps and packages

- `apps/api` — household data, chore workflow, approvals, balances, calendar integration, setup diagnostics, and feedback intake.
- `apps/dashboard` — touch-first kitchen display for children.
- `apps/parent` — native-style iOS and Android parent application.
- `packages/*` — shared contracts, design tokens, domain logic, and supporting libraries.

## Local development

Use Node.js 24 and pnpm 11. Start with the local setup and Ubuntu development-host instructions in [`docs/development/client-vertical-slice.md`](docs/development/client-vertical-slice.md).

The intended future public hostname is `family.jordanwaters.net`, but public ingress remains disabled until the authentication milestone is complete.

## Repository privacy

Committed examples use fictional household data. Real household information belongs only in ignored local configuration and the local database.

Read the [public-source privacy guide](docs/development/public-source-privacy.md) before contributing or auditing a release. It explains the contributor and maintainer workflows, secure local-policy bootstrap, and clean-clone audit procedure. The maintainer's authoritative policy is local-only and must never be shared or committed.

Run `pnpm verify:public-source-privacy` before publishing changes.
