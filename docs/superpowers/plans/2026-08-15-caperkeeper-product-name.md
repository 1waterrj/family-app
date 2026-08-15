# CaperKeeper Product Name Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply the approved CaperKeeper working name and tagline to current repository and install metadata without renaming public infrastructure or stable internal identifiers.

**Architecture:** Treat public product identity as a thin metadata layer over the existing `@family/*` monorepo. Test the two installable identity contracts—the dashboard PWA manifest and the parent Expo configuration—then update human-facing repository copy and the private root package name. Historical documents and operational identifiers remain unchanged.

**Tech Stack:** TypeScript 6, Expo 57, React Native 0.86, Vite 8, vite-plugin-pwa 1.3, Vitest 4, Jest 29, pnpm 11

**Spec:** `docs/superpowers/specs/2026-08-15-caperkeeper-product-name-design.md`

## Global Constraints

- User-facing product name is exactly `CaperKeeper`.
- Tagline is exactly `Managed mischief for busy families.`
- Public repository remains `https://github.com/1waterrj/family-app`.
- Planned household hostname remains `family.jordanwaters.net`.
- Preserve internal `@family/*` scopes, environment variables, storage keys, database names, Docker names, test fixtures, and historical records.
- Preserve existing placeholder icon filenames until a separate identity-design approval.
- Do not rename the GitHub repository or deploy public infrastructure.

---

### Task 1: Installable Product Identity

**Files:**
- Create: `apps/parent/test/app-config.test.ts`
- Modify: `apps/parent/app.config.ts`
- Modify: `apps/dashboard/test/pwa-config.test.ts`
- Modify: `apps/dashboard/vite.config.ts`
- Modify: `apps/dashboard/index.html`

**Interfaces:**
- Consumes: Expo's `ConfigContext`/`ExpoConfig` contract and the exported `dashboardPwaOptions` object.
- Produces: parent app identity `CaperKeeper`, slug `caperkeeper-parent`, scheme `caperkeeper`, mobile identifier `net.jordanwaters.caperkeeper`, and dashboard install identity `CaperKeeper` with the approved tagline.

- [ ] **Step 1: Write the failing parent Expo identity test**

Create `apps/parent/test/app-config.test.ts`:

```ts
import type { ConfigContext } from 'expo/config';

import createAppConfig from '../app.config';

describe('CaperKeeper parent app configuration', () => {
  test('resolves the public install identity on both mobile platforms', () => {
    const resolved = createAppConfig({ config: {} } as ConfigContext);

    expect(resolved).toMatchObject({
      name: 'CaperKeeper',
      slug: 'caperkeeper-parent',
      scheme: 'caperkeeper',
      ios: { bundleIdentifier: 'net.jordanwaters.caperkeeper' },
      android: { package: 'net.jordanwaters.caperkeeper' },
    });
  });
});
```

- [ ] **Step 2: Extend the dashboard test with the approved identity**

In `apps/dashboard/test/pwa-config.test.ts`, rename the suite to `CaperKeeper PWA configuration` and require the manifest to contain:

```ts
expect(dashboardPwaOptions.manifest).toMatchObject({
  name: 'CaperKeeper',
  short_name: 'CaperKeeper',
  description: 'Managed mischief for busy families.',
  display: 'standalone',
  orientation: 'landscape',
  icons: [
    {
      src: '/icons/family-kitchen-192.png',
      sizes: '192x192',
      type: 'image/png',
    },
    {
      src: '/icons/family-kitchen-512.png',
      sizes: '512x512',
      type: 'image/png',
    },
  ],
});
```

- [ ] **Step 3: Run both focused tests and verify RED**

Run:

```bash
pnpm --filter @family/parent test -- --runTestsByPath test/app-config.test.ts --runInBand
pnpm --filter @family/dashboard exec vitest run --config vitest.config.ts test/pwa-config.test.ts
```

