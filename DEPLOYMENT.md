# Shared public fictional demo — current configuration

The owner explicitly approved sharing the existing fictional dataset publicly. The canonical URL is https://cancellation-recovery.vercel.app/; no Vercel account is required. Visitors can select any fictional identity, inspect fictional audit entries and change shared bookings. This is impersonation, not real authentication. Enter no personal information, including in free-text reasons. Other visitors can interrupt a walkthrough; refresh before acting. The saved dataset is not reset on deployment.

Production uses `DEMO_MODE=public-fictional` and `REVIEWER_ACCESS=shared-public-fictional`, with the existing exact `APP_ORIGIN`, Secure/HttpOnly/SameSite cookies and restricted pooled TLS database role. `lib/hosting.ts` still rejects absent/unacknowledged modes, other hosts and origins. Vercel Standard Protection leaves production domains public while retaining protection for generated deployment URLs and previews. Only this project's protection setting changes; no automation bypass or paid service is created. Use the canonical URL; the app refuses other API hosts.

`db/002_public_demo.sql` is additive: a bounded three-row request-budget table plus an expiry index for sessions. The initializer and local migration script apply it once without reseeding. `lib/request-limits.ts` enforces atomic shared 60-second windows across instances: 20 sign-ins, 60 actions, 120 state reads. Rejected requests return HTTP 429 with Retry-After 60 before booking work. Windows reset lazily; no IP addresses are stored. Global budgets are basic protection, not fair per-visitor allocation or DDoS protection: one visitor can temporarily exhaust them. Refreshes can still block scheduling briefly through the existing database lock. No paid limiter service or visitor workspaces are used.

Successful identity validation during sign-in triggers deletion of expired sessions only. Live sessions, offers, bookings and audit history are retained. Cleanup is opportunistic, so expired rows can remain until the next sign-in. Reset and fault tools remain workstation/test-only; no new HTTP endpoint was added. Normal operation uses no owner credentials. Local databases are not migrated or reset as part of hosting this change.

Public-release checks: 44 isolated database/UI/configuration tests, TypeScript and a production build passed. Added checks cover concurrent budget enforcement/window renewal and cleanup preserving live sessions, bookings and audit. Actual signed-out production checks are recorded in the task report. The older owner-only release record below is historical and does not describe current public access policy.

---

# Protected fictional deployment

This is a personal, non-commercial demonstration, **not a system for real patient information**. The public source is https://github.com/ArshSSandhu/cancellation-recovery. The assigned reviewer URL is https://cancellation-recovery.vercel.app/.

## Access and isolation

