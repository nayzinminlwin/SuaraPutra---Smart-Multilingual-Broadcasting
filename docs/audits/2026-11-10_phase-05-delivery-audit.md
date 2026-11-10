# Phase 5 Delivery Audit

**Audit date:** 2026-11-10  
**Audited commit:** `9473d4b` — `feat(phase-05/delivery): add persistent FIFO dispatcher`  
**Scope:** Phase 5 delivery queue, routing, retry policy, dispatcher, telemetry,
and recovery implementation  
**Status:** Remediated by Phase 5.1; final retest appended below

## 1. Audit References

- [Phase 5 project-plan requirements](../project-plan.md)
- [Architecture source of truth](../architecture.md)
- [Phase 5 development log](../logs/dev/2026-11-10_phase-05-delivery-queue.md)
- [Phase 5 QA log](../logs/test/2026-11-10_phase-05-delivery-queue-test.md)
- [Delivery dispatcher](../../src/delivery/dispatcher.ts)
- [Delivery queue](../../src/delivery/queue.ts)
- [Retry policy](../../src/delivery/retry-policy.ts)
- [Delivery-job repository](../../src/database/repositories/delivery-job.repo.ts)
- [Phase 5 tests](../../tests/unit/phase5-delivery-queue.test.ts)

## 2. Verification Performed

The implementation was rechecked against the Phase 5 acceptance criteria and
the architecture delivery state machine.

Commands executed:

```text
npm run build
npm test
npm test -- tests/unit/phase5-delivery-queue.test.ts
```

Results:

- Build passed.
- Full suite passed: 6 test files, 38 tests.
- Focused Phase 5 suite passed: 5 tests.
- No live WhatsApp or Phase 6 composition checks were performed.

The passing tests establish the current implemented behavior, but do not cover
all architecture invariants identified below.

## 3. Findings Summary

| ID | Severity | Component | Finding | Current impact |
|---|---|---|---|---|
| AUD-01 | High | Dispatcher / telemetry | Failed dispatches can leave CP08 or CP09 active | A reused tracer can fail with `Checkpoint already active`; delivery may remain leased until recovery |
| AUD-02 | High | FIFO queue polling | Later announcements can dispatch while an earlier job is in `retry_wait` | Chronological batch ordering can be violated after a transient failure |
| AUD-03 | Medium | Queue persistence | Queue insertion does not require exactly one complete translation per configured language | Invalid or null text jobs can be persisted |
| AUD-04 | Medium | Retry policy | Jitter is limited to 0–1 seconds instead of the specified 0–3 seconds | Backoff does not match the architecture contract |
| AUD-05 | Medium | Retry observability | Retry decisions do not emit the required debug retry log | Operators cannot see retry reason, attempt, and backoff in the expected telemetry |
| AUD-06 | Medium | Recovery lifecycle | Recovery is callable but not scheduled at startup or every 60 seconds | Orphaned jobs may remain uncertain until a future composition invokes recovery |
| AUD-07 | Low | Tests | Several required boundary scenarios are not directly tested | Regressions in caption dispatch, tracer failures, strict retry ordering, and telemetry may go undetected |

## 4. Detailed Findings

### AUD-01 — Active Checkpoints Survive Failed Dispatch

**Location:** [dispatcher.ts](../../src/delivery/dispatcher.ts), dispatch
error path

`CP08_MSG_RECONSTRUCT` is started before reconstruction and `CP09_DISPATCH_*`
is started before sending. If reconstruction or sending throws, the catch block
records the delivery failure but does not close the active checkpoint.

This conflicts with the tracer invariant that a journey can only be finalized
when no checkpoints remain active. It also makes retry instrumentation unsafe
when the same tracer is reused: a later attempt can throw
`Checkpoint already active`.

**Proposed remediation:**

- Add explicit failure closure for active checkpoints, preserving duration and
  failure metadata.
- Ensure cleanup occurs in a `finally` path or through a dedicated tracer
  method that is safe when a checkpoint is absent.
- Do not finalize a journey for an incomplete or failed four-language delivery.
- Add a regression test for reconstruction failure and send failure with an
  active tracer.

### AUD-02 — Retry Delay Can Break Chronological FIFO

**Location:** [delivery-job.repo.ts](../../src/database/repositories/delivery-job.repo.ts),
`pollNext()`

The query selects the earliest currently eligible job. If an earlier
announcement enters `retry_wait`, it is temporarily excluded by
`next_attempt_at`. A later announcement can then become eligible and dispatch
before the earlier announcement's retry.

The architecture requires chronological batch dispatch, while also requiring
independent delivery state per destination. The implementation currently does
not define how these requirements interact during delayed or uncertain work.

**Proposed remediation:**

- Add an earlier-announcement barrier to job selection.
- Decide whether an earlier `uncertain` job blocks all later announcements or
  only its affected language destination.
