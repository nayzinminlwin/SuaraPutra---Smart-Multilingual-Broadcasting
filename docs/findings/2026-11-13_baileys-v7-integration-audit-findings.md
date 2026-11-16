# Baileys v7 Integration and Complementary Testing Audit

**Date:** 2026-11-13
**Status:** Conditional readiness; controlled live validation remains required
**Scope:** Baileys `7.0.0-rc14` integration with ingestion, AI handoff,
SQLite persistence, delivery queue, retry/recovery, and mock transport
**Related plan:** [`baileys_v7_0_0_rc14_migration_plan.md`](../baileys_v7_0_0_rc14_migration_plan.md)

## 1. Executive finding

Baileys `7.0.0-rc14` is integrated correctly with the existing
provider-independent adapter boundary and local processing pipeline. Compile,
runtime, synthetic pipeline, queue, and delivery regression checks passed.

The migration is **ready for controlled live validation**, but it is not yet
proven production-ready with the actual WhatsApp Community. No physical pairing,
real group membership check, real message receipt, or live destination send was
performed during this audit.

## 2. Verification evidence

The following checks were executed on Node.js `22.23.3`:

| Check | Result |
|---|---|
| `npm ls @whiskeysockets/baileys --depth=0` | Passed; `7.0.0-rc14` |
| `npm run typecheck` | Passed |
| `npm run build` | Passed |
| `npm test -- --run` | Passed; 8 files, 79 tests |
| `npm run simulate:live` | Passed; simulation output generated |
| `npx tsx scripts/verify-environment.ts` | Passed |
| Isolated Baileys socket smoke test | Passed; socket booted and QR rendered |
| `git diff --check` | Passed |

The local audit used synthetic data and a temporary auth directory. The
temporary auth directory and smoke-test artifacts were removed afterward.

## 3. Confirmed integration behavior

1. The Baileys SDK remains behind the WhatsApp adapter boundary.
2. PN and LID identities are normalized and compared without device suffixes.
3. `participantAlt` and `remoteJidAlt` are retained for alternate sender
   matching.
4. Self-echo filtering accepts multiple bot identities.
5. Announcement-only groups require the bot to be an `admin` or
   `superadmin`.
6. Raw Baileys payloads use `BufferJSON.replacer` for binary-safe persistence.
7. Normalized messages continue through source filtering, deduplication,
   context assembly, AI processing, validation, queue persistence, and
   independent per-language delivery.
8. Retryable, permanent, uncertain, lease-expired, and kill-switch paths remain
   represented in the existing queue and delivery tests.
9. Baileys v7 starts without compile or import failures and reaches QR pairing
   readiness.

## 4. Findings and risks

| ID | Severity | Finding | Impact |
|---|---|---|---|
| INT-V7-01 | Medium | If WhatsApp accepts a send but SQLite fails while recording `sent`, the delivery job remains `sending` until lease recovery rather than becoming `uncertain` immediately. | The provider outcome is ambiguous during the lease window, and operational status is temporarily less explicit than the queue contract requires. Automatic duplication is eventually avoided by lease recovery, but immediate state accuracy is weaker. |
| INT-V7-02 | Medium | Startup does not automatically verify source and destination group membership and posting permissions after connection. | The application can reach `open` before proving that configured Community groups are present and writable. Automatic publishing should remain disabled until this is checked operationally or implemented. |
| INT-V7-03 | Medium | The local smoke test proves socket startup and QR rendering only. | PN/LID values, fresh auth persistence, real Community metadata, admin permissions, inbound receipt, outbound delivery, and reconnect behavior remain unverified against WhatsApp. |
| INT-V7-04 | Low/Medium | View-once message variants are currently discarded by the normalizer instead of being unwrapped. | View-once announcements will not enter the pipeline if that message type is required by the approved scope. |

`INT-V7-01` is exercised by the existing delivery test in
[`phase5-delivery-queue.test.ts`](../../tests/unit/phase5-delivery-queue.test.ts).
The test confirms that the current behavior avoids blind retry, but it also
documents the delayed `uncertain` transition.

## 5. Live validation still required

Using a dedicated account and controlled groups, the next proof-of-concept
should verify:

1. Fresh v7 auth-state creation and credential persistence.
2. PN and LID identities exposed by the paired account.
3. Source-group membership and inbound message normalization.
4. Self-message filtering in the actual Community.
5. Destination-group membership and `announce: true` admin permissions.
6. One controlled send to each configured language group.
7. Reconnect and recovery without duplicate publication.
8. Logged-out handling and kill-switch behavior.
9. Safe delivery state and outgoing message ID persistence.

Do not treat the QR smoke test as evidence of live Community compatibility.

## 6. Recommendation

**Conditional go-forward.** The migration should proceed to a controlled live
proof of concept, but automatic production broadcasting should remain gated
until `INT-V7-02` and `INT-V7-03` are addressed or explicitly accepted by the
project owner. `INT-V7-01` should be corrected before relying on delivery
health state for operational incident response.

## 7. Evidence references

- [Baileys adapter](../../src/whatsapp/baileys-client.ts)
- [Adapter contract](../../src/whatsapp/adapter.ts)
- [Event normalizer](../../src/whatsapp/event-normalizer.ts)
- [Message ingestor](../../src/ingestion/message-ingestor.ts)
- [Delivery dispatcher](../../src/delivery/dispatcher.ts)
- [Delivery queue](../../src/delivery/queue.ts)
- [Architecture](../architecture.md)
- [Baileys integration specification](../BAILEYS_INTEGRATION_SPEC.md)
- [Original v7 upgrade findings](./2026-11-13_baileys-v7-upgrade-findings.md)