The first instance is for the owner only. Vercel Authentication is set to **All Deployments**, covering production domains and generated URLs. Standard Protection excludes production domains. Do not issue share links, automation bypass credentials or access exceptions. A configuration marker in the app does not enforce this platform policy: check the actual setting and signed-out requests before activating hosted mode. [Vercel protection](https://vercel.com/docs/deployment-protection).

After entering through Vercel, the passwordless selector impersonates fictional staff/patients. It is **not real staff/patient authentication**. Server sessions enforce the selected identity's role and ownership on every application request. Cookies are host-only `__Host-recovery_session`, Secure, HttpOnly, SameSite=Strict, path `/`, with an eight-hour maximum. Alternate deployment hosts are refused by the app; use the assigned canonical URL.

The `REVIEWER_INSTANCE_ID` setting is an instance label, not a tenant boundary. Independent reviewers must have separate protected Vercel projects/URLs and separate freshly initialized Neon databases/credentials. Different browser profiles alone do not isolate records. Only the owner instance has been provisioned; broader reviewer access requires a deliberate setup step. Never clone existing reviewer sessions into a new trial.

## Infrastructure and runtime

- Vercel project `cancellation-recovery`, personal Hobby scope, Next.js preset, Node **24.x**, pnpm **11.25.0**, root `.`. Install `pnpm install --frozen-lockfile`; build `pnpm build`. Functions in `cle1`, near Neon's Ohio region. No paid upgrades/add-ons were selected.
- Existing Neon project `rapid-field-06581545`, organization `org-broad-sound-58466192`, branch `production`, region `aws-us-east-2`, PostgreSQL **18**. The organization plan was checked as **Free**. Postgres is the only service; `neon.ts` disables Neon Auth and adds no functions/storage/AI service.
- Database `recovery_demo` is separate from both local `recovery` and `recovery_test`. Owner-created `recovery_app` has a generated secret and no owner/superuser/create-role/create-database privileges or role memberships.
- Runtime uses only the **pooled** Neon URL. `pg` retains one checked-out client through each transaction. `lib/hosting.ts` requires the intended role/database/Neon pooler and certificate-verifying TLS, with a pool of three, short idle timeout and bounded connection wait. `lib/db.ts` attaches Vercel's pool lifecycle helper. Never disable certificate verification. [Neon pooling](https://neon.com/docs/connect/connection-pooling), [Vercel pool helper](https://vercel.com/docs/functions/functions-api-reference/vercel-functions-package).
- Transaction-scoped advisory lock `710428` serializes commands and refreshes across this database, including unrelated clinicians/patients. Refreshes expire offers and therefore also write audit entries. Five-second lock and ten-second statement timeouts bound blocking. This is acceptable for a small demo; sustained contention/traffic would justify narrowing locks and separating expiry from reads. No redesign was required.

## Production environment

Configure these **only for production**, after verifying protection:

| Variable | Value/purpose |
|---|---|
| `DATABASE_URL` | Sensitive secret: generated `recovery_app` pooled verified-TLS URL for `/recovery_demo` |
| `DEMO_MODE` | `protected-fictional` |
| `REVIEWER_ACCESS` | `vercel-auth-all-deployments` — records a verified external policy; does not create it |
| `APP_ORIGIN` | `https://cancellation-recovery.vercel.app` exactly, no trailing slash |
| `REVIEWER_INSTANCE_ID` | `arsh-owner` |

Vercel supplies `VERCEL`. Missing hosted configuration refuses demo access. Mutations require the exact configured Host and Origin; forwarding headers do not grant access. App errors log only static messages and database error codes, not raw connection strings.

Do not deploy owner/admin URLs, test URLs, local passwords, reset flags or fault settings. Nothing is prefixed `NEXT_PUBLIC_`. Previews have no production database configuration; do not copy these settings to previews. Local `.env.local` keeps local configuration and must not point to the hosted demo by accident.

## Workstation-only Neon initialization

The requested official CLI setup was run with Neon 9.1.0. This workstation needed a temporary npm/npx wrapper because npm was not in its ordinary PATH. On a normal Node/npm installation:

```sh
npm i -g neon@latest
# If global installation fails, replace neon below with npx neon@latest.
neon init -y --org-id org-broad-sound-58466192 --project-id rapid-field-06581545 --branch production --services postgres --agent codex
neon deploy
```

**These provider commands pull privileged owner URLs into `.env.local` (or an existing `.env`).** Before running them in a working checkout, privately back up existing environment files. Move the pulled provider values into an ignored, access-restricted operator file such as `.local/hosting/neon-pulled.env`, then restore the original local environment. Never print, commit or deploy that file. Keep its directory private and files mode 600. Installed Neon skills, `.neon`, provider settings and credentials are ignored by Git and CLI uploads.

From the selected project root, initialize only the empty hosted database:

```sh
HOSTED_SETUP_CONFIRM=empty-fictional-database ./run.sh db:hosted:setup .local/hosting/neon-pulled.env
```

`scripts/hosted-setup.ts` accepts a direct Neon owner URL from that private file, creates the restricted role and named database, applies `db/001_initial.sql`, inserts fictional relative-date fixtures only into a new empty schema, and applies `db/runtime_role_grants.sql`. It writes the pooled application URL to ignored `.local/hosting/runtime.env`. Only that application URL goes to Vercel as a sensitive secret. Setup checks actual runtime privileges, including audit update/delete/truncate denial and absence of role memberships. Rerunning with the same private profile preserves all records; it does not rotate an existing role's password or reset data.

Never add initialization, migrations, seed, reset, embedded Postgres or test commands to Vercel build/start hooks. The hosted role cannot edit identities/clinicians/slot details or delete appointments/audit; its narrow slot-ID update grant is required for `SELECT FOR UPDATE`. Only the three application API routes are built.

For future schema changes, use a reviewed direct-owner migration outside builds. This initializer handles the current `001_initial` schema, not an automatic future migration framework. Runtime credentials cannot execute owner migrations.

## Release and verification

Before publishing code: `./run.sh check:share`, inspect the Git candidate list/diff, `./run.sh typecheck`, and the documented `./run.sh test` against isolated local Postgres. Build from the lockfile in a separate checkout. Vercel also checks Git author identity; use an email verified on the connected GitHub account or its correct GitHub no-reply address. Do not rewrite old commits just to change authorship.

For provider compatibility, `tests/neon-smoke.ts` is an explicit operator test against a **fresh, disposable Neon branch** with fictional fixtures and the inherited restricted runtime role:

```sh
NEON_SMOKE_CONFIRM=isolated-verification-branch ./run.sh test:neon path/to/private-verification.env path/to/private-production-runtime.env
```

The test refuses the production endpoint and a branch that already has offers. Both files contain `DATABASE_URL`; no URL goes in command arguments/output. It overlaps two requests on separate connections, observes distinct waiting Postgres backends (clearing cached statistics snapshots), and checks exclusive sending, rollback, concurrent acceptance, replay, access boundaries and audit denial. It changes only that disposable branch and does not reset data. Remove the exact test branch afterward; do not run local destructive tests against hosting. The broader 41-check race/deadline suite remains isolated on local `recovery_test`.

Verify production with normal owner browser access: cancel Casey's opening, offer to Maya, switch patient, compare, accept, refresh, and check recorded acceptance/audit. Test stale staff/patient tabs after switching identities. Separately request `/`, `/api/state` and `/api/demo` without cookies on canonical/generated URLs: the platform must block access. Do not use an authenticated response to claim a URL is private.

**Avoid `vercel curl` for owner-only checks:** this CLI version automatically creates a persistent automation bypass credential. An initial attempt created one; it was revoked and zero remaining bypass entries were verified. Use the normal signed-in browser. Do not enable fault hooks in the hosted app; the lost-response HTTP proxy remains a local test harness.

## Repeatability, cost and remaining limits

Local reset is documented in README and requires explicit confirmation; local tools refuse hosted targets. There is **no hosted reset endpoint or reset command**. For a fresh hosted review, provision an explicitly approved empty fictional instance using the initializer and separate credentials, then retire only the old named disposable instance if its history is no longer needed. Never reset on deploy or page visit. Preserve/export history before any deliberate deletion; backup restoration has not been tested.

Only free personal-demo resources were authorized. Free limits can suspend/block usage, and scale-to-zero can add initial latency. Monitor the provider dashboards; do not upgrade or enable paid features without approval. [Vercel Hobby](https://vercel.com/docs/plans/hobby), [Neon pricing](https://neon.com/pricing).

This remains a fictional prototype: no real authentication, clinical integrations, messaging, multi-clinic tenancy, production load guarantee, validated recovery/backup plan or suitability for real patient data. Hosted response-loss fault injection, the full race/deadline suite against Neon, and concurrent independent reviewer provisioning are not claimed as verified. See the release record below for actual browser and automated results.

## Release record — November 6, 2026

- Official `neon init` and `neon deploy` completed for the supplied project/production branch. Initialization and an idempotent recheck passed through the restricted pooled TLS role; PostgreSQL 18.6, no role memberships and audit edit/delete/truncate denial were checked. No original local records were copied to Neon.
- Separate validation checkout: frozen lockfile install, **41/41 tests**, TypeScript and **`npm run build` passed**. Build output included `Compiled successfully`, static pages `5/5`, and only `/api/action`, `/api/demo`, `/api/state` as application APIs.
- A separate disposable Neon branch passed the actual application transaction smoke check: two observed waiting backends, one exclusive send, rollback after writes, concurrent acceptance, one move audit, replay, staff/ownership boundaries and denied audit deletion. All four temporary diagnostic/verification branches were removed afterward; production was preserved. The initial overlap observation incorrectly reused a cached statistics snapshot; the test was corrected to clear it. The application locking code did not change.
- Vercel production deployment `dpl_GkJbe6eLAyMXoEgZRBeW8bGBANTd` reached `READY`, built successfully and was aliased to the assigned URL. Browser inspection used this hosted production app, not just localhost.
- Browser: staff signed in, read the five seeded appointments, cancelled Casey's November 9 visit, reviewed Maya/Jordan matches and sent Maya an exclusive offer. Maya saw her November 20 booking still confirmed and the exact EST deadline, accepted November 9, refreshed, and used **Check recorded acceptance**. The response returned the recorded booking; the clinic refresh and expanded audit agreed. A direct read through the actual restricted hosted role confirmed one accepted offer, one replacement, one retained replaced source and exactly **one** `appointment.moved` entry.
- Hosted browser authorization: after switching to Maya, stale staff controls were rejected with **Staff access required**. After switching to Jordan, Maya's stale acceptance control was rejected with **Offer not found**; Jordan saw only his November 22 booking and no Maya offer. Neither failed attempt changed bookings.
- Nine signed-out HTTP checks (`/`, `/api/state`, `/api/demo` on canonical, generated deployment and team alias URLs) returned **401 with Vercel authentication text** after hosted mode was enabled. Project settings showed All Deployments and **zero automation bypass credentials**. The browser entered normally through the owner's Vercel session.
- Publishing initially failed because Vercel's GitHub identity connection was incomplete. The owner approved a project-local GitHub no-reply address for a new commit; the existing commit was left unchanged, normal GitHub authorization was completed and only the intended repository was connected. The batch environment upload was rejected and corrected to individual settings. Free Neon rejected a custom suspend interval, so its default was retained. No paid upgrade was used.
- The full original local-demo fingerprint, including sessions and audit, matched its pre-hosting baseline. No local seed/reset was run. The hosted dataset retains the completed walkthrough: Maya has already moved; the released November 20 slot remains available for a Jordan offer. Verification screenshots stay ignored under `evidence/` on the operator workstation.

Not verified remotely: intentional loss of the acceptance response, every deadline/revoke race on Neon, load/cold-start reliability, independent reviewer provisioning, or backup restoration. Lost-response HTTP/browser fault checks and the broader race suite remain isolated local checks. No production fault injection was added.
