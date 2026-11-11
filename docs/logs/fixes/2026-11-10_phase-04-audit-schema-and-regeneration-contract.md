# Fix Log: Phase 4 Audit — Provider Schema and Regeneration Contract

**Date:** 2026-11-10
**Severity:** High
**Affected phase:** Phase 4
**Components:** `src/ai/model-provider.ts`, `src/ai/ai-processor.ts`

## Findings

1. The Gemini `responseJsonSchema` represented nullable strings with
   `type: ['string', 'null']`, while the installed GenAI SDK schema contract
   uses a string type plus `nullable: true`.
2. A validation regeneration could return a low-score `TEXT-MESSAGE` response
   with null translations. The validator correctly accepted that low-score
   shape, but the processor could then report it as `translated` even though
   the original path required a translated announcement.
3. Malformed model output was parsed outside the provider-failure audit path.

## Changes

- Replaced the provider schema union representation with the SDK-compatible
  nullable representation.
- Added response-mode and score-contract checks to initial and regenerated
  responses; regenerated responses must remain translatable.
- Audited malformed output as a failed AI process and mark it held when an
  announcement identifier is available.
- Added regression tests for invalid regenerated scores and malformed output.

## Verification

```text
npm test -- tests/unit/phase4-ai-and-validation.test.ts
npm test
npm run typecheck
npm run build
git diff --check
```

Results: focused suite **9/9 passed**; full suite **33/33 passed**; typecheck,
build, and whitespace checks passed.

## Remaining Risk

No live Gemini request was made. A controlled integration check with approved
credentials should verify that the provider accepts the JSON schema and returns
the expected response text.

