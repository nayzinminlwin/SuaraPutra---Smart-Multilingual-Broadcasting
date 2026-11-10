# SuaraPutra Phase 5.1 Refactor Plan

**Document:** `docs/phase-05-1-plan.md`  
**Status:** Implemented — final verification appended in Partition G
**Parent scope:** Phase 5 delivery queue and dispatcher refactor  
**Relationship to backbone plan:** This is a focused corrective plan. It does
not replace or modify `docs/project-plan.md`.

**Documentation convention:** Phase 5.1 uses one consolidated log file in each
of `docs/logs/dev/`, `docs/logs/fixes/`, and `docs/logs/test/`. Each partition
appends its updates to the existing Phase 5.1 file; no separate log file is
created per partition. This limited convention overrides only generic
instructions that require one development, fix, or test file per partition or
per defect. All other documentation, QA, privacy, and Git rules remain in
force.

The consolidated files are:

- `docs/logs/dev/2026-11-10_phase-05-1-delivery-refactor.md`
- `docs/logs/fixes/2026-11-10_phase-05-1-delivery-refactor.md`
- `docs/logs/test/2026-11-10_phase-05-1-delivery-refactor.md`

The implementation agent must append a clearly headed partition entry to the
development log. Defect corrections append to the fix log, and independent
verification or retesting appends to the test log. Existing entries must not
be overwritten.

## 1. Purpose

Phase 5.1 will harden the Phase 5 delivery implementation against the audit
findings recorded in
[the Phase 5 delivery audit](./audits/2026-11-10_phase-05-delivery-audit.md).
The refactor will preserve the approved transport boundary, static routing,
durable queue, independent language outcomes, uncertain-send safety, and
single-read media behavior while making operation lifecycles, retry history,
validation, ordering, recovery, and observability explicit.

This phase is a corrective refactor. It must not expand the project into the
Phase 6 live Baileys cutover, dashboard, or unrelated architectural work.

## 2. Design Decisions

### 2.1 Stable logical job with traceable delivery attempts

There remains one stable `delivery_job` for each
`announcement + language + trusted target group`. Its idempotency key and
chronological identity do not change across retries.

Each send operation is represented by a separate delivery-attempt record linked
to the stable job:

```text
delivery_jobs
  stable logical work item and current queue state

delivery_attempts
  one closed operation for each send attempt
  linked to delivery_jobs.id
```

Retries create a new attempt record, not a new delivery job. This preserves
idempotency and queue identity while providing an auditable parent-child
relationship.

### 2.2 Operation lifecycle

Every attempt must have an explicit lifecycle:

```text
started -> sent
started -> failed
started -> uncertain
```

An attempt must be closed before its delivery job is moved to the next queue
state. A failed attempt is not reused for a retry. A retry creates a new
attempt number linked to the same stable delivery job.

### 2.3 Destination-aware FIFO

The queue has strict FIFO behavior for healthy, sendable work, but delivery
destinations remain independent:

- `pending`, `sending`, and eligible `retry_wait` work block later work for
  the same destination when an earlier job is unresolved.
- `sent`, `failed_permanent`, and `cancelled` are terminal and do not block
  queue progress.
- `uncertain` is terminal for automatic forwarding. It is removed from active
  forwarding, remains available for reconciliation, and does not block later
  work for that destination or other destinations.
- A failed `ta` job must not resend or block successful `ms`, `en`, or `zh-CN`
  jobs.

This is intentionally weaker than a global chronological barrier after an
uncertain outcome. The trade-off is accepted to preserve independent
per-language progress while preventing automatic duplicate sends.

### 2.4 Validation before forwarding

Translations must pass deterministic validation before queue insertion. The
dispatcher must also validate persisted delivery data immediately before
calling the WhatsApp adapter. Invalid persisted work is recorded as a
permanent delivery failure and is never sent.

## 3. Scope Partitions

The partitions are ordered by dependency. A later partition must not hide an
incomplete earlier partition.

### Partition A — Delivery attempt persistence and migration

**Objective:** Add durable history for each delivery operation without
changing the stable delivery-job identity.

**Planned work:**

- Add one ordered SQLite migration for delivery-attempt persistence.
- Store the attempt ID, stable delivery job ID, attempt number, operation
  status, safe failure category, safe error code/message, timestamps, and
  outgoing message ID when available.
- Add a uniqueness rule preventing duplicate attempt numbers for one delivery
  job.
- Add indexes for delivery-job history and operational status/time queries.
- Add repository methods for starting, closing, and listing attempts.
- Keep raw provider payloads, credentials, message contents, and media bytes
  out of attempt records.

**Acceptance criteria:**

- Empty-database migration succeeds.
- Existing Phase 5 databases upgrade without losing delivery jobs.
- A retry creates a new attempt row linked to the same delivery job.
- Attempt history remains after the stable job becomes `sent`, `failed_permanent`,
  or `uncertain`.
- Migration rollback behavior is transaction-safe on failure.

