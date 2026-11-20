# Fix Log: AI Translation — WhatsApp Formatting

**Date and time:** 2026-11-21 01:40
**Agent:** Backend developer
**Moderator:** Project owner
**Status:** Completed
**Fix type:** Bug Fix

## 1. Trigger

- **QA report:** Manual WhatsApp verification with attached source and
  destination screenshots
- **Defect ID:** BUG-WA-FORMATTING-01
- **Severity:** Medium
- **Error summary:** A translated message displayed literal `\n` sequences and
  WhatsApp bold markers instead of rendering the intended formatting.

## 2. Affected Scope

**Phase:** Unified AI translation and delivery
**Components:** AI response normalization and translation prompt
**Contract impact:** Translation strings are normalized before validation and
delivery; language content and routing contracts are unchanged.

## 3. Reproduction

**Expected behavior:**

- Newline escape sequences become actual line breaks.
- Balanced WhatsApp formatting markers render normally.

**Actual behavior:**

- The destination message displayed `\n` literally.
- An unmatched source asterisk could prevent surrounding bold markers from
  rendering.

**Steps to reproduce:**

1. Process a source message containing WhatsApp bold syntax and line breaks.
2. Receive a model translation containing escaped backslash-newlines.
3. Send the translation to a destination group.

## 4. Root Cause

The model response was schema-valid but could contain a second level of
newline escaping after JSON parsing. The source content also included an
unmatched bold marker in parenthetical text, which could interfere with
WhatsApp's formatting parser.

## 5. Changes Made

- Normalize escaped `\n` and `\r` sequences into line breaks before validation
  and persistence.
- Remove a conservatively identified unmatched asterisk marker.
- Instruct the model to preserve WhatsApp formatting and emit real line breaks.
- Add regression tests for escaped line breaks, unmatched markers, and
  translated output.

**Files modified:**

- `src/ai/ai-processor.ts`
- `src/ai/prompts/translation.prompt.ts`
- `tests/unit/phase4-ai-and-validation.test.ts`

**Files created:**

- `src/ai/whatsapp-format.ts`
- `docs/logs/fixes/2026-11-21_fix-whatsapp-formatting.md`

**Files deleted:** None

## 6. Verification Before Retest

**Commands run:**

```text
npm test -- tests/unit/phase4-ai-and-validation.test.ts
npm run typecheck
npm test
```

**Results:**

- **Passed:** 12 focused tests, full test suite, and TypeScript typecheck.
- **Failed:** None.
- **Skipped / blocked:** Manual WhatsApp retest remains pending.

## 7. Ready for Independent Retest

- [x] Yes — Tester/project owner can retest with a new source message.

**Remaining risk:** Existing already-sent messages are not modified; only new
processing uses the normalization.

## 8. Commit and Follow-up

**Commit:** `8bdfb77`
**Related documentation:** [AI translation skill](../../../.github/skills/ai-translation-engine/SKILL.md)

---

## Appended Follow-up Fixes

### Follow-up Fix — 2026-11-21

**Status:** Completed
**Additional changes:** Restricted unmatched-marker repair to likely inline
formatting markers so ordinary multiplication, wildcard, incomplete, and
escaped asterisk text remains unchanged. Added CRLF and edge-case tests.
**Verification:** `npm test -- tests/unit/phase4-ai-and-validation.test.ts`
(12 passed); `npm run typecheck` passed.
**Commit:** `8e9404a`
