# Development Log: Phase 6.1 Partition C — Composition Root and Lifecycle Safety

**Date and time:** 2026-11-12 13:13
**Agent:** Backend Developer
**Moderator:** Not specified
**Status:** Completed

## 1. Objective

Remediate FINDING-01 and FINDING-07 through FINDING-10 by correcting the
Windows entry-point check, resolving the bot JID dynamically, draining active
dispatch work during shutdown, scheduling retention, and containing Baileys
upsert failures.

## 2. Scope and Acceptance Criteria

**Authorized phase:** Phase 6.1, Partition C

**Acceptance criteria:**

- Direct application startup uses a platform-safe module URL comparison.
- Gate 2 reads the current authenticated bot JID for every message.
- Shutdown stops new dispatches and drains active dispatch work within the
  configured send timeout before disconnecting.
- Retention runs at startup and on a cleared daily timer.
- Baileys media, normalization, and handler failures are logged without
  unhandled rejections or stopping later batch messages.

**Explicitly out of scope:**

- Phase 6.1 Partition D live simulation and later SIM cutover work.

## 3. References

- [Phase 6.1 remediation plan](../../phase_6_1_remediation_95_live_simulation_plan.md)
- [Architecture](../../architecture.md)
- [Operations runbook](../../operations-runbook.md)

## 4. Changes Made

**Files created:**

- `docs/logs/dev/2026-11-12_phase-06-1-partition-c.md`

**Files modified:**

- `src/app.ts`
- `src/delivery/dispatcher.ts`
- `src/ingestion/message-ingestor.ts`
- `src/observability/health.ts`
- `src/whatsapp/baileys-client.ts`
- `tests/integration/e2e-pipeline.test.ts`
- `tests/unit/phase3-ingestion.test.ts`
- `tests/unit/phase5-delivery-queue.test.ts`

**Files deleted:** None

**Implementation summary:**

- Replaced the Windows-sensitive CLI entry comparison with
  `pathToFileURL(path.resolve(...))`.
- Added dynamic `botJidProvider` support while preserving static unit-test
  configuration.
- Added dispatcher active-promise tracking, stopping state, and bounded drain.
- Ordered application shutdown around dispatch drain, recovery/retention timer
  cleanup, adapter disconnect, WAL checkpoint, and database close.
- Added startup and daily retention execution with safe structured logging and
  media-directory initialization.
- Added outer and per-message Baileys upsert error boundaries.
- Added dynamic-JID, retention-start, and dispatch-drain regression assertions.

## 5. Technical Decisions and Deviations

- **Decision:** A timed-out active dispatch is allowed to remain unresolved
  after the configured drain timeout, while shutdown proceeds.
  **Rationale:** Shutdown must be bounded, and the delivery state machine
  already treats uncertain outcomes explicitly.
- **Decision:** Retention creates the configured media directory if absent.
  **Rationale:** A fresh deployment should execute its scheduled retention
  task successfully instead of treating an empty storage directory as an
  operational failure.

## 6. Deliverables

| Deliverable | Status | Description |
|---|---|---|
| Startup entry fix | Complete | Platform-safe direct-run detection |
| Dynamic bot identity | Complete | Current adapter JID checked per message |
| Graceful dispatch drain | Complete | Active send bounded by send timeout |
| Retention lifecycle | Complete | Startup run, daily unref timer, shutdown cleanup |
| Baileys error boundary | Complete | Per-message and upsert-level logging |

## 7. Verification

**Commands run:**

```text
npm run typecheck
npm run build
npm test
npm test -- tests/unit/phase5-delivery-queue.test.ts
git diff --check
```

**Results:**

- **Passed:** Typecheck; production build; full suite with 66 tests across 7
  files; focused dispatcher suite with 24 tests.
- **Failed:** None.
- **Skipped / blocked:** Direct live Baileys and physical SIM verification are
  deferred by the approved plan.

## 8. Risks, Known Issues, and Follow-up

- Live Baileys socket behavior and real Community permissions remain
  unverified until the authorized live phase.
- Partition D must verify the complete file-backed Gemini simulation and
  outbox evidence.

## 9. Commit and Documentation

**Commit:** Not committed
**Related documentation:** This log and the Phase 6.1 remediation plan.