### Partition B — Checkpoint and operation lifecycle

**Objective:** Ensure failed operations close cleanly and cannot poison later
retry tracing.

**Planned work:**

- Add explicit checkpoint failure/closure semantics to the telemetry boundary.
- Close CP08 and CP09 on reconstruction and send failures with duration and
  safe failure metadata.
- Ensure a failed operation cannot be finalized as a successful journey.
- Create a fresh attempt operation and trace association for each retry.
- Preserve a parent reference from each attempt to the stable delivery job and,
  where useful, the preceding attempt.

**Acceptance criteria:**

- No failed dispatch leaves an active checkpoint.
- A retry cannot fail with `Checkpoint already active`.
- A successful four-language journey finalizes only after all four successful
  destination operations.
- Failed or uncertain work remains observable but is not reported as a
  successful journey.
- Checkpoint cleanup is safe when reconstruction fails before CP09 starts.

### Partition C — Destination-aware FIFO selection

**Objective:** Implement the agreed queue progression rules without allowing
healthy later work to overtake unresolved earlier work for the same target.

**Planned work:**

- Refine queue polling to apply an earlier-job barrier per trusted target JID.
- Exclude terminal states from active queue blocking:
  `sent`, `failed_permanent`, `cancelled`, and `uncertain`.
- Keep `pending`, `sending`, and retry-eligible `retry_wait` as active
  unresolved states.
- Ensure a retryable `ta` job does not block `ms`, `en`, or `zh-CN`.
- Preserve atomic claim behavior and lease ownership.
- Record queue-selection and state-transition events with safe identifiers.

**Acceptance criteria:**

- Healthy language jobs are claimed in source timestamp, announcement
  sequence, and language order.
- A later job for the same target cannot overtake an earlier pending or
  retryable job.
- A later job for another target can continue when the earlier target is
  retrying or uncertain.
- Terminal jobs are skipped without being claimed again.
- Concurrent claim attempts cannot produce duplicate active claims.

### Partition D — Queue and dispatcher validation

**Objective:** Prevent malformed or incomplete persisted content from reaching
the transport adapter.

**Planned work:**

- Validate the translation set before queue transaction start:
  exactly one `ms`, `en`, `zh-CN`, and `ta`.
- Reject duplicate or unknown language codes.
- Require non-empty content for `TEXT` and `IMAGE_CAPTION`.
- Permit a missing caption only for `IMAGE_ONLY`.
- Require passed deterministic validation status before creating delivery
  jobs.
- Validate the reconstructed text/image payload immediately before send.
- Convert invalid persisted delivery data into `failed_permanent` with a
  structured event.

**Acceptance criteria:**

- Invalid translation sets fail before any announcement, translation, or job
  record is committed.
- Text and image-caption jobs cannot be queued with null or empty content.
- Image-only jobs retain valid media path and MIME metadata.
- Malformed persisted jobs never invoke `sendMessage`.
- Validation failures are distinguishable from transport failures.

### Partition E — Retry policy, jitter, and required logging

**Objective:** Match the approved backoff contract and make every retry
decision traceable.

**Planned work:**

- Change jitter from 0–1 seconds to 0–3 seconds.
- Keep the random source injectable for deterministic testing.
- Record each retry decision against the stable delivery job and new attempt.
- Emit the existing retry telemetry/debug convention with attempt number,
  maximum attempts, safe error category, decision, and backoff.
- Log permanent and uncertain decisions as state transitions, not retries.
- Prevent sensitive message contents, media, credentials, or unnecessary JIDs
  from logs.

**Acceptance criteria:**

- Attempt 1 backoff is bounded to 5–8 seconds.
- Attempt 2 is bounded to 10–13 seconds.
- Attempt 3 is bounded to 20–23 seconds.
- Attempt 4 is bounded to 40–43 seconds.
- Attempt 5 becomes `failed_permanent`.
- Ambiguous timeout becomes `uncertain` with no automatic retry.
- Every retry decision emits a safe, testable log record.

### Partition F — Recovery scheduling and lifecycle ownership

**Objective:** Make crash recovery run predictably without putting unmanaged
timers inside repositories.

**Planned work:**

- Keep `recoverOrphanedJobs()` deterministic and directly testable.
- Wire one recovery call before dispatch begins.
- Schedule recovery at the approved 60-second interval in the lifecycle or
  composition boundary.
- Clear the interval during shutdown.
- Log recovery successes, affected counts, and recovery failures explicitly.
- Never reset `sent` jobs or automatically retry `uncertain` jobs.

**Acceptance criteria:**

- Expired `sending` jobs become `uncertain` on startup recovery.
- Recovery runs again on the configured interval.
- Shutdown clears the interval and does not leave a background timer.
- A recovery exception is visible as an operational error.
- Recovery does not delete attempt history or delivery evidence.

### Partition G — Regression, integration, and documentation

**Objective:** Independently prove the refactor and preserve the project’s
documentation contract.

