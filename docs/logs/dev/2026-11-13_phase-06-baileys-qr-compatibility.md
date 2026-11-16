# Development Log: Phase 6 — Baileys QR Pairing and Activation Gating

**Date and time:** 2026-11-13 19:28
**Agent:** Backend developer
**Moderator:** Not specified
**Status:** Completed for this compatibility fix; full Phase 6 remains incomplete

## 1. Objective

Restore terminal QR pairing with the current Baileys behavior, resolve the
WhatsApp Web client-version incompatibility that caused repeated `405`
disconnects, and prevent inbound message processing before authentication
completes.

## 2. Scope and Acceptance Criteria

**Authorized phase:** Phase 6 — End-to-End Composition and Live Baileys Cutover

**Acceptance criteria:**

- Render QR data from `connection.update` without the deprecated
  `printQRInTerminal` option.
- Use a current WhatsApp Web client revision during socket creation.
- Do not process `messages.upsert` events until connection status is `open`.
- Preserve credential updates, reconnect behavior, and existing adapter
  contracts.

**Explicitly out of scope:**

- Production SIM pairing or destination-group verification.
- Full Phase 6 live cutover and release sign-off.
- Changes to the administrative dashboard.

## 3. References

- [Project plan](../../project-plan.md)
- [Baileys integration specification](../../BAILEYS_INTEGRATION_SPEC.md)
- [WhatsApp and Baileys skill](../../../.github/skills/whatsapp-baileys/SKILL.md)

## 4. Changes Made

**Files created:**

- `docs/logs/dev/2026-11-13_phase-06-baileys-qr-compatibility.md`

**Files modified:**

- `src/whatsapp/baileys-client.ts`
- `package.json`
- `package-lock.json`

**Files deleted:** None

**Implementation summary:**

- Added `qrcode-terminal` and rendered QR payloads received from
  `connection.update`.
- Removed the deprecated `printQRInTerminal` setting.
- Fetched the latest WhatsApp Web version before creating the socket, with an
  explicit warning when the helper falls back to Baileys' bundled version.
- Gated inbound upsert handling until the adapter status is `open`.

## 5. Technical Decisions and Deviations

- **Decision:** Resolve the WhatsApp Web version dynamically at connection
  time.
  **Rationale:** Baileys `6.7.22` used a stale bundled revision, and WhatsApp
  rejected the connection with `405 client_too_old` before emitting a QR.
- **Decision:** Register the message listener during socket setup but gate its
  handler on `open`.
  **Rationale:** The socket must subscribe to connection and message events
  early, while application processing must begin only after pairing.
- **Deviation:** No dependency upgrade to the Baileys 7 release candidates.
  **Rationale:** The compatibility fix is contained within the existing
  approved Baileys version and avoids an unrelated breaking upgrade.

## 6. Deliverables

| Deliverable | Status | Description |
|---|---|---|
| Terminal QR pairing | Complete | QR rendered successfully during a live local run |
| Current Web-version negotiation | Complete | Dynamic version resolved before socket creation |
| Pre-open message gate | Complete | Upserts are ignored until status is `open` |
| Full live cutover | Partial | QR display verified; physical scan and production validation remain |

## 7. Verification

**Commands run:**

```text
npm install
npm run typecheck
npm test -- --run tests/unit/baileys-error-boundary.test.ts
$env:WHATSAPP_ADAPTER_MODE="baileys"; npm run dev
```

**Results:**

- **Passed:** TypeScript typecheck.
- **Passed:** Focused Baileys regression tests, 2 tests passed.
- **Passed:** Live local run fetched a current Web revision and rendered a
  terminal QR.
- **Failed:** None.
- **Skipped / blocked:** Physical QR scan and production WhatsApp group smoke
  test were not performed.

## 8. Risks, Known Issues, and Follow-up

- The dynamic version fetch depends on network access; the code logs a warning
  and uses the bundled fallback when the fetch cannot complete.
- The live account and production group permissions still require an
  authorized smoke test.
- **Tester focus:** Verify QR refresh/expiry behavior, connection-open
  transition after scanning, and that pre-open upserts are not handed to
  ingestion.

## 9. Commit and Documentation

**Commit:** The containing commit for this development log.
**Related documentation:** This development log; project plan Phase 6.
