# Fix Log: Phase 6 — E2E Wiring Defects

**Date and time:** 2026-11-11 21:52
**Agent:** Developer agent
**Moderator:** Project owner
**Status:** Completed
**Fix type:** Bug Fix

## 1. Trigger

- **QA report:** `docs/logs/test/2026-11-11_phase-06-e2e-and-baileys-test.md`
- **Defect ID:** BUG-06-01
- **Severity:** High
- **Error summary:** Composition-root E2E processing did not reach AI/queue
  persistence reliably and could duplicate context source links.

## 2. Affected Scope

**Phase:** Phase 6
**Components:** AI provider request contract, ingestion orchestration, context
assembly, E2E fixture harness
**Contract impact:** Mock model callbacks now receive the structured request
including source content.

## 3. Reproduction

1. Run `npm test -- tests/integration/e2e-pipeline.test.ts`.
2. Observe callback request destructuring failure or duplicate
   `announcement_sources` rows.
3. Observe incomplete outbound job creation.

## 4. Root Cause

The mock provider invoked callback responses without passing the request, while
the provider request lacked source content. The new composition path also
passed repeated quoted/window source IDs into a uniqueness-constrained link
table. AI and dispatch tracers were separate, so the complete journey lacked
later checkpoints.

## 5. Changes Made

- Passed the model request and source content into mock callbacks.
- Deduplicated context source IDs before persistence.
- Shared the pipeline tracer through context assembly, AI, queue, and
  dispatcher.
- Added the live adapter and composition integration test.

**Files modified:** `src/ai/model-provider.ts`, `src/ai/ai-processor.ts`,
`src/ingestion/context-assembler.ts`, `src/ingestion/message-ingestor.ts`,
`src/app.ts`

## 6. Verification Before Retest

```text
npm test -- tests/integration/e2e-pipeline.test.ts
npm test
npm run typecheck
npm run build
```

- **Passed:** Targeted E2E 1/1; full suite 60/60; typecheck and build.
- **Failed:** None after correction.
- **Skipped / blocked:** Live SIM smoke test.

## 7. Ready for Independent Retest

- [x] Yes — synthetic regression is passing.

**Remaining risk:** Live provider and WhatsApp behavior remain unverified.

## 8. Commit and Follow-up

**Commit:** Not committed.
**Related documentation:** Phase 6 development and QA logs.
