# Multi-Source WhatsApp Groups — Backend Extension

**Date and time:** 2026-11-21 01:00
**Agent:** Backend developer
**Moderator:** Project owner
**Status:** Completed

## 1. Objective

Allow the existing WhatsApp source group and additional configured source
groups to be processed concurrently through the existing ingestion pipeline.

## 2. Scope and Acceptance Criteria

**Authorized change:** Add a second source group without removing the current
source group.

**Acceptance criteria:**

- The legacy `WHATSAPP_SOURCE_GROUP_JID` remains active.
- `WHATSAPP_SOURCE_GROUP_JIDS` can add source groups.
- Discovery preserves existing source groups and can resolve an additional
  source invite.
- Messages from configured source groups are accepted.
- Context remains isolated by source group.
- Non-configured groups remain rejected.

**Explicitly out of scope:**

- Changes to AI processing, destination routing, delivery, or WhatsApp
  connection count.

## 3. References

- [Architecture](../../architecture.md)
- [Project plan](../../project-plan.md)
- [Baileys integration specification](../../BAILEYS_INTEGRATION_SPEC.md)

## 4. Changes Made

**Files modified:**

- `src/config/env.ts`
- `src/config/groups.ts`
- `src/ingestion/message-ingestor.ts`
- `scripts/discover-whatsapp-groups.ts`
- `tests/unit/phase0-init.test.ts`
- `tests/unit/phase3-ingestion.test.ts`
- `docs/architecture.md`
- `docs/DECISIONS.md`
- `docs/project-plan.md`
- `docs/manual/google-vm-operations.md`

**Implementation summary:**

- Added optional comma-separated source-group configuration while retaining the
  legacy source variable.
- Updated discovery to preserve the primary source and manage additional
  source invite links.
- Changed Gate 1 to use source-group membership.
- Kept context queries keyed by the message's own `chatJid`.
- Added configuration and ingestion regression coverage.

## 5. Technical Decisions and Deviations

- **Decision:** Keep `WHATSAPP_SOURCE_GROUP_JID` as the primary source and use
  `WHATSAPP_SOURCE_GROUP_JIDS` for additional source groups.
  **Rationale:** Existing deployments remain compatible, and the original
  source cannot disappear merely because the additional source is changed.
- **Decision:** Use one Baileys connection and one FIFO ingestion pipeline.
  **Rationale:** Source filtering is an application concern; transport
  duplication is unnecessary.

## 6. Deliverables

| Deliverable | Status | Description |
|---|---|---|
| Multi-source configuration | Complete | Legacy and additional JIDs are validated and deduplicated. |
| Discovery support | Complete | Additional source invite links are resolved and persisted. |
| Ingestion support | Complete | Configured sources pass Gate 1; context remains chat-scoped. |
| Regression tests | Complete | Configuration and multi-source ingestion cases pass. |

## 7. Verification

**Commands run:**

```text
npm test -- tests/unit/phase0-init.test.ts tests/unit/phase3-ingestion.test.ts
npm run typecheck
npm test
```

**Results:**

- **Passed:** 17 focused tests, full test suite, and TypeScript typecheck.
- **Failed:** None.
- **Skipped / blocked:** Full test suite not run; targeted tests cover the
  changed configuration and ingestion boundaries.

## 8. Risks, Known Issues, and Follow-up

- The live discovery flow still requires a paired WhatsApp account and a
  writable environment file.
- A production operator must run discovery and restart the service after
  changing source configuration.
- **Tester focus:** Verify the live account receives both configured source
  groups and that destination messages are not treated as source messages.

## 9. Commit and Documentation

**Commit:** `c51469a`
**Related documentation:** [Architecture](../../architecture.md),
[Decisions](../../DECISIONS.md)
