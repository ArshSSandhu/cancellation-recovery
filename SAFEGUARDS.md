# Booking safeguards review — November 5, 2026

Historical inspection record. Local screenshots and transport captures referenced below are intentionally excluded from Git; clone users can reproduce checks from the source. Use README.md for current commands and SHARING.md for publishing preparation.

## Actual acceptance path

1. `app/api/action/route.ts` resolves an opaque session cookie on the server. A request body's actor/role is not trusted. `execute` checks the stored role; patients may accept only their own offers.
2. `lib/db.ts` checks out one database connection, begins a transaction, and acquires a clinic-wide transaction-scoped advisory lock. Other scheduling actions wait on that same Postgres lock, including actions in another Node process. This is intentionally broad serialization for a small clinic.
3. `execute` reads and locks the offer. Ownership is checked **before** returning an already accepted result. If it is already accepted, its stored `result_appointment_id` is returned with `replayed: true`. No appointment insertion or successful-move audit write occurs on this path. Recovery still works after the original offer deadline.
4. For a new acceptance, the offer must still be pending. The original appointment and target slot are read and locked. The original must still be booked at the version captured when the offer was sent. Matching, overlap, availability and destination occupancy are checked again.
5. Actual database wall-clock time is checked after waiting, immediately before booking writes. Both offer expiry and the 24-hour cutoff must still permit acceptance. The browser's clock does not decide this.
6. The transaction inserts the replacement, marks the original `replaced` and links its replacement, marks the offer accepted with the result ID, completes that waitlist entry, and appends the move audit entry.
7. Only `COMMIT` makes that entire change visible together. The original time becomes available to other transactions at commit, not when the offer is sent and not when the browser is clicked. Any failure before successful commit rolls the whole change back. The service returns success only after commit.

The deadline defines when the server may authorize the move under its locks. The response can arrive after that deadline, or never arrive. A missing response does **not** tell us whether commit happened; refresh/retry must read the recorded outcome.

## What the database constraints establish

`db/001_initial.sql` provides independent defenses in addition to service checks:

- `one_booking_per_slot`: at most one booked appointment occupies a slot. Cancelled/replaced history may retain the slot reference.
- Clinician slot exclusion: one clinician cannot have overlapping slot intervals. Together with one booking per slot, this prevents clinician double-booking in this fixed-slot model.
- Patient booking exclusion: a patient cannot have overlapping booked appointments. Intervals include their start and exclude their end, so adjacent visits are allowed.
- Composite appointment/slot foreign key: an appointment's copied start/end must exactly match its referenced slot. The foreign key for a replacement prevents a dangling replacement reference.
- `exclusive_slot_offer` and `exclusive_source_offer`: only one pending offer per opening and per source appointment. Expired rows are lazily transitioned out of pending before a new offer is sent; time is still checked at acceptance.
- Status checks require accepted offers to have a result appointment and replaced appointments to have a replacement link.
- Audit permissions and trigger reject normal application updates/deletes. Successful move and audit insertion share the transaction. The audit is not independently tamper-proof against administrators.

These constraints do not encode clinical eligibility, ownership or the whole rescheduling workflow. Those checks are in the server service. Every scheduling writer must use the same transaction/lock contract and advance appointment versions when changing a booking. Version advancement is **not** a database trigger; arbitrary direct SQL that bypasses that contract is not covered by the stale-version guarantee. The existing cancellation/replacement paths advance versions. No real integration or general rescheduling editor is present.

## Six requested situations and evidence

| Situation | Existing coverage and focused improvement | Established result |
|---|---|---|
| Two staff send offers | Replaced uncoordinated promise launch with two distinct staff identities on separately observed waiting database connections. | Exactly one pending offer, one offer-sent audit entry; the other request is rejected. No patient appointment changes. |
| Same patient accepts twice | Strengthened the existing repeated/concurrent acceptance checks with two observed overlapping connections and full state/audit assertions. | Both return the same replacement ID: one new acceptance and one replay; one move audit entry. |
| Revoke versus accept | Replaced the weak “one remaining booking” assertion with coordinated races in both queue orders. | Revoke-first leaves original booked, offer revoked, no move audit. Accept-first leaves replacement booked, original replaced, offer accepted, one move audit. Losing request is rejected. Links and waitlist status agree. |
| Lock wait crosses deadline | Reused the deadline test but now observes the request actually waiting before expiry, then holds the blocker beyond the deadline. | Acceptance rejects; the entire original appointment row is unchanged; no move audit or replacement. |
| Commit but response lost | Strengthened database retry coverage; added a real HTTP/session/route test and actual Chrome inspection through a test-only response-dropping proxy. | A verified committed move survives a lost response. Refresh and replay return its recorded result; no duplicate move/audit. |
| Original booking changes | Retained clearance/version coverage; added a real slot/time change with a version advance after offer issuance. | Stale acceptance rejects and preserves the now-current booking exactly, rather than restoring an older time. |

