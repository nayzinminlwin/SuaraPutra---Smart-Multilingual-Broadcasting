# Fix Log: Phase 1 — Delivery Lease and State Transition Safety

**Date:** 2026-11-09
**Severity:** High
**Status:** Resolved

## 1. Defect

Fresh delivery leases could be treated as expired during recovery because
lease creation used SQLite's space-separated `datetime()` format while recovery
compared it with the ISO `strftime()` format. Delivery transitions also allowed
terminal updates from any current state.

## 2. Affected Components

- `src/database/repositories/delivery-job.repo.ts`
- `tests/unit/phase1-database.test.ts`
- `src/database/client.ts`

## 3. Root Cause

The lease and recovery queries did not use the same UTC timestamp representation.
Additionally, `markSent` and `markFailure` updated by ID only, so callers could
move a pending or already-sent job into an invalid state.

## 4. Changes

- Generate lease expiry with ISO UTC `strftime()` output.
- Restrict send success and failure transitions to `sending`.
- Distinguish duplicate job IDs from duplicate idempotency keys.
- Instrument prepared statement execution through the database client's
  microsecond debug wrapper and route repository queries through it.

## 5. Verification

```text
npm test
npm run typecheck
npm run build
```

Results: 8 tests passed across the full suite; typecheck and build passed.
The regression test verifies a fresh lease is not recovered and a sent job is
not re-recovered.

## 6. Remaining Risk

The compiled build does not copy SQL migration assets automatically. The
migrator has a repository-source fallback, but deployment should package
`src/database/migrations/001_initial_schema.sql` or add an asset-copy step
before production startup.
