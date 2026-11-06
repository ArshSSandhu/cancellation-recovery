# Staff and patient clarity review — November 5, 2026

Historical inspection record. Local screenshots and transport captures referenced below are intentionally excluded from Git; clone users can reproduce checks from the source. Use README.md for current commands and SHARING.md for publishing preparation.

## Focused changes

The original staff dashboard was inspected in Chrome before editing at desktop and 390px phone width. Its unmatched opening displayed a large reply-window panel before the zero-eligible message, and cancelled/replaced appointments interrupted the booked schedule.

- **Current bookings** now contains only booked appointments. A native, closed-by-default **Appointment history · cancelled and replaced** disclosure retains the other records. Nothing was deleted or reclassified in storage; audit history remains available.
- A zero-match opening leads with **No eligible waiting patients** and has no send action or hypothetical deadline preview. Timing rules are in a secondary disclosure. Staff can expand actual exclusion reasons.
- Sending an offer still uses the same criteria and longest-waiting order. `matchingRules` in `lib/scheduling.ts` is now the shared set of SQL predicates for both eligibility decisions and explanations. A false predicate produces an explanation; the UI does not guess clinical reasons. Completed requests, replaced/cancelled source bookings and actual previous offer outcomes are described from stored state. Exclusions are returned only to staff.
- Actionable openings show **Up to two hours to reply** or **Shortened reply window**, with a clearly labeled reply-deadline preview including date, seconds and EST/EDT. The final deadline remains set in the server transaction. The preview explicitly tells staff to refresh to update it; implementation expressions such as “send time + 2 hours” are absent from the workflow.
- Patient pages separate confirmed appointments from inbox offers. Pending offers say a reply is needed. Accepted offers say no reply is needed and retain a safe result-check action. Withdrawn and expired offers say no reply is available. Old reply deadlines move into offer details after the offer is terminal.
- Unknown outcomes continue to mark the last-loaded booking **unconfirmed**, offer refresh/safe acceptance retry, and avoid any “still confirmed” claim. Other historical offers are withheld until recovery so they cannot all appear to require retry. A lost decline directs the patient to refresh, rather than suggesting acceptance.
- As a locally estimated reply deadline passes, reply buttons are removed and the patient is told to refresh for authoritative state. This does not declare that the database has expired the offer or that a concurrent move failed; the server still makes the booking decision.

## Accessibility changes and actual inspection

- Persistent `role=status` / polite and `role=alert` / assertive regions are present before an update, with atomic announcements. Success, rejection and uncertain-outcome text updates those regions.
- Keyboard focus moves to the result message after a mutation or refresh, including when the triggering button disappears. The automatically observed deadline transition also produces a status message and focus target. This was inspected through the live DOM and visible focus; no claim is made that screen-reader speech output was listened to.
- A skip link targets the main content. Native buttons, radios, fieldsets and disclosure summaries retain keyboard behavior. Required override reasons are visibly labeled. Focus outlines are three pixels with a dark contrasting color.
- Every status has text; color is supplementary. Phone layout stacks comparisons and actions, keeps deadlines/zones readable, and uses 16px editable inputs/selects.

Manual browser inspections used the real running app with Postgres fixtures, not mocked page payloads. Initial desktop width was 1470px; subsequent patient/state captures were at **1440×900** and **390×844**. Phone width is a viewport emulation, not a physical-device test.

| State / workflow | What was inspected |
|---|---|
| Staff zero eligible | Prominent empty state, secondary timing disclosure, actual excluded patients, no send button, separate current bookings and collapsed history. |
| History and exclusions | Tab navigation, visible focus and Enter-to-expand. Cancelled/replaced records appear only after history is opened. |
| Normal and shortened offer windows | Plain language, exact zoned preview, responsive layout, longest-waiting default, arrow-key patient choice, required reason appearing, send disabled until a reason is entered. |
| Pending patient offer | Current appointment clearly confirmed, both dates visible, exact reply deadline, accept/keep actions. |
| Accepted | An actual keyboard acceptance produced the replacement, released-original label, no-reply-needed state and polite result message. Inspected at both widths. |
| Withdrawn | Original still confirmed, explicit withdrawn/no-reply state, no acceptance control. Inspected at both widths. |
| Expired | Original still confirmed, explicit expired/no-reply state, no acceptance control. Inspected at both widths. |
| Uncertain | Actual success responses were discarded after verified commit, including browser automatic retries. Last-loaded information was unconfirmed; decline disabled; recovery controls remained. Inspected at both widths. After restoring delivery, keyboard retry at phone width recovered the recorded booking and focused the polite result. |
| Open page reaches deadline | Pending state was observed before the deadline; after it passed, controls disappeared and a polite status/focus update requested refresh. Refresh then showed the database's expired status. |

