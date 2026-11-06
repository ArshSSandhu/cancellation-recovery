# Historical sharing preparation

This records the earlier local-only preparation. The repository has since been published and hosted configuration has been implemented. Use README.md and DEPLOYMENT.md for the current state; the future-tense checklist below is historical.

Prepared November 5, 2026. This document describes local preparation and the remaining steps; it is not a deployment record. This project contains fictional data only.

## Project boundary

The repository root is the existing `cancellation-recovery` directory. No publishing/staging copy was created. Sibling workspace directories are outside this repository. Local Git was initialized on `main`; no commit, remote, repository upload, deployment or conversation package was created in this step.

Included: Next.js app and backend source; pinned package manifest/lockfile; SQL migration and fictional fixture generator; real Postgres, rendered UI, HTTP and transport tests; setup scripts; environment example; architecture/verification/deployment notes. The seed generator creates fictional records; **no export of the current database or sessions belongs in Git**.

Excluded by `.gitignore` and `.vercelignore`: `.local` (database/store/session evidence), dependencies, build/type output, actual environment files, provider settings, private-key/credential files, database exports/backups, local screenshots/logs and test reports. `evidence/` stays on this workstation, so historical reports identify those captures as local artifacts. `.env.example` has only documented public local-demo passwords; hosted credentials do not exist in the project. The working app/data were not reset or copied.

Run from this root before publishing:

```sh
./run.sh check:share
git status --short --branch
git add --dry-run .
```

`check:share` checks the Git candidate list without staging anything: required source/configuration present, unexpected file types/locations rejected, representative private/generated paths ignored, and a focused scan for private keys, known token formats, session dumps, machine-specific home paths and unexpected connection passwords. It reads only Git-eligible project text. This is a limited guard, not a guarantee that every possible secret format will be detected. Review the actual file list again before the first commit; do not force-add ignored files.

## GitHub — next step

We need:

- A signed-in GitHub account with permission to create/push a repository for the intended user or organization.
- Repository owner, name (suggested `cancellation-recovery`) and visibility. Private is a sensible initial choice; public sharing is a separate deliberate decision.
- Commit author name and email (a GitHub no-reply address is an option). If public reuse is intended, choose a license; none has been invented here.
- Authorized GitHub connector/CLI access or normal Git HTTPS/SSH credentials. Store authentication in the normal credential/key manager, never in source or an authenticated remote URL.

Next: inspect the eligible file list, create the initial commit, create the approved empty repository, then push `main`. Repository root on GitHub will be this folder's contents, so a later Vercel Root Directory is **`.`**, not a nested workspace path. No GitHub account settings or resources were accessed/changed during preparation.

## Vercel + hosted Postgres — later step

Required accounts/configuration:

| Area | Needed before hosting |
|---|---|
| Vercel | Signed-in account/team with project/environment/protection permissions; permission to connect only the chosen GitHub repository; approved plan/budget. Pin Node 24 and pnpm 11.25.0; Next.js framework; install `pnpm install --frozen-lockfile`; build `pnpm build`; root `.`. No seed/migration/test harness in build hooks. |
| Neon | Signed-in account with permission to create Postgres 17 projects/branches, use `btree_gist`, and create restricted runtime roles; approved plan/budget. Choose a region near Vercel functions. |
| Runtime secret | A provider **pooled TLS `DATABASE_URL`** for a non-owner app role, scoped to that particular reviewer instance. Never a database-owner URL. |
| Operator credentials | A **direct owner/migration URL** kept outside the deployed runtime, used only by a reviewed migration/fixture release tool. Existing local tools refuse hosted targets and must retain that protection. |
| Reviewer access | Named reviewer accounts/access through Vercel Authentication with **All Deployments** protection, covering generated URLs and aliases. Standard Protection leaves production domains unprotected. |
| HTTPS/application origin | The exact deployed HTTPS origin per instance, with same-origin mutation enforcement and Secure/HttpOnly/SameSite cookies. Choose/configure the actual domains after creating projects. |
| Test isolation | Disposable local Postgres for current tests; separate disposable provider project/branch for future pooler compatibility checks. Neither gets shared demo credentials. |