All concurrent database checks now use `overlap` in `tests/booking.test.ts`. It holds the real clinic advisory lock, starts each request, and observes `pg_stat_activity` plus `pg_blocking_pids` before releasing the blocker. The final run observed distinct request backend PIDs 13371 and 13376. This demonstrates connection-level overlap, not merely promises submitted near the same time. Cleanup waits for every request even when an assertion fails.

The earlier “competing staff offers” test concerns **offer issuance**, not two valid patients accepting the same slot. Exclusive offers should prevent that situation. The separate stale/current-recipient test first revokes Maya's offer, then issues Jordan's; when both acceptance requests overlap, only Jordan has a valid offer. It now also observes real database overlap and checks one successful-move audit entry.

The existing injected-audit-failure test was reused unchanged: a temporary trigger in `recovery_test` raises after booking writes, verifying that replacement insertion, original release, offer acceptance, waitlist completion and move audit all roll back. Fault injection is not installed in the demo database or application routes.

## Lost response: database, HTTP and browser are separate evidence

- **Database level:** `execute` is allowed to commit and its return value is deliberately discarded. `getState` discovers the accepted booking. Retrying even after the deadline returns that same ID with one audit entry. This alone says nothing about browser networking.
- **HTTP level:** `tests/transport-harness.ts` starts a separate Next server on 3100 pointing at `recovery_test`. A proxy on 3101 consumes the real acceptance route's complete success response, independently verifies committed appointments/offer/audit in Postgres, then destroys the client socket without sending response headers/body. The client receives a failed request. GET state and a repeated authenticated POST recover the same booking.
- **Actual Chrome:** a separate fixture uses `http://localhost:3101`, keeping its cookie host separate from the demo at `127.0.0.1`. Chrome transparently retried the dropped connection. Each retry returned the same booking server-side. To inspect the unknown state, the proxy discarded those responses too until delivery was explicitly restored.
- The page then said it could not confirm completion, marked its last-loaded original appointment **unconfirmed**, removed the “Still booked” claim, and disabled decline while offering **Retry acceptance**. Screenshot: `evidence/lost-response-unconfirmed.jpg`.
- After restoring delivery through the **test-only proxy**, the explicit retry recovered the accepted booking. Record refresh and full page reload retained it. Final database inspection found exactly one move audit entry. Screenshot: `evidence/lost-response-recovered.jpg`; machine-readable commit/drop evidence: `evidence/safeguards-transport.json`.

The proxy does not manufacture a successful acceptance or insert a booking; it only interferes with transport after the application has committed. It is not imported by the application and adds no production fault endpoint or flag. The fault proxy and isolated server were stopped after inspection.

## Corrections and limits

The booking transaction and schema did not need new product behavior. The gaps were weak race assertions, lack of a transport-loss exercise, and potentially misleading stale UI labels. Changes were limited to coordinated tests, a test-only transport harness, unknown-outcome wording/state, and rejection wording that describes what **this request** did instead of claiming no other action changed the booking.

Final checks passed: **18 database tests**, TypeScript, production build, HTTP authorization smoke checks, deliberate HTTP response loss, actual Chrome recovery and read-only demo fingerprint comparison. All demo rows—including sessions, appointments, offers, audit and migration records—matched the before/after SHA-256 fingerprint retained in the local preservation record. Only `recovery_test` was reset or fault-injected.

Not established by these checks: crashes during commit, loss of a Postgres commit acknowledgement, machine power loss, backup/restore, other browsers, multi-process stress/load or arbitrary out-of-band SQL writers. The two-tab race is exercised as two service requests with distinct database connections; two simultaneous physical browser clicks were not separately exercised. The actual browser fault was response loss after a verified commit, not unplugging the network before an unknown commit point. Refresh-only recovery after the drop was exercised at HTTP level; Chrome used retry first, then refresh/reload.

## Repeat

With Postgres running:

```sh
./run.sh test
./run.sh typecheck
./run.sh build
./run.sh test:transport
```

Do not run the database suite concurrently with the transport harness: both deliberately reset `recovery_test`. The harness runs its automatic HTTP check, creates a fresh patient fixture, then prints the browser URL. Sign in as Maya and accept; after inspecting the unknown state, restore delivery from another terminal:

```sh
curl -X POST http://127.0.0.1:3101/__fault/release
```

Retry in the browser, refresh, then Ctrl-C the harness to stop its test app/proxy and check demo preservation. It records transport evidence under `.local/transport-evidence.json`. A fresh browser inspection remains manual; starting the harness alone does not establish it.
