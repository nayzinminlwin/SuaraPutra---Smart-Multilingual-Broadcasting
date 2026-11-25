# Development Log: Phase R1 — Critical Foundation Fixes

**Date and time:** 2026-11-26 00:20 +08:00
**Agent:** AI assistant using Copilot SDK in VS Code
**Moderator:** Not specified
**Status:** Completed

## 1. Objective

Address R1's startup-order, tracer-retention, migration-discovery, and delivery-reconciliation findings without touching operational data or WhatsApp authentication state.

## 2. Scope and Acceptance Criteria

**Authorized phase:** R1 — Critical Foundation Fixes
**Acceptance criteria:**

- Application construction performs no database I/O; startup initializes the database and services, attaches ingestion, connects the adapter, then starts dispatch.
- Tracers are evicted after five minutes, swept every 60 seconds, and removed when announcement delivery reaches a terminal state.
- SQL migrations are discovered from the migration directory in sorted order and logged.
- Announcement reconciliation waits only while a delivery job is non-terminal and does not assume four jobs.
- Existing tests and TypeScript type checking pass.

**Explicitly out of scope:**

- R2 dependency injection and configuration cleanup.
- R4 database backup, retention, and schema improvements.
- Changes to `private/whatsapp-auth`, operational SQLite files, or production data.

## 3. References

- [Remediation plan](../../audits/remediation-plan.md), Phase R1
- [Development log template](../../templates/dev_log_template.md)
- [Database management skill](../../../.github/skills/database-management/SKILL.md)
- [Queue and reliability skill](../../../.github/skills/queue-and-reliability/SKILL.md)

## 4. Changes Made

**Files created:**

- `tests/unit/remediation-r1.test.ts`
- `docs/logs/dev/2026-11-26_phase-R1-critical-foundation-fixes.md`

**Files modified:**

- `src/app.ts`
- `src/database/migrator.ts`
- `src/delivery/queue.ts`
- `tests/unit/phase5-delivery-queue.test.ts`
- `tests/integration/e2e-pipeline.test.ts`

**Files deleted:** None

**Implementation summary:**

- Deferred logger/database/repository/service initialization to `start()`. The constructor now stores configuration and options; service accessors are available after startup.
- Attached the ingestion handler before connecting and moved dispatch-loop startup until after `adapter.connect()` resolves.
- Added timestamped tracer entries, five-minute eviction, a 60-second cleanup timer, and terminal-announcement cleanup through a queue callback.
- Failed startup now disconnects the adapter, closes the database, and rejects unsafe retries on the same application instance.
- Replaced the hardcoded four-job reconciliation test with a check for `pending`, `sending`, and `retry_wait` jobs.
- Replaced the fixed migration list with sorted `.sql` file discovery, with the existing source-directory fallback retained for compiled runs. The application logger records each discovered migration.
- Updated lifecycle tests for lazy initialization and terminal tracer cleanup.

## 5. Technical Decisions and Deviations

- **Decision:** Preserve the existing public service access pattern through getters, but require `start()` before accessing database-backed services.
  **Rationale:** These services cannot be constructed without opening the database, which must not happen in the application constructor.
- **Decision:** A failed startup disconnects the adapter and closes the database; that application instance cannot be started again.
  **Rationale:** The adapter interface has no handler-unsubscribe operation, so retrying startup on the same instance could attach duplicate handlers.
- **Decision:** Keep the existing compiled-runtime migration-directory fallback and make the migration directory injectable for isolated tests.
  **Rationale:** Migrations are not copied by the current TypeScript build; the fallback preserves the existing runtime behavior while enabling deterministic discovery tests.
- **Deviation:** None from the R1 implementation tasks.

## 6. Deliverables

| Deliverable | Status | Description |
|---|---|---|
| Constructor has no database I/O | Complete | Verified by constructing the application and asserting no database file was created. |
| Ordered startup and dispatch-after-connect | Complete | Test gates adapter connection while ingestion creates pending jobs and verifies no sends occur before connection resolves. |
| Tracer TTL, periodic cleanup, and terminal cleanup | Complete | Tests verify five-minute eviction and removal after terminal reconciliation. |
| Migration auto-discovery | Complete | Tests verify both existing migrations, sorted discovery, additional SQL migration execution, and idempotent rerun. |
| Dynamic job reconciliation | Complete | A one-job test verifies terminal status without a four-job assumption. |
| Startup failure cleanup | Complete | Regression test verifies adapter disconnect and prevents handler-duplicating restart. |
| Regression checks | Complete | Full test suite and type check passed. |

## 7. Verification

**Commands run:**

```text
npm test -- --reporter=dot
npm run typecheck
git diff --check
```

**Results:**

- **Passed:** `npm test -- --reporter=dot` — 9 test files, 90 tests passed.
- **Passed:** `npm test -- tests/unit/remediation-r1.test.ts --reporter=dot` — 1 file, 5 tests passed after startup-failure cleanup was added.
- **Passed:** `npm run typecheck` — zero TypeScript errors.
- **Passed:** `git diff --check` — no whitespace errors.
- **Failed:** An initial targeted test attempted to mark a pending delivery job sent without claiming it first. The test setup was corrected to follow the existing state transition; the targeted tests and full suite then passed.
- **Skipped / blocked:** No live WhatsApp connection or operational database was used.

## 8. Risks, Known Issues, and Follow-up

- Database-backed application properties are now available after `start()` rather than immediately after construction; the known test and script call sites were updated or confirmed to access them after startup.
- An application instance whose startup fails must be discarded; `start()` reports this explicitly on any retry.
- The database backup mechanism remains a future R4 decision and was not needed for R1.
- **Tester focus:** Verify dispatch cannot run before adapter connection, migration discovery ordering and idempotency, and tracer cleanup on both TTL and terminal-state paths.

## 9. Commit and Documentation

**Commit:** To be recorded in the phase completion report.
**Related documentation:** [Remediation plan](../../audits/remediation-plan.md)
