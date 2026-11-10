# Fix Log: Phase 5.1 — Delivery Refactor

**Date and time:** 2026-11-10 22:33  
**Agent:** Not started  
**Moderator:** Not specified  
**Status:** Proposed / implementation not authorized  
**Fix type:** Refactor / Architectural Correction

## 1. Purpose

This consolidated fix log records corrections made while implementing
Phase 5.1. Each audit finding or defect correction must be appended as a
separate headed entry. Do not create a new Phase 5.1 fix file per partition or
defect.

## 2. Source Findings

- [Phase 5 delivery audit](../../audits/2026-11-10_phase-05-delivery-audit.md)
- [Phase 5.1 plan](../../phase-05-1-plan.md)

## 3. Appended Partition and Fix Entries

### AUD-01 / Partition B — Checkpoint and operation lifecycle

**Status:** Not started  
**Severity:** High  
**Root cause:** Pending implementation.  
**Changes:** Pending implementation.  
**Verification:** Pending independent retest.

### AUD-02 / Partition C — Destination-aware FIFO

**Status:** Not started  
**Severity:** High  
**Root cause:** Pending implementation.  
**Changes:** Pending implementation.  
**Verification:** Pending independent retest.

### AUD-03 / Partition D — Queue and dispatcher validation

**Status:** Not started  
**Severity:** Medium  
**Root cause:** Pending implementation.  
**Changes:** Pending implementation.  
**Verification:** Pending independent retest.

### AUD-04 and AUD-05 / Partition E — Retry policy and logging

**Status:** Not started  
**Severity:** Medium  
**Root cause:** Pending implementation.  
**Changes:** Pending implementation.  
**Verification:** Pending independent retest.

### AUD-06 / Partition F — Recovery scheduling

**Status:** Not started  
**Severity:** Medium  
**Root cause:** Pending implementation and lifecycle wiring.  
**Changes:** Pending implementation.  
**Verification:** Pending independent retest.

### AUD-07 / Partition G — Test coverage

**Status:** Not started  
**Severity:** Low  
**Root cause:** Missing boundary and negative-path assertions.  
**Changes:** Pending implementation.  
**Verification:** Pending independent retest.

## 4. Commit and Follow-up

**Commit:** Not committed  
**Related documentation:** Consolidated Phase 5.1 development and test logs.

---

## Partition A Update — Delivery Attempt Persistence

**Date:** 2026-11-10 22:48
**Status:** Complete

**Correction:** Added durable delivery-attempt history as an additive schema
change instead of creating new delivery jobs for retries.

**Root cause addressed:** Phase 5 had no durable operation-level record
linking retry activity to the stable delivery job.

**Files modified or created:**

- `src/database/migrations/002_delivery_attempts.sql`
- `src/database/repositories/delivery-attempt.repo.ts`
- `src/database/migrator.ts`
- `src/shared/types.ts`
- `tests/unit/phase1-database.test.ts`

**Verification:** Type-check passed; database test suite passed with 8 tests,
including empty migration, upgrade preservation, duplicate attempt rejection,
and closed-attempt transition protection.

**Independent retest:** Pending later Partition G QA review.

---

## Partition F Update — Recovery Scheduling and Lifecycle Ownership

**Date:** 2026-11-10 23:14
**Status:** Complete

**Findings addressed:** AUD-06 — recovery existed only as a manually callable
queue operation and had no lifecycle-owned startup or periodic scheduling.

**Root cause:** Lease recovery was implemented at the repository/queue
boundary but was not owned by a service lifecycle.

**Changes:**

- Added `DeliveryRecoveryScheduler` with startup recovery, periodic scheduling,
  and explicit shutdown.
- Kept recovery policy out of repositories and made timer dependencies
  injectable for deterministic tests.
- Added explicit recovery-failure logging and safe event persistence.

**Verification:** Type-check and 16 focused delivery tests passed, including
startup recovery, interval scheduling, shutdown cleanup, and failure logging.

**Independent retest:** Pending later Partition G QA review.

---

## Partition E Update — Retry Policy, Jitter, and Required Logging

**Date:** 2026-11-10 23:11
**Status:** Complete

**Findings addressed:** AUD-04 and AUD-05 — jitter was limited to 0–1
seconds and retry decisions were not durably logged.

**Root cause:** Retry policy used a one-second random range and the dispatcher
only persisted the resulting job state, not the decision context.

**Changes:**

- Changed jitter calculation to a deterministic injectable 0–3 second range.
- Added safe durable decision events for retryable, permanent, and uncertain
  outcomes.
- Added existing trace retry warnings for retryable decisions.

**Verification:** Type-check and 14 focused delivery tests passed, including
deterministic lower/upper jitter boundaries and safe event contents.

**Independent retest:** Pending later Partition G QA review.

---

## Partition D Update — Queue and Dispatcher Validation

**Date:** 2026-11-10 23:02
**Status:** Complete

**Findings addressed:** AUD-03 — delivery content could be persisted or
forwarded without a queue/dispatcher validation boundary.

**Root cause:** Translation validation existed upstream, but queue insertion
and persisted delivery reconstruction trusted the stored values without a
second deterministic guard.

**Changes:**

- Added complete-language-set and validation-status checks before queue
  insertion.
- Added text and image-caption payload validation before adapter calls.
- Added an explicit permanent failure code for invalid persisted payloads.
- Made attempt/job terminal transitions transactional to prevent successful
  attempt history from diverging from the stable job state.
- Guarded attempt creation failures after a job claim.

**Verification:** Build, lint, and the full 48-test regression suite passed.

**Independent retest:** Pending later Partition G QA review.

---

## Partition C Update — Destination-aware FIFO

**Date:** 2026-11-10 22:56
**Status:** Complete

**Findings addressed:** AUD-02 — global polling order did not prevent an
earlier unresolved job from being overtaken at the same destination.

**Root cause:** Queue polling ordered eligible rows globally but did not
consider unresolved earlier rows belonging to the same target JID.

**Changes:**

- Added a correlated earlier-job barrier scoped to `target_group_jid`.
- Kept terminal and uncertain states outside the active blocking set.
- Allowed independent destinations to progress while another destination is
  blocked.
- Added queue claim and state-transition event logging.

**Verification:** Build passed; 18 focused/database tests passed; the tests
cover same-target blocking, independent-target progress, terminal states, and
uncertain states.

**Independent retest:** Pending later Partition G QA review.

---

## Partition B Update — Checkpoint and Operation Lifecycle

**Date:** 2026-11-10 22:52
**Status:** Complete

**Findings addressed:** AUD-01 — failed dispatches could leave CP08 or CP09
active and retry operations were not durably linked to the stable job.

**Root cause:** The dispatcher only handled queue state after a failed send;
telemetry checkpoints and operation-level history had no failure closure path.

**Changes:**

- Added failure records that close active checkpoints without throwing from the
  cleanup path.
- Added persisted attempt start and terminal transitions to dispatcher flow.
- Added safe event-log entries for attempt lifecycle transitions.
- Prevented failed checkpoints from producing successful journey summaries.

**Verification:** Type-check passed and seven focused Phase 5 delivery tests
passed, including failed-checkpoint cleanup and retry attempt lineage.

**Independent retest:** Pending later Partition G QA review.
