# CaperKeeper Product Name Design

**Date:** 2026-08-15

**Status:** Approved working name

## Decision

The product's working name is **CaperKeeper**.

The approved tagline is:

> **Managed mischief for busy families.**

`CaperKeeper` is always written as one word with an internal capital `K` in
user-facing copy. Machine-readable identifiers use lowercase `caperkeeper`
with a platform-appropriate suffix when one is needed.

## Rationale

The name combines the playful, adventurous meaning of a *caper* with the
dependability of a *keeper*. It describes a product that lets children retain
agency and fun while parents provide the structure required for calendars,
timed chores, approvals, and allowance balances.

The name supports a durable visual system without forcing the product into a
licensed-fantasy or school-house aesthetic. Parent experiences can remain calm
and native while the kitchen dashboard can use more expressive task cards,
celebrations, and child-friendly language.

## Product Vocabulary

The working vocabulary is deliberately small:

- **CaperKeeper** is the product and installed-app name.
- **Capers** may be used for child-facing chores when the meaning remains clear.
- **Caper Library** may be used for the reusable chore-template library.
- **Caper complete** may be used as a child-facing completion celebration.

Parent-facing actions continue to use plain language such as *Approve*,
*Adjust reward*, *Balance*, and *Feedback*. Terms such as *Keeper Review* and
*The Keep* are not locked by this decision and require a later copy review.

## Repository and Runtime Scope

This naming pass updates current public product identity:

- the root README title, introduction, and tagline;
- the parent app's Expo display name, slug, URL scheme, and pre-release mobile
  identifiers;
- the dashboard document title and installable PWA metadata.

The following remain unchanged:

- the public GitHub repository URL `https://github.com/1waterrj/family-app`;
- the planned household hostname `family.jordanwaters.net`;
- the private root package name `family-app`, internal `@family/*` package
  scopes, environment-variable names, storage keys, database names, Docker
  resource names, and test fixtures;
- historical design and implementation records that accurately describe the
  repository at the time they were written;
- existing placeholder icon filenames until a CaperKeeper logo and icon set is
  approved.

Keeping those internal identifiers stable avoids unnecessary migration risk and
makes the working-name change easy to reverse. Renaming the public GitHub
repository or deploying branded production infrastructure requires a separate
explicit decision.

## Platform Identity

- Product display name: `CaperKeeper`
- Root package name: `family-app` (stable internal identifier)
- Expo slug: `caperkeeper-parent`
- Deep-link scheme: `caperkeeper`
- iOS bundle identifier: `net.jordanwaters.caperkeeper`
- Android application ID: `net.jordanwaters.caperkeeper`
- Dashboard PWA name and short name: `CaperKeeper`
- Dashboard description: `Managed mischief for busy families.`

These mobile identifiers are being changed before an app-store release. Once a
production app is published, future identifier changes require an explicit
migration plan.

## Validation Boundary

Preliminary searches found no exact CaperKeeper product, app-store listing,
GitHub repository, or indexed trademark collision, and the `.com` and `.app`
registry lookups returned not-found responses on 2026-08-15. This is a naming
screen, not legal clearance. The existing CAPER software marks mean a formal
trademark review is still appropriate before commercial release.

## Acceptance Criteria

- Current user-facing repository and install metadata use `CaperKeeper`.
- The exact tagline appears in the README and dashboard PWA description.
- Tests guard the dashboard PWA and parent Expo identity contracts.
- Stable internal identifiers and historical records remain unchanged.
- No GitHub repository rename or public deployment occurs in this change.
