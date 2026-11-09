# QA Report: Phase 1 — SQLite WAL Database Engine and Typed Repositories

**Date:** 2026-11-09
**Tester:** Developer-run automated verification; independent QA sign-off pending
**Environment:** Windows, Node.js project runtime, `better-sqlite3` 13.0.3,
synthetic temporary SQLite databases
**Build or commit under test:** Working tree before Phase 1 commit
**Status:** Conditionally Passed

## 1. Scope

**Task or implementation tested:** Phase 1 SQLite client, migration, schema,
and five typed repositories.

**Requirements tested:**

- Required WAL and checkpoint pragmas.
- Monotonic source and announcement sequences.
- Duplicate source identity and delivery idempotency handling.
- Chronological FIFO polling.
- Atomic rollback of a multi-job transaction.
- Phase 0 regression compatibility.

**References:**

- [Project plan](../../project-plan.md)
- [Development log](../dev/2026-11-09_phase-01-database.md)
- [Architecture source of truth](../../architecture.md)

**Out of scope:** Live database upgrade, production data, WhatsApp, AI,
dashboard, and deployment verification.

## 2. Test Results

| ID | Test / Scenario | Expected Result | Status | Evidence / Notes |
|---|---|---|---|---|
| T-01 | SQLite startup pragmas | WAL, checkpoint 2000, and foreign keys enabled | PASS | Phase 1 unit test |
| T-02 | Sequence allocation | Ingestion and announcement sequences increase monotonically | PASS | Phase 1 unit test |
| T-03 | Duplicate source identity | Duplicate `(chat_jid, message_id)` raises typed error | PASS | Phase 1 unit test |
| T-04 | FIFO polling | Earlier source timestamp and lower language order poll first | PASS | Phase 1 unit test |
| T-05 | Atomic job insertion | Duplicate idempotency key rolls back all inserted jobs | PASS | Phase 1 unit test |
| T-06 | Lease recovery | Fresh leases remain active and sent jobs remain terminal | PASS | Phase 1 regression test |
| T-07 | Regression | Existing Phase 0 tests remain passing | PASS | Full suite |

## 3. Automated Testing

**Commands run:**

```text
npm test -- --run tests/unit/phase1-database.test.ts
npm test
npm run typecheck
npm run build
git diff --check
```

**Results:**

- **Passed:** 5 Phase 1 tests; 8 total tests; typecheck; build; diff check.
- **Failed:** None in final execution.
- **Skipped / blocked:** Independent QA execution and live/upgrade-database
  verification remain pending.
- **Coverage:** Not collected; no coverage script is configured.

## 4. Issues Found

No unresolved defects. The review found and corrected lease timestamp
comparison, state-transition guarding, duplicate classification, and missing
prepared-statement timing instrumentation. See the [fix log](../fixes/2026-11-09_phase-01-fix-delivery-lease-state.md).

## 5. Final Assessment

**Status:** CONDITIONALLY PASSED

**Summary:** The authorized Phase 1 behavior is verified by deterministic
automated tests and all repository checks pass.

**Required action:** Independent Tester-agent review of the schema migration
and representative upgrade path.

**Remaining risks and limitations:**

- No live or production database was used.
- SQL asset loading after packaging should be checked during deployment.

---

# Retest History

No independent retest has been recorded.
