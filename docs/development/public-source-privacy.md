# Public-source privacy

This repository ships fictional development fixtures only. Do not commit real household data, names that identify a family, local account details, private hostnames, or company infrastructure. Real household information belongs in ignored local configuration and the local database.

The public-source privacy gate scans the Git index, plus intentionally untracked production artifacts under `apps/parent/dist` and `apps/dashboard/dist`. It requires an ignored policy at `.local/public-source-privacy-denylist.json`. The gate fails closed when the policy or any scanned input cannot be audited safely.

## Contributor and maintainer responsibilities

Contributors should use fictional fixtures and may use the fictional policy example below to exercise the gate locally. A contributor policy is not a publication approval: it cannot attest that private maintainer values are absent.

Maintainers own the authoritative six-category policy. It remains in owner-only local storage, is never sent to contributors, and is never added to source control. A maintainer must run the publication gate with that authoritative policy before a release and must use the same policy for clean-clone audits.

`credential-shape` is not a policy key. Public credential-prefix detection is a separate tracked gate and remains case-sensitive. It checks exact raw ASCII token-prefix bytes because that is the established public credential shape; a UTF-16 representation is not a valid instance of that byte-level token syntax. Private-value matching in recognized binary metadata separately examines explicit UTF-8, UTF-16LE, and UTF-16BE views.

## Secure bootstrap

From the repository root, create an owner-only policy location:

```bash
umask 077
mkdir -p -m 700 .local
chmod 700 .local
install -m 600 /dev/null .local/public-source-privacy-denylist.json
```

Open the file in an editor, for example `vi .local/public-source-privacy-denylist.json`, and enter values there. Never put a private value directly in a shell command, command-line argument, or environment assignment where it could enter shell history or process listings.

The schema is exactly six keys, each containing a nonempty array of nonempty strings. This example is entirely fictional:

```json
{
  "child-name": ["Synthetic Child Alpha", "Synthetic Child Beta"],
  "household-name": ["Synthetic Household"],
  "prohibited-account": ["fictional-owner-account"],
  "obsolete-hostname": ["obsolete.example.invalid"],
  "local-user-path": ["/Users/fictional.user"],
  "company-infrastructure": ["Fictional Company Registry"]
}
```

The scanner canonicalizes private values and candidate text with Unicode NFKC normalization, English-locale lowercase conversion, default-ignorable code-point removal, and Unicode-whitespace collapse. Policy values that become empty or duplicate another value after canonicalization are rejected.

## Validate local handling

On macOS, confirm the directory and file modes:

```bash
stat -f '%Sp %N' .local .local/public-source-privacy-denylist.json
```

On Linux, use:

```bash
stat -c '%A %n' .local .local/public-source-privacy-denylist.json
```

Then confirm the policy is ignored and no `.local` content is tracked:

```bash
git check-ignore -v .local/public-source-privacy-denylist.json
git ls-files .local
```

The first command must identify an ignore rule. The second command must print nothing. The expected modes are `0700` for `.local` and `0600` for the policy file.

Run the gate under the supported Node.js version:

```bash
pnpm verify:public-source-privacy
```

Missing, unreadable, malformed, insecure, incomplete, empty, unsupported, canonically duplicate, unmerged, unsupported-mode, or otherwise unauditable input blocks the scan by design. Findings report only a category and a safe relative path. When a pathname itself is sensitive, the scanner substitutes a non-sensitive placeholder.

## Maintainer clean-clone audit

Keep the authoritative source policy outside the clone. Prompt for its path so it is not written into shell history, create the clone's local directory with owner-only permissions, and copy the file without displaying it:

```bash
(
umask 077
read -r -p 'Existing clean clone root: ' audit_clone
read -r -p 'Authoritative policy path: ' privacy_policy_source
if [[ -z "${audit_clone}" || "${audit_clone}" == "/" ]]; then
  printf 'Refusing an empty or root clean-clone path.\n' >&2
  unset audit_clone privacy_policy_source
  exit 1
fi
if [[ ! -d "${audit_clone}" || -L "${audit_clone}" ]]; then
  printf 'The clean-clone path must be an existing physical directory.\n' >&2
  unset audit_clone privacy_policy_source
  exit 1
fi
audit_clone_root="$(cd "${audit_clone}" && pwd -P)" || exit 1
audit_git_root="$(git -C "${audit_clone_root}" rev-parse --show-toplevel 2>/dev/null)" || exit 1
if [[ "${audit_git_root}" != "${audit_clone_root}" ]]; then
  printf 'The selected path is not the clean clone root.\n' >&2
  unset audit_clone audit_clone_root audit_git_root privacy_policy_source
  exit 1
fi
if [[ ! -f "${privacy_policy_source}" || -L "${privacy_policy_source}" ]]; then
  printf 'The policy source must be a physical regular file.\n' >&2
  unset audit_clone audit_clone_root audit_git_root privacy_policy_source
  exit 1
fi
if [[ -e "${audit_clone_root}/.local" && ( -L "${audit_clone_root}/.local" || ! -d "${audit_clone_root}/.local" ) ]]; then
  printf 'The clean clone has an unsafe .local path.\n' >&2
  unset audit_clone audit_clone_root audit_git_root privacy_policy_source
  exit 1
fi
mkdir -p -m 700 "${audit_clone_root}/.local"
chmod 700 "${audit_clone_root}/.local"
install -m 600 "${privacy_policy_source}" "${audit_clone_root}/.local/public-source-privacy-denylist.json"
unset audit_clone audit_clone_root audit_git_root privacy_policy_source
)
```

Run `stat`, `git check-ignore`, `git ls-files .local`, and `pnpm verify:public-source-privacy` inside the clean clone. Never print, diff, archive, paste, or commit the authoritative policy. Remove the clean clone through the maintainer's normal secure temporary-file process after recording only pass/fail status.
