# Fix Log: Phase 3 — Ingestion Handler Type Contract

**Date:** 2026-11-10
**Defect:** Phase 3 typecheck failure
**Severity:** Low

## Symptom

`npm run typecheck` rejected the adapter registration because
`MessageIngestor.enqueue` returns an `IngestionResult`, while the transport
handler contract requires `Promise<void>`. It also reported that the
image-only passthrough path could pass a nullable media path.

## Root Cause

The ingestion API intentionally returns an observable result for tests and
application callers, but the adapter callback boundary only needs completion.
The media persistence result was not narrowed before constructing the
passthrough announcement.

## Change

- Wrapped `enqueue` in an adapter callback that resolves `void`.
- Added an explicit persisted-path guard before image-only queue creation.
- Removed unused imports exposed during the correction.

## Verification

`npm run typecheck`, `npm run build`, the focused Phase 3 suite, and the full
test suite all pass after the correction.

## Remaining Risk

None introduced. Live transport and downstream AI/delivery integration remain
outside Phase 3.

## Audit Correction — 2026-11-10

The post-phase architecture audit found two additional contract mismatches:

- Content hashes included chat/message identity instead of the approved
  normalized text or media/caption formulas.
- Context selection fetched the current message and filtered it in memory,
  reducing the configured context limit by one.

The deduplicator now follows the architecture formulas, and the repository
excludes the current message in SQL before applying the context limit.
The focused suite now passes 5 tests and the full suite passes 24 tests.