The following code changes are still required, **not implemented by preparation**:

1. Add an explicit protected hosted-fictional-demo mode before changing the current `VERCEL` deny guard. Keep the identity selector labeled as impersonation. Vercel's reviewer gate controls who can enter the demo; it does not make staff/patient impersonation real authentication. Do not enable it on an unrestricted public URL. Real users would need real sign-in mapped to stored identities.
2. Replace the local HTTP/loopback origin rule with an exact configured HTTPS origin for each hosted instance. Set cookies Secure in hosted mode while preserving local production-build inspection over HTTP. Reject missing/invalid hosted configuration rather than falling back to loopback or trusting arbitrary forwarded hosts. Proposed configuration names such as `APP_ORIGIN`/`DEMO_MODE` must be implemented/tested in that later step; they are not working switches today.
3. Configure provider pooling/TLS, bounded connection usage and Vercel pool lifecycle handling. Keep one checked-out connection through BEGIN/COMMIT and the existing transaction-scoped lock. Verify timeouts, race/rollback/retry behavior and actual audit grants through the chosen pooler. Do not disable TLS certificate verification.
4. Add provider-specific migrations and explicit operator-only fictional fixture creation/reset for an already-created hosted database. Use generated credentials; do not reuse local defaults. Runtime must not have reset/DDL/owner privileges. No fixture/fault/reset HTTP endpoints.

See [DEPLOYMENT.md](DEPLOYMENT.md) for technical release gates and dated pricing links. Do not set provider credentials, real patient records, reset flags or test-only fault settings as public/browser variables.

## Independent reviewer trials — recommended default

For a handful of reviewers, give **each reviewer a protected Vercel project/URL and a separate Neon branch/database** initialized from a fresh fictional template. All projects can use the same GitHub source; only their database URL, allowed application origin and gate access differ. This costs more configuration/possibly usage than one shared instance, but avoids adding a new tenant/workspace feature to the app.

Use separate per-instance runtime credentials and host-only session cookies. A reviewer may switch between the fictional staff and patient identities within their own instance. Two reviewers opening different URLs then cannot cancel or move each other's appointments because their servers address different databases. Incognito windows or different sign-ins alone **do not** isolate records if the backend URL still points to the same database.

Create the fictional template just before the review window so relative appointment dates remain useful. New reviewer branches must not contain sessions from a previous reviewer. Retire/reset only that reviewer's disposable instance afterward with the operator's explicit target confirmation. Do not share the current local database, reset on deployment, or run tests against reviewer datasets. Branch/project limits and usage costs must be checked before provisioning; no such resources were created here.

Neon documents isolated branch data, and Vercel supports project-scoped configuration and protection. This per-reviewer arrangement is our recommendation, not a behavior already implemented or tested remotely. [Neon branching](https://neon.com/docs/introduction/branching), [Vercel environment variables](https://vercel.com/docs/environment-variables), [deployment protection](https://vercel.com/docs/deployment-protection).

## Preparation checks performed

The Git-eligible set contained **43 reviewed project files**. The sharing guard and Git dry-run passed with an empty index and no remote. Only those reviewed text/source files were used to update the prior isolated validation copy; no actual environment, database, session, dependency or captured evidence files were copied from the working project.

Lockfile consistency, type checking without the ignored generated Next declaration file, all **36 regression tests**, optimized production build, HTTP authorization checks and the deliberately discarded-response HTTP test passed. Database tests used the separate validation instance at port 55433; the updated harness fingerprinted that configured demo rather than the working demo at 55432. Test app/proxy/database processes were stopped after checking preservation. No fresh browser behavior or hosted behavior was inspected in this preparation step; the production browser journey in REVIEW.md belongs to the preceding review.

The working app still returned HTTP 200 at http://127.0.0.1:3000/. The complete before/after working-database fingerprint, including sessions and audit, matched. The running app/database and unrelated workspace files were preserved. No files were staged or committed, and nothing was published, deployed, provisioned or packaged.
