# QA Report: Phase 4 — AI Engine and Translation Validation

**Date:** 2026-11-10
**Tester:** `developer.agent` (phase validation)
**Environment:** Windows, Node.js project runtime, TypeScript, Vitest, SQLite
**Build or commit under test:** Working tree before Phase 4 commit
**Status:** Passed

## 1. Scope

**Task or implementation tested:** Unified model-provider boundary, prompt
construction, structured response validation, retries, and URL preservation.

**Requirements tested:**

- Low-score casual conversation and image-caption translation behavior.
- Protected URL preservation and separated bilingual output handling.
- Transient `503` retry behavior and validation regeneration/quarantine.
- CP05/CP06 debug instrumentation.

**References:**

- [Project plan](../../project-plan.md), Section 4
- [Architecture](../../architecture.md), Sections 5.2–5.5
- [Phase 4 development log](../dev/2026-11-10_phase-04-ai-and-validation.md)

**Out of scope:** Live Gemini service calls and live WhatsApp delivery.

## 2. Test Results

| ID | Test / Scenario | Expected Result | Status | Evidence / Notes |
|---|---|---|---|---|
| T-01 | Casual chat | Score below 4 and null fields | PASS | Focused test |
| T-02 | Image caption | Score 10 and four outputs | PASS | Focused test |
| T-03 | Mixed-language post with URL | Natural four-field result and URL preservation | PASS | Focused test |
| T-04 | Separated bilingual post | Existing English/Malay text retained verbatim | PASS | Focused test |
| T-05 | Date/URL token | Protected token passes all fields | PASS | Validator test |
| T-06 | Two transient 503 failures | Two retries, then recovery | PASS | 3 provider attempts; CP05 retry banners |
| T-07 | Mutated URL | One regeneration, then held | PASS | CP06 retry and terminal failure banner |

## 3. Automated Testing

**Commands run:**

```text
npm test -- tests/unit/phase4-ai-and-validation.test.ts
npm test
npm run typecheck
npm run build
```

**Results:**

- **Passed:** Focused 7/7; full 31/31; build and typecheck passed.
- **Failed:** 0.
- **Skipped / blocked:** Live provider and live transport checks skipped by scope.
- **Coverage:** CP05 and CP06 output included microsecond durations; standalone
  validation measured 19 microseconds in the focused run.

## 4. Issues Found

None remaining. An implementation defect found during the first focused run is
recorded in the linked fix log.

## 5. Final Assessment

**Status:** PASSED

**Summary:** Phase 4 behavior is verified through deterministic provider mocks,
runtime schema parsing, retry simulation, validation failure handling, and the
full existing regression suite.

**Required action:** None for Phase 4.

**Remaining risks and limitations:**

- Live Gemini response compatibility requires later controlled integration
  verification without committing credentials or operational data.