- Recommended Phase 5 policy: an earlier unresolved job blocks later
  announcements globally until reconciliation. This prioritizes strict
  chronology and at-most-once safety.
- Document the selected policy in the architecture decision record if the
  project chooses independent destination progress instead.
- Add tests for an earlier `retry_wait` job and an earlier `uncertain` job.

### AUD-03 — Incomplete Translation Sets Can Be Queued

**Location:** [queue.ts](../../src/delivery/queue.ts),
`persistAnnouncement()`

The router creates four jobs from the supplied translation map, but the queue
does not validate that the input contains exactly `ms`, `en`, `zh-CN`, and `ta`.
A missing translation results in a job with null text. Duplicate or unexpected
language entries are also not rejected before the transaction.

This weakens the architecture rule that deterministic validation occurs before
delivery jobs are created.

**Proposed remediation:**

- Validate the language set before opening the transaction.
- Require exactly one translation for every configured language.
- Require non-empty content for `TEXT` and `IMAGE_CAPTION`.
- Permit a null/empty caption only for `IMAGE_ONLY`.
- Reject duplicate language codes and unexpected languages explicitly.
- Add rollback and invalid-input tests.

### AUD-04 — Retry Jitter Does Not Match the Contract

**Location:** [retry-policy.ts](../../src/delivery/retry-policy.ts)

The policy currently adds a random 0–999 ms jitter. The architecture specifies
random jitter from 0 to 3 seconds:

```text
min(300, 5 * 2^(attempt - 1)) + random(0, 3)
```

**Proposed remediation:**

- Change the jitter calculation to a bounded 0–3000 ms value.
- Inject the random source, as the current design already permits, so the
  bounds can be tested deterministically.
- Verify attempt 1 through attempt 4 and the attempt-5 permanent-failure
  transition.

### AUD-05 — Retry Debug Logging Is Missing

**Location:** [retry-policy.ts](../../src/delivery/retry-policy.ts) and
[dispatcher.ts](../../src/delivery/dispatcher.ts)

The retry policy returns a decision but does not emit the Phase 5 retry debug
banner or invoke the existing `PipelineTracer.logRetryOrWarning()` helper.
The Phase 5 plan explicitly requires active debug logging for retry reason and
backoff.

**Proposed remediation:**

- Keep `RetryPolicy` deterministic and side-effect-light.
- Log the returned retry decision in the dispatcher, where the job and tracer
  context are available.
- Include attempt, max attempts, safe error category, and backoff duration.
- Do not log message contents, media, credentials, or sensitive JIDs.
- Add an assertion for the retry banner and metadata.

### AUD-06 — Recovery Scheduling Is Not Yet Wired

**Location:** [queue.ts](../../src/delivery/queue.ts),
`recoverOrphanedJobs()`

The recovery method correctly transitions expired `sending` jobs to
`uncertain` and writes a CRITICAL event, but Phase 5 does not schedule it at
startup or every 60 seconds. The project plan assigns the scheduling behavior
to the delivery lifecycle, while the application composition root is reserved
for Phase 6.

**Proposed remediation:**

- Keep `DeliveryQueue.recoverOrphanedJobs()` deterministic and timer-free.
- In the Phase 6 composition root, call it once before dispatch begins.
- Schedule it every 60 seconds using `setInterval`.
- Clear the interval during graceful shutdown.
- Add an integration test proving startup recovery and timer cleanup.

This is a Phase 6 wiring dependency, but it should remain an explicit
completion item rather than being treated as fully delivered by the current
Phase 5 module.

### AUD-07 — Missing Boundary and Negative-Path Tests

**Location:** [phase5-delivery-queue.test.ts](../../tests/unit/phase5-delivery-queue.test.ts)

The existing five tests cover the principal happy path, media read reuse,
transient retry, ambiguous failure, lease recovery, and routing. Additional
coverage is needed for:

- `IMAGE_CAPTION` reconstruction and caption preservation;
- CP08/CP09 cleanup after reconstruction and send failures;
- retry ordering when an earlier job is delayed;
- uncertain-job ordering policy;
- exact translation-set validation;
- retry jitter bounds and attempt limits;
- retry debug logging;
- kill-switch behavior with queued work;
- journey summary behavior with successful four-language completion.

## 5. Proposed Remediation Plan

### Stage 1 — Correctness and safety

1. Resolve the uncertain-job ordering policy.
2. Make checkpoint failure cleanup explicit and retry-safe.
3. Add a strict earlier-announcement FIFO barrier.
4. Validate complete translation sets before queue insertion.

### Stage 2 — Contract fidelity and observability

5. Correct retry jitter to 0–3 seconds.
6. Add safe retry debug logging using existing telemetry conventions.
7. Preserve the timer-free queue API and record Phase 6 recovery scheduling as
   a composition-root responsibility.

### Stage 3 — Independent verification

