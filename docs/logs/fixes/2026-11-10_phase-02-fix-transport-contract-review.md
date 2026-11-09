# Fix Log: Phase 2 Transport Contract Review

**Date:** 2026-11-10
**Severity:** Medium
**Affected phase:** Phase 2 — WhatsApp Transport Abstraction and Mock Adapter
**Status:** Resolved

## 1. Defects and Root Causes

- The CP01 test only checked that no log was emitted, so it did not verify
  the required checkpoint output or `t_wa_source_sent_ms`.
- Empty `extendedTextMessage.text` values were classified as `TEXT` because
  the normalizer tested for the presence of the message object.
- WhatsApp-specific error classes were stored in the shared error module,
  weakening the transport boundary.
- The mock adapter lacked call-index fault injection and did not expose the
  required translated-send timestamp in its outbox.

## 2. Changes

- Added direct CP01 console assertion coverage.
- Classified empty extended text as `UNSUPPORTED`.
- Moved WhatsApp transport errors to `src/whatsapp/errors.ts`.
- Added `faultModesByCallIndex`, pino logging, and
  `t_wa_translated_sent_ms` to mock sends.

## 3. Verification

```text
npm test -- --run tests/unit/phase2-whatsapp-mock.test.ts
npm run typecheck
npm run build
npm test
git diff --check
```

- Focused suite: 11 passed.
- Full suite: 19 passed.
- Typecheck and build: passed.
- Diff check: passed.

## 4. Remaining Risk

Live Baileys socket behavior remains intentionally outside Phase 2 and must be
verified in its authorized phase.
