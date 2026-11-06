# Verification record — November 4, 2026 (Indianapolis)

Historical inspection record. Local screenshots and transport captures referenced below are intentionally excluded from Git; clone users can reproduce checks from the source. Use README.md for current commands and SHARING.md for publishing preparation.

This records the original milestone. See [SAFEGUARDS.md](SAFEGUARDS.md) for the November 5 follow-up, including coordinated races and deliberately lost HTTP responses inspected in Chrome.

## Environment actually used

- Bundled Node v24.22.1 and pnpm 11.25.0; no global runtime installation.
- Next.js 16.4.5 compiled successfully using `next build` and served using `next start`.
- Native PostgreSQL **17.11**, aarch64 macOS, confirmed with `SELECT version()`.
- Runtime database identity confirmed as **recovery_app**, not the administrator.
- Persistent demo database `recovery`; isolated resettable test database `recovery_test`.

## Passed

- **16 real-database tests** via `./run.sh test` (which creates/migrates the test database automatically).
- `./run.sh typecheck` and optimized production build.
- HTTP checks via `./run.sh test:http`: unauthenticated request, forged session, cross-origin request, unknown identity, HttpOnly/SameSite cookie flags, patient-only records, forged staff claims and unknown offer.
- Direct database constraints: duplicate slot booking, clinician overlap, patient overlap, duplicate pending offer, denied audit update/delete.
- Forced audit insert failure after booking writes: replacement insert, old booking release, offer acceptance and waitlist completion all rolled back; no move audit entry remained.
- Six concurrent acceptance requests returned one replacement; repeated acceptance appended no duplicate move audit entry.
- Competing staff sends produced one exclusive offer. A revoked recipient and the subsequent recipient accepting concurrently produced only the valid winner, preserving the losing patient's original booking.
- Expiry before acceptance, expiry while waiting on a real database lock, reassignment after expiry, stale eligibility/version and revocation racing acceptance.
- Exact deadline equality for full and shortened windows; passed cutoff rejected sending.

## Actual Chrome inspection

Interacted with the rendered app through the browser, not just HTTP requests or source inspection:

1. Signed in as staff, cancelled Casey's earliest seeded appointment with a reason.
2. Inspected Maya and Jordan's eligible ordering and matching reasons, plus the deadline preview.
3. Sent Maya an exclusive offer and inspected the held opening and final deadline.
4. Switched to Maya and inspected current versus offered appointments, time zone, deadline and consent wording.
5. Accepted and saw the confirmed earlier booking. Refreshed the patient page and confirmed persistence.
6. Switched to staff and inspected the booked replacement, released original slot, and audit entry containing source/replacement links. Also confirmed staff records after a page reload.
7. Offered the released slot to Jordan. Left his pending offer page open while revoking it through a second staff browser tab. Restored Jordan's session and attempted acceptance from the stale page: server rejected it, page refreshed to revoked, and the original November 20 booking remained booked.
8. Inspected the unsuccessful state visually and confirmed it persisted after refresh.
9. Clicked Maya's **Check acceptance result** and saw the recorded successful result, without another move.
10. Reloaded the final build and confirmed the identity selector agrees with the signed-in session.

Saved actual browser screenshots: `evidence/confirmed-move.jpg` and `evidence/rejected-acceptance.jpg`. Dates in these screenshots reflect the original seed day; later reseeding uses relative future dates.

## Problems found and corrected

- The first shortened-window fixture used two independent clock reads, making its duration slightly longer than 30 minutes. Corrected the fixture to use one statement time.
- The deadline test then found a real precision loss when Postgres timestamps passed through JavaScript before insertion. Deadline calculation and slot-time copying now stay inside SQL; exact deadline tests pass.
- Initial browser/HTTP sign-in failed because Next's internal request URL normalized the host differently. Origin validation now compares the actual loopback-only Host header; same-origin sign-in succeeds and foreign origins remain rejected.
- Identity selector initially reset to staff after patient page reload. It now follows the server-returned current identity.
- Package-manager settings differed between execution contexts during cleanup. The runner now explicitly selects the project's `.local/pnpm-store`; the frozen-lockfile install, database tests, typecheck and build were rerun successfully using that runner. The temporary package store outside the project was removed.

## Limits and work not verified

- Desktop Chrome inspection only. Mobile viewport behavior, other browsers, screen-reader use and a comprehensive keyboard/accessibility audit were not inspected.
- Decline, expiry and shortened-window correctness were database-tested; their full rendered browser journeys were not separately exercised. Staff revocation and rejected acceptance were browser-exercised.
- Repeated and concurrent requests were tested, including the browser retry control. A physical network disconnection or dropped HTTP response during commit was not induced.
- No automated browser regression suite, load test, multiple Node-instance test, crash/power-loss recovery exercise or backup/restore drill was run.
- Not deployed. No real identity provider, healthcare integration or message delivery. Broader failure/security review remains for the next discussion.
- Matching uses a single availability interval, with seeded opt-in/clearance rather than management screens for those fields.
- Read/action refresh is explicit; open tabs do not receive live updates. The server rejects stale actions.
- Audit history shows the latest 100 entries; expiry is recorded when observed, and rejected actions are not audited. The application role cannot edit audit entries, but database administrators retain control.

The demo retains the browser walkthrough state: Maya moved successfully; Jordan's later offer was revoked and his original appointment remains booked. Reset explicitly with `RESET_FICTIONAL_DATA=1 ./run.sh db:seed` to repeat from the beginning. Only fictional data was used.
