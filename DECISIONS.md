# Decisions and reasons

See [CLARITY.md](CLARITY.md) for the current shared-lock scope, the unrelated work it serializes, and the measurements that would justify changing it. The UI clarity changes preserve the policy below.

## Accepted workflow

- Existing patients moving an already booked follow-up, with the same clinician, type, duration, modality and location.
- Explicit opt-in, staff clearance, requested availability, an earlier visit and no patient appointment overlap.
- Availability is one continuous date/time range per waitlist entry in this first version. Recurring weekday/hour preferences are not modeled.
- Longest-waiting eligible patient first, with waitlist ID as a stable tie-breaker. Staff may select another eligible patient only with a recorded reason. No clinical urgency scoring.
- One pending offer per opening and per source appointment. A pending offer holds the target slot; an offer is not a booking.
- Exact deadline: `min(database send time + 2 hours, slot start - 24 hours)`. A passed cutoff rejects sending. Preview clearly identifies shortened windows. Acceptance validates actual database time after lock waiting, immediately before reserving the booking.
- Patient acceptance completes the move without a second approval. Existing booking remains until the transaction commits; decline, expiry, revocation and failed acceptance do not release it.
- Released original slots return to staff review. Nothing automatically starts another chain.
- Waitlist membership remains active after unsuccessful offers. A declined/expired/revoked opening is not offered again to that same patient automatically. A successful move completes that waitlist entry.
- Real notifications are omitted. Offer records are the simulated inbox; no delivery worker is needed.

## Correctness and tradeoffs

The current state is authoritative. Successful mutations and audit entries commit in one Postgres transaction. Event sourcing would add reconstruction/versioning work without a demonstrated need.

For this small clinic, every scheduling operation uses a single transaction-scoped Postgres advisory lock. It serializes writers across multiple Node processes, simplifying the race cases. State reads use that lock too so deadline maintenance and the returned view are consistent. This limits throughput intentionally; no horizontal scalability claim is made. Row locks and database constraints provide additional protection. Every future scheduling writer must use the same service/locking contract.

Accepted offers retain their result appointment ID. Repeating acceptance returns that recorded result, even after the offer deadline, without creating another appointment or move audit entry. It is a query of the previously committed outcome, not a second acceptance. Other mutations do not promise the same retry semantics; refresh their recorded state after an interrupted response.

An expired pending offer is invalid by time immediately. State reads and successful scheduling actions lazily record its expired status/audit entry. There is no cron job or in-memory timer. A page left open can display stale controls; server validation remains authoritative, and a failed action refreshes the displayed records. Audit expiry time is the time the system observes expiry, while the offer retains the actual deadline.

Database constraints reject duplicate slot bookings and overlapping patient/clinician times. Foreign keys keep copied appointment times equal to their slot. Slot times are not edited through this UI. The app role cannot update/delete audit entries; administrators can still reset the explicitly disposable demo or alter the database. This is not independently tamper-proof logging.

Expected rejected actions do not append an audit entry; their transaction rolls back. Important successful state changes and observed expiry do. Security incident logging and audit export/retention are outside this milestone.

## Research basis versus choices

[AHN's MyChart FAQ](https://mychart.ahn.org/MyChart/Authentication/Login/StandardFile?option=Faq) describes preserving an existing appointment until an earlier offer is accepted. [UHN's guide](https://www.uhn.ca/PatientsFamilies/myUHN/Documents/Wait-List-Patient-Tip-Sheet.pdf) describes opt-in, expiry, unavailable offers and remaining on the waitlist. [HL7's published waitlist example](https://hl7.org/fhir/R4B/appointment.html#12.10.5.5) distinguishes proposed preferred appointments from existing booked appointments. These precedents do not establish psychiatric clinical eligibility, an optimal timer, or a universal selection policy; our matching/clearance, exclusive offering and two-hour/24-hour policy are explicit prototype decisions.

[Next's support policy](https://nextjs.org/support-policy), checked November 4, 2026, lists 16 as Active LTS and 15 as Maintenance LTS with security releases through January 31, 2027. This new app therefore uses stable Next 16, pinned in the lockfile.