8. Add the missing negative-path and recovery tests.
9. Run the Phase 1–5 regression suite and production build.
10. Update the Phase 5 fix log and QA report with retest evidence.
11. Create a focused fix commit before beginning Phase 6.

## 6. Decision Required Before Implementation

The key unresolved behavioral decision is whether an earlier `uncertain`
delivery job blocks later announcements globally.

### Recommended: global chronological barrier

- Preserves the strongest interpretation of chronological FIFO.
- Avoids later announcements overtaking an unresolved send.
- Makes uncertain delivery visible and operationally safe.
- May pause all delivery until an operator reconciles the job.

### Alternative: independent destination progress

- Allows unaffected language destinations to continue.
- Improves throughput during one destination's uncertainty.
- Weakens global chronological ordering and requires a more detailed
  per-destination ordering contract.

No implementation change should be made until this policy is selected.

## 7. Audit Conclusion

Phase 5 is test-passing but should be considered **conditionally complete**.
The implementation has a sound foundation—transactional claims, static
routing, target-bound idempotency, uncertain-send quarantine, and single-read
media reuse—but the high-severity checkpoint and retry-ordering issues should
be resolved before Phase 6 live composition or delivery validation.

This document records findings and proposed remedies only. It does not modify
source code or change the approved architecture.

---

## Phase 5.1 Remediation Retest

**Retest date:** 2026-11-11
**Commits under test:** `155931d` through `fcd35da`
**Scope:** Phase 5.1 Partitions A–F, final Partition G regression and
documentation gate

| Finding | Retest result | Evidence |
|---|---|---|
| AUD-01 | Remediated | Failed checkpoints close safely; failed journeys cannot finalize |
| AUD-02 | Remediated under approved per-destination policy | Same-target active barriers block; terminal/uncertain states do not |
| AUD-03 | Remediated | Complete validated language set required before queue insertion |
| AUD-04 | Remediated | Deterministic 0–3 second jitter bounds tested |
| AUD-05 | Remediated | Durable safe retry decision events and retry telemetry added |
| AUD-06 | Remediated at lifecycle boundary | Startup/periodic scheduler and shutdown cleanup tested |
| AUD-07 | Remediated | Negative-path, image-caption, kill-switch, recovery, and regression tests added |

**Architecture decision:** Phase 5.1 uses destination-aware FIFO rather than
the stronger global barrier recommended in the original audit. Active
`pending`, `sending`, and eligible `retry_wait` work blocks later work only
for the same trusted target JID. `uncertain` is held for reconciliation and
does not block other destinations. This is recorded in the approved
[Phase 5.1 plan](../phase-05-1-plan.md) and is an intentional weakening of
global chronological ordering to preserve independent language progress.

**Verification evidence:**

- `npm run build` passed.
- `npm run lint` passed.
- `npm test` passed: 6 test files, 57 tests.
- `git diff --check` passed.
- No live WhatsApp, credentials, private media, or production data used.

**Residual limitation:** The scheduler is composition-boundary ready and
deterministically tested, but the Phase 6 application composition root does
not yet exist, so live process startup wiring remains a Phase 6 integration
task. This is explicitly permitted by the Phase 5.1 completion gate.

**Final assessment:** Phase 5.1 remediation satisfies the approved
completion gate for the current modular delivery boundaries. Proceed to Phase
6 only after its composition root owns scheduler startup and graceful
shutdown.

---

## D–G Follow-up Audit

**Audit date:** 2026-11-11
**Scope:** Partitions D–G after the initial Phase 5.1 closure

The broader review found four connected anomalies:

1. Queue validation failures could leave CP07 active because the catch path
   inspected completed records instead of closing the active checkpoint.
2. A telemetry journey-finalization exception occurred after the send and
   durable `sent` transition, but the dispatcher catch path could classify it
   as a delivery failure and attempt an invalid second terminal transition.
3. The plan's IMAGE_ONLY empty-caption exception was not represented by the
   queue validation predicate.
4. Recovery emitted no success event when zero orphaned leases were found,
   weakening periodic operational evidence.

**Remediation:**

- CP07 now closes with a failed checkpoint record on queue validation or
  persistence errors.
- Journey finalization runs after the durable send transition and is reported
  as telemetry failure without changing the sent job or attempt.
- IMAGE_ONLY queue payloads may carry empty captions while text and
  captioned-image payloads remain non-empty and length-bounded.
- Every recovery check emits a safe event with the recovered count; zero-work
  checks use DEBUG and recovered leases remain CRITICAL.

**Follow-up verification:**

- Focused delivery tests passed: 21 tests.
- Full regression passed: 6 test files, 57 tests.
- Build and lint passed.
- `git diff --check` passed.

**Follow-up assessment:** No unresolved D–G implementation anomaly remains
within the current delivery boundary. The only intentional integration
dependency is Phase 6 composition-root ownership of scheduler startup and
graceful shutdown.
