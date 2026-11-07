# Earlier — cancellation recovery

A fictional psychiatric clinic demo: when a patient cancels, staff can offer the opening to an eligible waiting patient. Accepting moves their follow-up atomically, without double-booking or losing the existing booking on failure. No real patient data, healthcare integrations, email/SMS, or LLMs.

## Workflow

1. Choose **Alex Morgan · Staff**, then **Sign in / switch**. Cancel Casey’s earliest appointment with a reason.
2. Review eligible waiting patients and matching/exclusion reasons. Maya is longest waiting; selecting another eligible patient requires a recorded reason.
3. Send one exclusive offer. The reply deadline is the earlier of two hours after sending or 24 hours before the visit. Shortened windows are shown; sending after the cutoff is refused.
4. Switch to **Maya Chen · Patient**. Compare the earlier visit with the still-booked original, then accept or keep the existing appointment (decline).
5. Refresh both views to see the move. Staff can inspect retained appointment history and audit entries, or withdraw a pending offer with a reason.

The **demo identity switcher is passwordless impersonation, not real authentication**. Anyone granted access to an instance can choose staff or any fictional patient. Server sessions still enforce staff permissions and patient ownership for each request. Tabs share the identity cookie; use separate browser profiles for independent identities. The hosted public demo deliberately shares all fictional records between visitors. No Vercel account is needed at the canonical URL. Anyone can impersonate every fictional identity; never enter personal information.

## Architecture and booking correctness

Next.js 16.4.5 / React 19, TypeScript, Node.js, `pg`, and real PostgreSQL (17 locally; the selected Neon project runs 18). Stored state plus an append-only audit trail; no event sourcing or background queue.

- [`lib/scheduling.ts`](lib/scheduling.ts): matching, commands, deadlines and atomic acceptance. One transaction checks ownership, current source version, eligibility and availability, inserts the replacement, marks the original replaced, records the result on the offer, completes the waitlist entry and writes the move audit. Failure rolls everything back; retry returns the recorded result.
- [`db/001_initial.sql`](db/001_initial.sql): one booked appointment per slot, no overlapping clinician slots or patient bookings, exclusive pending offers, time/FK/status checks and audit trigger.
- [`lib/db.ts`](lib/db.ts): checked-out connection, transaction-scoped shared scheduling lock, five-second lock timeout and ten-second statement timeout. Refreshes also take this lock because they expire offers. This serializes unrelated patients/clinicians; acceptable for a small demo, not demonstrated at scale.
- [`lib/auth.ts`](lib/auth.ts), [`app/api`](app/api): opaque server sessions, role/ownership checks, exact origin enforcement and Secure host-only cookies on hosting. Runtime uses restricted `recovery_app`; migrations/reset use an administrator.

See [REVIEW.md](REVIEW.md) for the code review and clean production-build verification, [SHARING.md](SHARING.md) for GitHub preparation and independent reviewer trials, and [DEPLOYMENT.md](DEPLOYMENT.md) for hosted setup, access protection and release checks.

## Repository and local setup

Prerequisites: **Node.js 24 LTS and pnpm 11.25.0**, network access for the lockfile install, and free ports 55432 / 3000. `run.sh` uses installed tools or the existing bundled runtime on this workstation; it does not install tools globally. The native Postgres package is configured for macOS ARM64 and Linux x64; other platforms need a compatible local Postgres installation and appropriate URLs.

After cloning the repository, enter its root (the directory containing `package.json`). In a new local checkout:

```sh
./run.sh install --frozen-lockfile
cp .env.example .env.local
./run.sh db:start
```

Keep that terminal open. This starts native Postgres, bound to loopback, with persistent data in **this directory’s** `.local/postgres`; it is not an in-memory database. In another terminal, from the same directory:

```sh
./run.sh db:setup
RESET_FICTIONAL_DATA=1 ./run.sh db:seed
./run.sh dev
```

Open **http://127.0.0.1:3000/**. On subsequent runs, start only `db:start` and `dev` (or `start` for a saved production build). Ctrl-C stops services and preserves data. Do not reseed to restart.

`.env.local` is loaded by both Next and standalone scripts; explicit environment variables take precedence. Keep it out of version control. Local public passwords in `.env.example` are fictional development defaults and must never be reused on hosting. Setup creates `recovery` and the restricted role if needed and applies versioned SQL migrations (001 and 002); running setup twice retains data.