**Planned work:**

- Add focused tests for every finding and design decision.
- Add migration upgrade tests using a representative Phase 5 database.
- Add delivery-attempt history and retry lineage assertions.
- Add destination-aware FIFO tests for pending, retrying, terminal, and
  uncertain jobs.
- Add image-caption validation and reconstruction tests.
- Add telemetry and safe logging assertions.
- Update the Phase 5.1 development, QA, and fix documentation.
- Update the audit document with retest results.

**Acceptance criteria:**

- Phase 1–5 regression suite remains green.
- Phase 5.1 focused tests pass.
- Production build and type-check pass.
- `git diff --check` passes.
- No secrets, real WhatsApp data, private media, or auth state are added.
- The final commit contains only Phase 5.1 implementation, tests, and
  directly related documentation.

**Consolidated logging rule:** Partition G updates the three existing
Phase 5.1 logs. It must not create partition-specific log files.

## 4. Proposed Data and State Contracts

### 4.1 Stable delivery job

The existing delivery job remains the source of current queue state:

- stable job ID;
- announcement and language identity;
- trusted target JID;
- idempotency key;
- current delivery status;
- attempt count;
- lease state;
- outgoing message ID when sent;
- latest safe failure classification.

### 4.2 Delivery attempt

The exact final columns must be owned by the migration and repository
contract. The planned logical fields are:

- attempt ID;
- delivery job ID;
- attempt number;
- operation status: `started`, `sent`, `failed`, or `uncertain`;
- started and completed timestamps;
- safe error code and category;
- safe error message;
- outgoing message ID when confirmed;
- optional preceding-attempt ID for direct retry lineage.

The preceding-attempt link is optional because the stable delivery-job link
already provides complete ancestry. It should only be included if it improves
reconciliation queries without creating circular state or unnecessary
complexity.

### 4.3 State transition evidence

Every meaningful transition should produce a safe event record, including:

- queue persisted;
- attempt started;
- attempt sent;
- attempt failed and retry scheduled;
- attempt became uncertain;
- job became permanently failed;
- job cancelled;
- stale lease recovered;
- invalid persisted payload held as permanent failure.

Logs must identify the operation and safe correlation identifiers without
exposing message content or secrets.

## 5. Implementation Sequence and Dependencies

```text
Partition A
    -> Partition B
    -> Partition C
    -> Partition D
    -> Partition E
    -> Partition F
    -> Partition G
```

Partition A must precede retry lineage changes. Partition B must precede
dispatcher retry behavior. Partition C must precede final queue-order tests.
Partition D can be implemented alongside C but must be complete before
dispatcher integration. Partition E depends on the attempt lifecycle. F is
owned by the application lifecycle boundary and may be wired when the Phase 6
composition root is implemented, but its contract and tests must be prepared
here. G is the completion gate.

## 6. Explicit Non-Goals

Phase 5.1 will not:

- implement the live Baileys adapter;
- connect a real WhatsApp account or perform SIM pairing;
- create the Phase 6 composition root or health service;
- build the administrative dashboard;
- add automatic reconciliation of uncertain sends;
- introduce Redis, a broker, multiple workers, or account rotation;
- change model prompts, translation policy, or destination configuration;
- alter the backbone phase numbering or acceptance criteria in
  `docs/project-plan.md`.

## 7. Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Migration changes delivery history semantics | Use an additive migration and test upgrade from the Phase 5 schema |
| Per-destination FIFO is misread as global FIFO | Encode the policy in queue tests and document it in the implementation contract |
| Attempt records expose sensitive data | Store only safe classifications, identifiers, and bounded error details |
| Retry history creates duplicate sends | Keep one stable idempotency key per logical delivery job |
| Recovery interval leaks during shutdown | Own the timer in the lifecycle boundary and test cleanup |
| Invalid old rows reach the adapter | Revalidate persisted jobs immediately before send |
| A failed operation is reported as successful | Require closed checkpoints and successful terminal states before journey finalization |

## 8. Phase 5.1 Completion Gate

Phase 5.1 may be considered complete only when:

1. The selected destination-aware FIFO policy is implemented and tested.
2. Retry attempts are durably traceable to one stable delivery job.
3. Failed operations close cleanly and retries use new operations.
4. Translation and reconstructed payload validation block malformed sends.
5. Jitter, retry limits, and logging match the architecture contract.
6. Startup and periodic recovery scheduling are wired at the owning lifecycle
   boundary or explicitly recorded as a Phase 6 integration dependency.
7. All focused and regression tests pass.
8. Development, QA, and fix documentation is complete.
9. The final diff is reviewed and only explicit Phase 5.1 files are committed.

The completion evidence must be appended to the consolidated development, fix,
and test logs named in Section 1. No additional Phase 5.1 log files are
required unless a maintainer explicitly approves a separate operational
incident record.

## 9. Approval

This document is a proposal for review. No implementation work should begin
until the plan and the destination-aware FIFO policy are approved.
