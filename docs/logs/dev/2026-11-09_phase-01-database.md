# Development Log: Phase 1 — SQLite WAL Database Engine and Typed Repositories

**Date and time:** 2026-11-09 23:33 +08:00
**Agent:** Developer agent
**Moderator:** Project owner
**Status:** Completed

## 1. Objective

Implement the approved SQLite persistence foundation with WAL pragmas,
idempotent migrations, the seven operational tables, and typed repositories
for source messages, announcements, translations, delivery jobs, and event
logs.

## 2. Scope and Acceptance Criteria

**Authorized phase:** Phase 1 — SQLite WAL Database Engine, 7-Table FIFO Schema,
Migrations and Typed Repositories

- Enable the six required SQLite startup pragmas.
- Apply the exact initial schema transactionally and record its migration.
- Enforce source-message and delivery idempotency constraints.
- Preserve monotonic ingestion and announcement sequences.
- Provide chronological delivery polling and atomic multi-job insertion.
- Verify rollback, duplicate handling, and Phase 0 regression behavior.

**Explicitly out of scope:** WhatsApp adapters, ingestion orchestration, AI
processing, translation validation, dispatch workers, dashboard, and live
operational data.

## 3. References

- [Project plan](../../project-plan.md)
- [Architecture source of truth](../../architecture.md)
- [Database management skill](../../../.github/skills/database-management/SKILL.md)
- [TypeScript and Node.js skill](../../../.github/skills/typescript-node/SKILL.md)

## 4. Changes Made

**Files created:**

- `src/shared/types.ts`
- `src/shared/errors.ts`
- `src/shared/crypto.ts`
- `src/database/client.ts`
- `src/database/migrator.ts`
- `src/database/migrations/001_initial_schema.sql`
- `src/database/repositories/source-message.repo.ts`
- `src/database/repositories/announcement.repo.ts`
- `src/database/repositories/translation.repo.ts`
- `src/database/repositories/delivery-job.repo.ts`
- `src/database/repositories/event-log.repo.ts`
- `tests/unit/phase1-database.test.ts`
- `docs/logs/dev/2026-11-09_phase-01-database.md`
- `docs/logs/test/2026-11-09_phase-01-database-test.md`

**Files modified:** None.

**Files deleted:** None.

**Implementation summary:**

- Added strict domain types and persistence-specific error classes.
- Added SHA-256 and UUID helpers.
- Added a `better-sqlite3` client applying WAL, checkpoint, foreign-key,
  timeout, synchronous, and in-memory temporary-store settings.
- Added idempotent migration tracking and the seven-table initial schema.
- Added typed repositories with parameterized SQL, explicit state transitions,
  FIFO polling, lease claiming, and expired-lease quarantine.
- Added prepared-statement microsecond debug instrumentation across repository
  queries.

## 5. Technical Decisions and Deviations

- **Decision:** Delivery repository inserts always create `pending` jobs.
  **Rationale:** The architecture schema requires an explicit state and the
  repository owns the initial lifecycle state.
- **Decision:** Migration loading falls back from compiled output to the
  repository source path.
  **Rationale:** TypeScript compilation does not copy SQL assets; this keeps
  startup behavior explicit in both source and built execution.
- **Deviation:** No group-configuration repository was added.
  **Rationale:** Phase 1 explicitly authorizes five repositories; trusted group
  configuration remains configuration-owned until a later integration surface
  needs persistence.
- **Decision:** Lease timestamps use one ISO UTC representation for creation and
  recovery.
  **Rationale:** Lexicographic timestamp comparisons must use a consistent
  format to avoid falsely quarantining active jobs.

## 6. Deliverables

| Deliverable | Status | Description |
|---|---|---|
| Shared types, errors, crypto | Complete | Strict domain contracts and helpers |
| WAL client and migration runner | Complete | Required pragmas and tracked migration |
| Seven-table schema | Complete | Initial migration with constraints and indexes |
| Five repositories | Complete | Parameterized typed persistence operations |
| Phase 1 unit tests | Complete | Five tests covering pragmas, sequences, FIFO, duplicates, rollback, and lease safety |

## 7. Verification

**Commands run:**

```text
npm test -- --run tests/unit/phase1-database.test.ts
npm test
npm run typecheck
npm run build
git diff --check
```

**Results:**

- **Passed:** Phase 1 tests (5 tests), full suite (8 tests), strict typecheck,
  build, and diff check.
- **Failed:** None in the final run. An initial queue test exposed missing
  explicit `pending` insertion state and was fixed before final verification.
- **Skipped / blocked:** Live GCP or production database verification was not
  run; tests use synthetic temporary SQLite databases.

## 8. Risks, Known Issues, and Follow-up

- Repository methods currently expose core persistence operations; application
  orchestration and full announcement queueing will be wired in later phases.
- Independent Tester-agent sign-off should verify the migration against a
  representative upgrade database before release.
- **Tester focus:** Verify foreign-key rollback, duplicate idempotency behavior,
  lease recovery, and FIFO ordering using isolated temporary databases.

## 9. Commit and Documentation

**Commit:** To be created after final diff and staged-scope review.
**Related documentation:** This log and the Phase 1 verification report.
