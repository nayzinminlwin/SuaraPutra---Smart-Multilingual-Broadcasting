# Development Log: Phase 2 — WhatsApp Transport Abstraction and Mock Adapter

**Date and time:** 2026-11-09 23:50 +08:00
**Agent:** Developer agent
**Moderator:** Project owner
**Status:** Completed

## 1. Objective

Implement the provider-independent WhatsApp transport contract, deterministic
Baileys event normalization, mock sending with typed fault injection, and the
11 synthetic Phase 2 fixtures.

## 2. Scope and Acceptance Criteria

**Authorized phase:** Phase 2 — WhatsApp Transport Abstraction, Mock Adapter
and 11 Synthetic Fixtures

- Normalize supported text, quoted text, image-caption, image-only, wrapper,
  unsupported, and chronological batch payloads.
- Enforce configured media limits before accepting image buffers.
- Expose a mock adapter with inspectable sends and normal, transient,
  ambiguous, and permanent outcomes.
- Emit CP01 normalization telemetry with the source timestamp.

**Explicitly out of scope:** Live Baileys socket lifecycle, ingestion gates,
media persistence, AI processing, delivery dispatch, dashboard, and production
WhatsApp data.

## 3. References

- [Project plan](../../project-plan.md)
- [Architecture source of truth](../../architecture.md)
- [Baileys integration specification](../../BAILEYS_INTEGRATION_SPEC.md)
- [WhatsApp and Baileys skill](../../../.github/skills/whatsapp-baileys/SKILL.md)

## 4. Changes Made

**Files created:**

- `src/whatsapp/adapter.ts`
- `src/whatsapp/event-normalizer.ts`
- `src/whatsapp/mock-adapter.ts`
- `tests/unit/phase2-whatsapp-mock.test.ts`
- `tests/fixtures/baileys-events/01_text_english_only.json` through
  `11_prompt_injection_attempt.json`
- `tests/fixtures/media/poster.jpg`
- `tests/fixtures/media/infographic.png`

**Files modified:**

- `src/shared/errors.ts`

**Files deleted:** None.

**Implementation summary:**

- Added provider-independent inbound, outbound, connection, group metadata,
  and adapter contracts.
- Added safe normalization of notify upserts, chronological sorting, wrapper
  handling, quote extraction, image classification, media-size enforcement,
  and CP01 tracing.
- Added a mock adapter with ordered handler delivery, deterministic outbox
  records, group-JID validation, and typed fault modes.
- Added minimal synthetic fixtures only; no private messages or credentials.

## 5. Technical Decisions and Deviations

- **Decision:** Hashes supplied by the WhatsApp payload are preserved; the
  normalizer does not hash a buffer when the provider omits the hash.
  **Rationale:** Hashing is not required for the Phase 2 boundary and avoiding
  extra synchronous work keeps CP01 within the e2-micro latency target.
- **Decision:** `fromMe` remains visible on the normalized DTO.
  **Rationale:** Phase 3 owns the five-gate filter, including self-echo
  prevention, while the normalized contract retains the source fact.
- **Deviation:** No `baileys-client.ts` was added.
  **Rationale:** The approved Phase 2 deliverables authorize the abstraction,
  normalizer, and mock adapter; live connection lifecycle is a later scope.

## 6. Deliverables

| Deliverable | Status | Description |
|---|---|---|
| Transport contract | Complete | `IWhatsAppAdapter` and all Phase 2 DTOs |
| Event normalizer | Complete | Text, quotes, images, wrappers, sorting and limits |
| Mock adapter | Complete | Connect, inject, send, metadata and fault modes |
| Synthetic fixtures | Complete | 11 JSON events and two binary media fixtures |
| Phase 2 tests | Complete | 9 focused tests covering success and failure paths |

## 7. Verification

**Commands run:**

```text
npm test -- --run tests/unit/phase2-whatsapp-mock.test.ts
npm run typecheck
npm run build
npm test
git diff --check
```

**Results:**

- **Passed:** Focused Phase 2 tests (9), full suite (17), typecheck, build,
  and diff check.
- **Failed:** None.
- **Skipped / blocked:** Live Baileys connection and real Community checks
  were not run because they are outside Phase 2 and require operational
  credentials.
- **Telemetry:** CP01 emitted `t_wa_source_sent_ms`; warmed fixture
  normalization samples were 42–126 µs in the final focused run. The first
  cold text sample was 799 µs, so cold-start latency remains a measurement
  limitation rather than a transport failure.

## 8. Risks, Known Issues, and Follow-up

- Real Baileys payload compatibility and auth lifecycle remain to be verified
  in the authorized live-integration phase.
- Phase 3 must apply source-group, self-echo, duplicate, and unsupported-kind
  gates before persistence or processing.
- **Tester focus:** Independently verify malformed payloads, wrapper behavior,
  media-limit rejection, fault classification, and fixture privacy.

## 9. Commit and Documentation

**Commit:** To be created after staged-scope review.
**Related documentation:** This log and the Phase 2 QA report.