No horizontal overflow was observed in the inspected desktop/phone states. Controls and focus remained visible while using Tab, Shift-Tab, arrows and Enter. Screenshots are under `evidence/clarity-*.jpg`; they are inspection evidence, not a separate packaged submission.

## Automated coverage and preservation

`./run.sh test` now runs **31 checks: 20 real-database tests and 11 rendered UI contract tests**. Existing booking races, atomic rollback, retries, ownership and constraints remain covered. Added database checks protect accurate exclusion reasons and staff-only visibility. Rendered UI checks protect default/history separation, zero-match priority, exact normal/shortened deadline wording, state-appropriate patient actions, unknown recovery semantics, elapsed-deadline controls and persistent live regions.

Rendered UI tests inspect generated HTML; they do not execute browser focus, timers or assistive technology. Those interactions were inspected manually in Chrome as listed above. This is not an automated browser regression or comprehensive accessibility audit.

All resets and injected states used `recovery_test` through the test-only fixture harness. The normal `recovery` database was not seeded/reset. A read-only SHA-256 fingerprint covers identities, sessions, clinicians, slots, appointments, waitlist, offers, audit and migrations; the before/after fingerprint matched. Scheduling policy, schema constraints and the audit trail were preserved.

Commands used: `./run.sh test`, `./run.sh typecheck`, `./run.sh build`, and the existing HTTP authorization check against the isolated server with `TEST_BASE_URL=http://127.0.0.1:3100`.

To repeat the manual fixtures after building:

```sh
CLARITY_FIXTURES=1 ./run.sh test:transport
```

Use `http://localhost:3101` so its cookie host is separate from the demo at `127.0.0.1`. The test-only `POST /__fixture/prepare` accepts `zero`, `eligible`, `shortened`, `pending`, `accepted`, `revoked`, `expired`, `uncertain` or `deadline`; it resets only `recovery_test`. Do not run the database suite concurrently with this harness. Sign in again after preparing a fixture. The uncertain fixture withholds acceptance responses until `POST /__fault/release`. Ctrl-C stops the test server/proxy and checks demo preservation. These endpoints do not exist in the application.

## Shared Postgres lock: scope, cost and rationale

`transaction` in `lib/db.ts` acquires **the same transaction-scoped advisory lock, key 710428, for every caller in the same database**. It is not scoped to a patient, clinician, opening or offer, and it is not a JavaScript mutex. `COMMIT` or `ROLLBACK` releases it. Different databases, such as the demo and isolated test database, have separate advisory-lock namespaces.

The current callers are `execute` and `getState`:

- Cancellation, offer issuance, acceptance, decline and withdrawal serialize across all patients/clinicians, even for unrelated slots.
- Every full state refresh also acquires the lock, because it observes expiry, can append expiry audit records, and returns a consistent scheduling view. It reads appointments, offers, and—for staff—openings, matching explanations and audit history while holding the lock. A slow dashboard refresh can therefore delay an unrelated patient accepting an offer with another clinician.
- Switching an already-loaded UI tab does not fetch state. Sign-in/session lookups and static page/assets do not request this advisory lock. Ordinary SQL outside this helper is not automatically covered; database constraints and the scheduling-writer contract still matter.

That coarse scope is acceptable for this small, single-clinic prototype: a small dataset, brief transactions, few interactive scheduling actions, and no external integrations, workers or outbound notification delivery inside transactions. It gives a simple, tested order for mutations and expiry. The deliberate tradeoff is throughput and responsiveness. The helper has a five-second lock timeout and ten-second statement timeout; these are limits, not a capacity guarantee. No contention/load benchmark has been performed.

Changing it would be justified by observed lock waits or timeout errors during normal work, slow state/eligibility queries on larger lists, substantially more concurrent schedulers/patients, or multiple independent clinics sharing a database. First measure lock wait and transaction duration. A narrower locking design would then need an explicit account of which patient/slots/offers must be coordinated, deterministic lock ordering, and the same rollback/race/retry checks. No lock redesign was made because this review found no correctness defect requiring one.

## Remaining limitations

- Chrome desktop and emulated phone widths were inspected; physical phones, Safari/Firefox, high zoom, forced-colors mode, and actual screen-reader speech were not tested.
- No user study, full WCAG audit, automated browser regression suite or load test was added.
- State refresh remains explicit. The local deadline display removes stale reply controls, but other changes require refresh; server checks remain authoritative.
- Exclusions explain current stored scheduling checks, not clinical judgment. Waitlist availability remains a single interval.
- The shared-lock throughput tradeoff and future-writer version contract remain documented; no scheduling policy or architecture expansion was introduced.
- Deployment and submission packaging remain out of scope.