Expected: the parent test fails because the resolved name is `Family`; the dashboard test fails because the manifest name is `Family Kitchen` and the approved tagline is absent.

- [ ] **Step 4: Apply the minimal parent identity**

Update `apps/parent/app.config.ts`:

```ts
name: 'CaperKeeper',
slug: 'caperkeeper-parent',
scheme: 'caperkeeper',
```

Use `net.jordanwaters.caperkeeper` for both `ios.bundleIdentifier` and `android.package`. Preserve all unrelated Expo settings.

- [ ] **Step 5: Apply the minimal dashboard identity**

Update `apps/dashboard/vite.config.ts` so the manifest has:

```ts
name: 'CaperKeeper',
short_name: 'CaperKeeper',
description: 'Managed mischief for busy families.',
```

Update the document title in `apps/dashboard/index.html` to:

```html
<title>CaperKeeper</title>
```

Preserve theme colors, icon paths, orientation, and caching behavior.

- [ ] **Step 6: Run focused tests and verify GREEN**

Run:

```bash
pnpm --filter @family/parent test -- --runTestsByPath test/app-config.test.ts --runInBand
pnpm --filter @family/dashboard exec vitest run --config vitest.config.ts test/pwa-config.test.ts
pnpm --filter @family/parent typecheck
pnpm --filter @family/dashboard typecheck
```

Expected: all commands exit zero with no test failures or TypeScript errors.

- [ ] **Step 7: Commit the installable identity**

```bash
git add apps/parent/app.config.ts apps/parent/test/app-config.test.ts apps/dashboard/index.html apps/dashboard/vite.config.ts apps/dashboard/test/pwa-config.test.ts
git commit -m "feat: brand installed apps as CaperKeeper"
```

### Task 2: Repository-Facing Identity

**Files:**
- Modify: `README.md`
- Modify: `package.json`

**Interfaces:**
- Consumes: the approved display name and tagline from the design spec.
- Produces: a public README introduction and private workspace package identity aligned with CaperKeeper.

- [ ] **Step 1: Update README identity copy**

Replace the README heading and introduction with:

```md
# CaperKeeper

> **Managed mischief for busy families.**

CaperKeeper is a local-first household dashboard and native-style parent app for shared calendars, claimable chores, parent-gated approvals, adjustable rewards, and child balance tracking.
```

Preserve the security warning, app/package map, local-development hostname, and repository privacy guidance.

- [ ] **Step 2: Update the private root package name**

Change only the root `package.json` `name` field:

```json
"name": "caperkeeper"
```

Do not rename workspace packages, scripts, environment variables, Docker resources, or local directories.

- [ ] **Step 3: Run repository verification**

Run:

```bash
pnpm --filter @family/parent test -- --runTestsByPath test/app-config.test.ts --runInBand
pnpm --filter @family/dashboard exec vitest run --config vitest.config.ts test/pwa-config.test.ts
pnpm --filter @family/parent typecheck
pnpm --filter @family/dashboard typecheck
pnpm format:check
pnpm verify:public-source-privacy
git diff --check
```

Expected: every command exits zero, privacy verification reports no violations, and Git reports no whitespace errors.

- [ ] **Step 4: Audit the naming boundary**

Run:

```bash
rg -n --hidden -S "CaperKeeper|Managed mischief" README.md package.json apps/parent/app.config.ts apps/parent/test/app-config.test.ts apps/dashboard/index.html apps/dashboard/vite.config.ts apps/dashboard/test/pwa-config.test.ts
git diff --stat
git status --short
```

Expected: the approved product identity appears in every changed public/install surface; the diff contains only the planned files; the remote URL, historical docs, and stable internal identifiers remain unchanged.

- [ ] **Step 5: Commit the repository identity**

```bash
git add README.md package.json docs/superpowers/plans/2026-08-15-caperkeeper-product-name.md
git commit -m "docs: introduce CaperKeeper brand"
```
