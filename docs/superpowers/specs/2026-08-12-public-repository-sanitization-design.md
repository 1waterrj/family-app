# Public Repository Sanitization Design

## Goal

Publish `1waterrj/family-app` as a public GitHub monorepo without publishing
family-identifying development data, credentials, obsolete hostnames, local
machine paths, or the repository's pre-sanitization Git history.

The deployed application may eventually contain real household data, but that
data must enter through runtime setup and remain in local storage and the local
database. Public source, tests, examples, screenshots, documentation, and Git
metadata use fictional values only.

## Publication boundary

The public repository will contain one new root commit representing the fully
sanitized and verified source tree. No pre-sanitization commit, branch, tag, or
other ref will be pushed.

Before rewriting local `main`, create and verify a Git bundle under the ignored
`.local/backups/` directory. The bundle is a local recovery artifact only. Do
not create a backup branch or tag, because a later `git push --all` or
`git push --tags` could publish the old history accidentally.

The public repository will be created only under the active personal GitHub
account `1waterrj`. The prohibited alternate account must not appear in source,
Git configuration for this operation, remotes, or the GitHub destination.

## Source anonymization

Replace family-specific fixtures throughout production development seeds,
tests, end-to-end scenarios, design tokens, documentation, and planning
artifacts:

- household display name: `Example Family`;
- child fixtures: `Avery` and `Riley`;
- child-specific token keys and local variable names: neutral primary/secondary
  identifiers rather than real names;
- ages, birthdays, and prose describing the real household: generic product
  requirements with no identifying values;
- hostname findings in the `obsolete-hostname` category: remove them without
  reproducing obsolete variants;
- employer-specific infrastructure warnings: replace with a general rule that
  the project uses public package registries and no company infrastructure;
- absolute developer-machine paths and other local identity strings: remove or
  replace with portable placeholders.

The intended public domain, bundle identifier, GitHub username, and repository
name are public project metadata and may remain. No domain record, tunnel token,
GitHub token, fixture credential, or private address is committed.

## Preventing recurrence

Add a tracked-source privacy verifier and an adversarial self-test. The verifier
must:

- enumerate tracked files rather than scanning ignored runtime data;
- reject the real child names, household phrase, prohibited alternate GitHub
  account, the `obsolete-hostname` category, local absolute user paths, and
  known credential shapes;
- load family-, account-, hostname-, path-, and company-specific match values
  from the ignored owner-readable policy at
  `.local/public-source-privacy-denylist.json`, never from tracked source;
- require an owner-only `.local` directory and a `0600` policy containing exactly
  `child-name`, `household-name`, `prohibited-account`, `obsolete-hostname`,
  `local-user-path`, and `company-infrastructure`, with a nonempty array of
  nonempty strings for each category;
- fail closed with category-only errors when the local policy is missing,
  unreadable, malformed, insecure, incomplete, or contains unsupported data;
- report only file paths and finding categories, never matching private text;
- fail closed on unreadable tracked files while safely skipping recognized
  binary assets; and
- run from a root package script and as part of production-bundle verification.

The self-test uses an owner-only temporary policy containing obviously fictional
synthetic values to prove each prohibited class and policy failure mode. It does
not encode the owner's denylist, and it cleans up on normal exit and signals.

Existing generic credential-prefix and GitHub-token scanners remain independent
gates because their public credential shapes are not household-private values.
`credential-shape` is not a local-policy key.

## Public repository presentation

Add a concise root README that explains the monorepo, its LAN-only current
status, the parent/dashboard/API packages, and where to find the local runbook.
It must prominently state that the current development authenticator is not
approved for public ingress. Do not add a software license in this operation;
license selection is a separate owner decision.

Create `1waterrj/family-app` with public visibility, issues enabled, and a short
description. Attach it as `origin` and push only the rewritten `main`. No GitHub
API token, deployment secret, or family data is stored in repository settings.

## Rewrite and verification flow

1. Work on an isolated sanitization branch and linked worktree.
2. Add the privacy verifier first and observe it fail against the current tree.
3. Anonymize source and documentation until the privacy verifier passes.
4. Run unit, integration, type, lint, formatting, migration, build, end-to-end,
   credential, and production-bundle gates under Node.js 24.
5. Review `git diff`, tracked files, ignored local fixtures, and generated
   artifacts.
6. Create and verify the local recovery bundle containing the old refs.
7. Create a root commit directly from the sanitized tree using the active
   GitHub account's public-safe noreply identity.
8. Move local `main` to that root commit only after confirming the main
   worktree is clean and still points at the expected pre-rewrite commit.
9. Copy the ignored privacy policy into rewritten `main` under an owner-only
   `.local` directory, then re-run the privacy scanners and full release gate.
10. Confirm `main` has exactly one reachable commit and no tags or branches
    reachable from the old history.
11. Create the public repository and push only `main`.
12. Inspect the remote refs and GitHub repository metadata after publication,
    then copy the ignored policy into the owner-only audit clone before its
    privacy scan.

If any privacy or verification gate fails, do not create or push the public
repository. If publication fails after repository creation, leave the local
recovery bundle intact, keep the remote private or empty when possible, and
report the exact non-secret failure.

## Success criteria

- The public GitHub repository is exactly `1waterrj/family-app` and is public.
- Remote `main` contains one sanitized root commit.
- No public reachable blob or commit contains the prohibited family identifiers,
  obsolete hostname, local developer paths, development fixtures, or credentials.
- Tests and production builds retain the same behavior with fictional fixtures.
- Missing or insecure local privacy policy state blocks source and production
  verification, while the ignored policy remains untracked and unpublished.
- `origin` points only to the intended repository.
- The ignored local recovery bundle exists and verifies successfully but is not
  tracked or pushed.
