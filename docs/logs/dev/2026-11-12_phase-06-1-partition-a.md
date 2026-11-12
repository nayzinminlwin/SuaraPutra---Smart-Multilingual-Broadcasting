# Development Log: Phase 6.1 Partition A — Durable AI Failure and Ingestion State

**Date and time:** 2026-11-12 12:50  
**Agent:** Backend Developer  
**Moderator:** Not specified  
**Status:** Completed

## 1. Objective

Remediate FINDING-03, FINDING-04, and FINDING-05 by persisting the processing
announcement and source associations before AI execution, and by durably
recording ignored and held AI outcomes without creating delivery jobs.

## 2. Scope and Acceptance Criteria

**Authorized phase:** Phase 6.1, Partition A  

**Acceptance criteria:**

- AI provider failures leave a `held_validation_failed` announcement and do not
  mask the provider error with `Announcement not found`.
- Validation failures persist the held announcement and returned failed
  translations.
- Ignored announcements persist their score, raw response, and primary source
  association.
- Held and ignored outcomes create zero delivery jobs.

**Explicitly out of scope:**

- Phase 6.1 Partitions B-E, live simulation, dashboard, and Baileys cutover.

## 3. References

- [Phase 6.1 remediation plan](../../phase_6_1_remediation_95_live_simulation_plan.md)
- [Architecture](../../architecture.md)
- [Queue and reliability skill](../../../.github/skills/queue-and-reliability/SKILL.md)

## 4. Changes Made

**Files created:**

- `docs/logs/dev/2026-11-12_phase-06-1-partition-a.md`

**Files modified:**

- `src/ai/ai-processor.ts`
- `src/database/repositories/announcement.repo.ts`
- `src/delivery/queue.ts`
- `src/ingestion/message-ingestor.ts`
- `tests/unit/phase3-ingestion.test.ts`

**Files deleted:** None

**Implementation summary:**

- Created `processing` announcements and primary/context source links before
  invoking AI for text and image-caption messages.
- Moved durable outcome ownership to ingestion, so provider errors and
  validation holds update an existing row rather than attempting to update a
  missing row inside `AiProcessor`.
- Persisted non-null returned translations with `validation_status = 'failed'`
  and validation errors for held results.
- Updated ignored announcements in place and preserved the primary source link.
- Allowed queue persistence to finalize the pre-created announcement instead of
  inserting a duplicate row.

## 5. Technical Decisions and Deviations

- **Decision:** Keep AI processing responsible for structured error logging,
  while ingestion owns durable announcement state.
  **Rationale:** The ingestion boundary owns the source association and can
  guarantee that the row exists before handling the AI result.
- **Deviation:** `src/delivery/queue.ts` was updated in addition to the plan's
  listed files.
  **Rationale:** The pre-created processing row must be finalized transactionally
  without duplicate announcement insertion.

## 6. Deliverables

| Deliverable | Status | Description |
|---|---|---|
| Durable processing row | Complete | Inserted before AI and linked to primary/context sources |
| Durable AI failure handling | Complete | Provider and validation holds persist with zero delivery jobs |
| Ignored source association | Complete | Primary source is retained with ignored outcome |
| Focused regression tests | Complete | Added provider, validation, ignored, and no-job assertions |

## 7. Verification

**Commands run:**

```text
npm run typecheck
npm test -- tests/unit/phase3-ingestion.test.ts tests/unit/phase4-ai-and-validation.test.ts
npm test -- tests/integration/e2e-pipeline.test.ts
git diff --check
```

**Results:**

- **Passed:** Typecheck; focused Partition A suite with 17 tests; existing E2E
  pipeline test; diff whitespace check.
- **Failed:** None.
- **Skipped / blocked:** None.

## 8. Risks, Known Issues, and Follow-up

- Provider failures without a model response retain no `raw_ai_response_json`,
  as expected; the structured event log retains the safe error reason.
- Tester should independently verify event-log details and restart/retention
  behavior after the remaining Phase 6.1 partitions are implemented.

## 9. Commit and Documentation

**Commit:** Not committed  
**Related documentation:** This log and the Phase 6.1 remediation plan.