For a separate copy while this app is running, set `LOCAL_POSTGRES_PORT=55433` and change **all four URL ports** in that copy’s `.env.local` to 55433. Start its app with `./run.sh dev --port 3200` or `./run.sh start --port 3200`. A copied directory alone does not isolate database URLs.

## Checks and production mode

With Postgres running:

```sh
./run.sh test
./run.sh typecheck
./run.sh build
./run.sh start
```

Use either `dev` or `start`, since both normally use port 3000. After source changes, build again before `start`. Against the running app:

```sh
./run.sh test:http
# For a copy on another port:
TEST_BASE_URL=http://127.0.0.1:3200 ./run.sh test:http
```

`test` migrates and **repeatedly resets only `recovery_test`**. Test URLs must be loopback URLs naming that database. It covers real database races using distinct observed connections, rollback after booking writes, deadlines after lock waits, retries, permissions, constraints and actual runtime audit privileges, plus rendered UI and reset/hosting guards. `test:http` checks real routes/session boundaries, malformed input and absence of fault endpoints; it creates demo sessions but does not change bookings. Static rendered UI tests do not replace browser inspection.

Optional lost-response investigation: `./run.sh test:transport` uses `recovery_test`, starts an isolated production app on 3100 and a fault proxy on **localhost:3101**, verifies a discarded HTTP response after commit, then leaves a browser fixture available until Ctrl-C. Build first; do not run concurrently with `test`. `CLARITY_FIXTURES=1` enables additional test-only fixture controls on that proxy. These controls are not application routes. The harness fingerprints the configured local demo using `ADMIN_DATABASE_URL` before switching its own requests to `recovery_test`. It uses the configured port; no other workstation/database is required. The configured demo database must already have been migrated/seeded, as in setup above. See [SAFEGUARDS.md](SAFEGUARDS.md) for operation details.

Before committing or publishing from the repository root:

```sh
./run.sh check:share
git add --dry-run .
```

Source, lockfile, migrations, fictional seed code, tests and setup notes are included. Actual environments, local databases/sessions, dependencies, build output, provider settings and captured test evidence are ignored. Do not force-add them. Historical reports refer to locally retained screenshots/logs that are not part of the repository. The sharing check is a focused file/credential guard, not a comprehensive secret scanner.

## Hosted fictional demo

The shared public fictional instance is [cancellation-recovery.vercel.app](https://cancellation-recovery.vercel.app/). Open the link and use the fictional identity selector. Everyone shares the records and can affect other walkthroughs. No account, workspace isolation or real authentication is provided. Refresh before acting.

Hosting uses the personal Vercel Hobby project and Neon Free project, pooled verified-TLS `recovery_app` credentials for the separate `recovery_demo` database, and the production environment settings documented in [DEPLOYMENT.md](DEPLOYMENT.md). The original local database remains independent. No owner credentials, reset command, migration or fault harness runs in the deployed application. Previews receive no production credentials and remain protected.

`neon.ts` declares Postgres only; Neon Auth and other services are disabled. `lib/hosting.ts` validates the hosted mode, exact canonical HTTPS origin, secure session configuration and restricted pooled connection. `db/runtime_role_grants.sql` gives the hosted role narrower grants than the local developer role, including append/read-only audit access. `scripts/hosted-setup.ts` is an explicit workstation-only initialization of an empty named hosted database; rerunning it does not reset fixtures. Provider commands can pull owner credentials into local env files: follow the separation instructions before using them.

## Destructive commands and limitations

**`RESET_FICTIONAL_DATA=1 ./run.sh db:seed` erases all fictional demo appointments, offers, sessions and audit entries and recreates relative-date fixtures.** Run it only when intentionally starting over. Without the flag it refuses to reset `recovery`. Setup/seed/test tools refuse hosted databases and Vercel. Never add reset to an application build, start command, or HTTP endpoint. Deleting `.local/postgres` also destroys saved databases; it is not a troubleshooting step.

This is a prototype for fictional data, available locally and as a protected hosted demo. Notifications are an inbox only; expiry is enforced at acceptance and materialized during later scheduling operations. Refreshes are serialized; audit UI shows the newest 100 entries. No real authentication, row-level database security, multi-clinic isolation, operational monitoring, backup/recovery validation, load testing or suitability for real patient information is claimed. Database owners can still alter audit storage; the runtime role cannot edit/delete/truncate audit entries, but is trusted to append truthful events. New scheduling writers must follow the shared-lock and source-version contract.
