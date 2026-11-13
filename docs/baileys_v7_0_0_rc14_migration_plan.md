# SuaraPutra: Baileys v7.0.0-rc14 Assessment & Migration Plan (Phase 6.2)

**Project Name:** SuaraPutra — Smart Multilingual Broadcasting  
**Document Path:** `docs/baileys_v7_0_0_rc14_migration_plan.md`  
**Version:** 1.1.0 (Revised per Pre-Execution Agent Review)  
**Date:** 13 November 2026  
**Baseline Package:** `@whiskeysockets/baileys` `6.7.22`  
**Target Package:** `@whiskeysockets/baileys` `7.0.0-rc14` (Exact Pin)  
**Input References:**  
* Upgrade Findings: [`docs/findings/2026-11-13_baileys-v7-upgrade-findings.md`](./findings/2026-11-13_baileys-v7-upgrade-findings.md)  
* Architecture Source of Truth: [`docs/architecture.md`](./architecture.md)  
* Master Execution Plan: [`docs/project-plan.md`](./project-plan.md)  
**Status:** Approved for Execution

---

## 1. Executive Summary & Pre-Execution Review Corrections

### 1.1 Why We Are Migrating to `7.0.0-rc14` Now
1. **WhatsApp Communities Default to Linked Identity JIDs (`@lid`) (`V7-01`, `V7-04`):** WhatsApp Communities and large groups increasingly identify participants by `@lid` rather than phone-number JIDs (`@s.whatsapp.net`). Baileys `7.0.0-rc14` natively supports `lid-mapping` Signal sessions, `sock.user.lid`, and alternate identity fields (`participantAlt`, `remoteJidAlt`).
2. **Anti-Ban Protection (`V7-03`):** Baileys v7 disables automatic client delivery ACK emission, reducing automated account restriction risk.
3. **Zero Auth-State Migration Cost (`V7-02`):** Because no production WhatsApp session has been paired yet, upgrading now allows the very first physical SIM pairing to initialize a native v7 auth state in `./private/whatsapp-auth`.

### 1.2 Corrections Incorporated from the Pre-Execution Review
This v1.1.0 plan incorporates all 8 required corrections identified during pre-execution review:
1. **Explicit Cross-Boundary Scope:** Explicitly includes `src/app.ts`, `src/whatsapp/adapter.ts`, `src/whatsapp/mock-adapter.ts`, `src/whatsapp/baileys-client.ts`, `src/whatsapp/event-normalizer.ts`, `src/whatsapp/group-metadata.ts`, and `src/ingestion/message-ingestor.ts` so multi-identity self-echo protection is wired end-to-end.
2. **Group Admin Permission Behavior Fix (`group-metadata.ts`):** Fixes the existing permission logic where `announce: true` unconditionally set `botCanSend = false`. The updated logic enforces:
   * `announce !== true` $\rightarrow$ any group participant (`botIsParticipant === true`) has `botCanSend = true`.
   * `announce === true` $\rightarrow$ `botCanSend = true` **if and only if** the matched bot participant has `admin === 'admin'` or `admin === 'superadmin'`; non-admin participants have `botCanSend = false`.
3. **Complete `getBotIdentities()` Integration:** Adds `getBotIdentities(): string[]` to `IWhatsAppAdapter`, implements it in both `BaileysWhatsAppAdapter` and `MockWhatsAppAdapter`, wires `() => adapter.getBotIdentities()` in `src/app.ts`, and updates `MessageIngestor` to accept `string | string[] | null | (() => string | string[] | null)`.
4. **Historical Documentation Preservation:** Historical `6.7.22` references in Phase 0–6 sections of `docs/project-plan.md`, `docs/DECISIONS.md`, and `docs/logs/**` **must not** be overwritten. Only current-state specifications are updated, and an additive Phase 6.2 migration record is appended.
5. **Separated Verification Tiers:** Distinguishes (1) mock/synthetic pipeline regression (`npm run simulate:live`), (2) focused Baileys v7 adapter/normalizer/metadata unit tests, and (3) live Baileys v7 socket/QR smoke testing with a fresh external auth directory.
6. **Canonical Repository File Paths:** Uses the exact repository paths `docs/findings/2026-11-13_baileys-v7-upgrade-findings.md` and `docs/baileys_v7_0_0_rc14_migration_plan.md`. Leaves pre-existing untracked files (such as `docs/admin_panel_architecture_phased_execution_plan.md`) completely untouched.
7. **Preserve `fetchLatestWaWebVersion()`:** Preserves the existing `fetchLatestWaWebVersion()` call in `src/whatsapp/baileys-client.ts` unless `7.0.0-rc14` compilation explicitly requires a signature adjustment.
8. **Independent QA Log Ownership:** `developer.agent.md` authors the development log (`docs/logs/dev/...`) and any applicable fix log (`docs/logs/fixes/...`), while `tester.agent.md` independently executes the test suite and authors the QA test report (`docs/logs/test/...`).

---

## 2. Resolution Matrix for Findings `V7-01` Through `V7-09`

| Finding ID | Severity | Resolution Design in Phase 6.2 |
| :--- | :--- | :--- |
| **V7-01** | High | **End-to-End Multi-Identity Matching (`PN` + `LID`):** Implement `normalizeUserJid()` (stripping `:device` suffixes while keeping `@s.whatsapp.net` or `@lid` domains) and `isSameWhatsAppIdentity()`. Expose `getBotIdentities(): string[]` on `IWhatsAppAdapter` and wire it through `src/app.ts` into `MessageIngestor` and `group-metadata.ts`. |
| **V7-02** | Low | **Native v7 Multi-File Auth Store:** `useMultiFileAuthState` in `7.0.0-rc14` natively supports `lid-mapping`, `device-list`, and `tctoken`. Live testing will initialize a fresh `./private/whatsapp-auth` directory. |
| **V7-03** | High | **Server-Acceptance Send Contract (No ACK Emulation):** Retain the `acknowledgedAtIso` field name on `SendMessageResult` for backward compatibility, and document in `src/whatsapp/adapter.ts` and `docs/BAILEYS_INTEGRATION_SPEC.md` that it represents the UTC timestamp when `sendMessage()` resolved (provider request acceptance), not a client-emitted delivery ACK. |
| **V7-04** | Medium | **Alternate Identity Fields (`participantAlt`, `remoteJidAlt`):** In `event-normalizer.ts`, extract primary `senderJid` and optional `senderAltJid` (from `key.participantAlt` / `key.remoteJidAlt`). In `group-metadata.ts`, match bot identities against participant `id`, `lid`, and `phoneNumber` / `jid` fields. |
| **V7-05** | Medium | **ESM Compile-First Check:** Upgrade dependency first and run `npm run typecheck` to verify `7.0.0-rc14` ESM exports against the existing `NodeNext` setup before altering runtime logic. |
| **V7-06** | Medium | **Lockfile & Install Policy Update:** Pin `"@whiskeysockets/baileys": "7.0.0-rc14"` in `package.json`, update any version-pinned `allowScripts` entry if present, regenerate `package-lock.json`, and verify runtime import in `scripts/verify-environment.ts`. |
| **V7-07** | Medium | **Safe Raw Payload Serialization (`BufferJSON.replacer`):** Use `JSON.stringify(rawMsg, BufferJSON.replacer)` in `src/whatsapp/event-normalizer.ts` so binary buffers inside v7 message objects serialize safely. |
| **V7-08** | Medium | **Preserve `fetchLatestWaWebVersion()` & QR/Open Gating:** Keep `fetchLatestWaWebVersion()`, `qrcode-terminal` rendering, pre-`open` upsert gating, bounded reconnect backoff, and `DisconnectReason.loggedOut` halt in `src/whatsapp/baileys-client.ts`. |
| **V7-09** | Low | **Exact Version Pin:** Pin `"7.0.0-rc14"` with no `^` or `~` range in `package.json`. |

---

## 3. Partitioned Execution Plan (Phase 6.2)

Execute Phase 6.2 sequentially across **Partitions A through D**. Do not modify or stage any untracked files outside this scope (specifically leave `docs/admin_panel_architecture_phased_execution_plan.md` untouched).

---

### Partition A — Dependency Upgrade, Lockfile Regeneration & Compile-First Check (`V7-05`, `V7-06`, `V7-08`, `V7-09`)

* **Owner:** `developer.agent.md`
* **Files in Scope:**
  * `package.json`
  * `package-lock.json`
  * `scripts/verify-environment.ts`
  * `src/whatsapp/baileys-client.ts` *(compile/type adjustment only if required by rc14)*
* **Implementation Tasks:**
  1. **Pin Exact Version:** In `package.json`, update `"@whiskeysockets/baileys"` from `"6.7.22"` to exact `"7.0.0-rc14"`.
  2. **Install Script Policy Check:** Inspect `package.json` for any version-specific `allowScripts` or build-script allowlist entries and update them if needed for `7.0.0-rc14` and its transitive dependencies (`whatsapp-rust-bridge`, `libsignal`, `p-queue`).
  3. **Regenerate Lockfile & Compile-Test First:**
     * Run `npm install`.
     * Run `npm run typecheck` immediately before making behavioral changes to inspect how `src/whatsapp/baileys-client.ts` (including `makeWASocket`, `fetchLatestWaWebVersion`, `downloadMediaMessage`, and `BufferJSON`) compiles against `7.0.0-rc14`.
     * Preserve `fetchLatestWaWebVersion()` as-is unless `7.0.0-rc14` type definitions require an adjustment.
  4. **Environment Verifier Update:** Update `scripts/verify-environment.ts` to verify that `@whiskeysockets/baileys` (`7.0.0-rc14`) and `BufferJSON` load cleanly.
* **Verification Gate (Partition A):**
  * `npm ls @whiskeysockets/baileys` reports `7.0.0-rc14`.
  * `npm run typecheck` and `npx tsx scripts/verify-environment.ts` pass.

---

### Partition B — End-to-End Multi-Identity Contract & Group Admin Permission Fix (`V7-01`, `V7-03`, `V7-04`, `V7-07`)

* **Owner:** `developer.agent.md`
* **Files in Scope:**
  * `src/whatsapp/adapter.ts`
  * `src/whatsapp/mock-adapter.ts`
  * `src/whatsapp/baileys-client.ts`
  * `src/whatsapp/event-normalizer.ts`
  * `src/whatsapp/group-metadata.ts`
  * `src/ingestion/message-ingestor.ts`
  * `src/app.ts`
* **Implementation Tasks:**
  1. **Transport Interface & Identity Helpers (`src/whatsapp/adapter.ts`):**
     * Add `senderAltJid?: string | null` to `NormalizedInboundMessage` to hold a normalized alternate sender identity (`participantAlt` or `remoteJidAlt`) when present.
     * Add `getBotIdentities(): string[]` to `IWhatsAppAdapter` (alongside `getBotJid(): string | null` for backward compatibility).
     * Export helper functions `normalizeUserJid(jid: string | null | undefined): string | null` (which strips `:device` suffixes such as `:12` while preserving `@s.whatsapp.net` or `@lid`) and `isSameWhatsAppIdentity(candidates: Array<string | null | undefined>, botIdentities: Array<string | null | undefined>): boolean`.
     * Update the JSDoc on `SendMessageResult.acknowledgedAtIso` to clarify that it records the UTC timestamp when `sendMessage()` resolved (provider request acceptance), not a client-emitted delivery ACK (`V7-03`).
  2. **Adapter Implementations (`src/whatsapp/mock-adapter.ts` & `src/whatsapp/baileys-client.ts`):**
     * In `MockWhatsAppAdapter`: Implement `getBotIdentities(): string[]` returning all configured mock bot JIDs (e.g., `[this.botJid]` plus any optional mock LID configured for testing).
     * In `BaileysWhatsAppAdapter`: Implement `getBotIdentities(): string[]` returning all non-null normalized identities from `[this.sock?.user?.id, this.sock?.user?.lid]`. Keep `getBotJid()` returning the primary normalized identity (`normalizeUserJid(this.sock?.user?.id ?? this.sock?.user?.lid)`).
  3. **Composition Root & Ingestor Wiring (`src/app.ts` & `src/ingestion/message-ingestor.ts`):**
     * Update `MessageIngestor` constructor's `botJidProvider` type to accept:
       ```typescript
       string | string[] | null | (() => string | string[] | null)
       ```
     * In `src/app.ts`, wire `MessageIngestor` with `() => adapter.getBotIdentities()` (falling back to `adapter.getBotJid()` if needed).
     * In `MessageIngestor` Gate 2 (Self-Echo / Loop Prevention), resolve the current bot identities array and reject the message as a self-echo if `msg.fromMe === true` **OR** `isSameWhatsAppIdentity([msg.senderJid, msg.senderAltJid], botIdentities)` is `true`.
  4. **Event Normalizer Updates (`src/whatsapp/event-normalizer.ts`):**
     * Extract `senderJid` using `normalizeUserJid(key.participant ?? key.participantAlt ?? key.remoteJid)`.
     * Extract `senderAltJid` using `normalizeUserJid(key.participantAlt ?? key.remoteJidAlt)` when present and distinct from `senderJid`.
     * Serialize `rawPayloadJson` using `JSON.stringify(rawMsg, BufferJSON.replacer)` (`V7-07`).
  5. **Group Metadata Permission & LID Matching Fix (`src/whatsapp/group-metadata.ts`):**
     * Accept `botIdentities: string | string[] | null` when inspecting `GroupMetadata`.
     * Match the bot's participant entry by comparing `botIdentities` against each participant's `id`, `lid`, and `phoneNumber` / `jid` fields using `isSameWhatsAppIdentity`.
     * Compute `botIsParticipant` and `botCanSend` with explicit announcement-group admin semantics:
       * If `!botIsParticipant` $\rightarrow$ `botCanSend = false`.
       * If `botIsParticipant && metadata.announce !== true` $\rightarrow$ `botCanSend = true`.
       * If `botIsParticipant && metadata.announce === true` $\rightarrow$ `botCanSend = (matchedParticipant.admin === 'admin' || matchedParticipant.admin === 'superadmin')`.
* **Verification Gate (Partition B):**
  * `npm run typecheck` and `npm run build` pass with zero errors.

---

### Partition C — Focused Baileys v7 Unit Tests & Pipeline Regression (`tester.agent.md` + `developer.agent.md`)

* **Owner:** `developer.agent.md` (test implementation) & `tester.agent.md` (independent QA execution and verification)
* **Files in Scope:**
  * `tests/unit/phase2-whatsapp-mock.test.ts`
  * `tests/unit/phase3-ingestion.test.ts`
  * `tests/unit/baileys-error-boundary.test.ts`
* **Implementation Tasks:**
  1. **Add Focused v7 Adapter, Normalizer & Group Metadata Tests:**
     * **Test V7-T1 (LID Sender & `participantAlt` Normalization):** Verify `event-normalizer.ts` normalizes `key.participant = "1029384756:3@lid"` and `key.participantAlt = "60123456789:0@s.whatsapp.net"` into `senderJid === "1029384756@lid"` and `senderAltJid === "60123456789@s.whatsapp.net"`.
     * **Test V7-T2 (Multi-Identity Self-Echo Filtering in Gate 2):** Configure `MessageIngestor` with bot identities `["60199999999@s.whatsapp.net", "5544332211@lid"]`. Verify Gate 2 drops inbound messages when `fromMe: false` and either `senderJid` matches `"5544332211:2@lid"` or `senderAltJid` matches `"60199999999:1@s.whatsapp.net"`.
     * **Test V7-T3 (Group Admin Permission Logic on `announce: true` vs `announce: false`):**
       * Case A (`announce: false`, bot is regular member by `@lid`) $\rightarrow$ `botIsParticipant === true`, `botCanSend === true`.
       * Case B (`announce: true`, bot is regular member `admin: null` by `@lid`) $\rightarrow$ `botIsParticipant === true`, `botCanSend === false`.
       * Case C (`announce: true`, bot is `admin: 'admin'` or `'superadmin'` matched via `@lid` or `phoneNumber`) $\rightarrow$ `botIsParticipant === true`, `botCanSend === true`.
     * **Test V7-T4 (`BufferJSON` Raw Payload Serialization):** Verify `event-normalizer.ts` serializes a raw message containing a `Uint8Array` / `Buffer` field into `rawPayloadJson` via `BufferJSON.replacer` without throwing or losing binary buffer structure.
  2. **Tier 1 & Tier 2 Verification Execution:**
     * **Tier 1 (v7 Unit & Integration Suite):** Run `npm run typecheck`, `npm run build`, and `npm test`.
     * **Tier 2 (Synthetic Pipeline Regression):** Run `npm run simulate:live` (confirming that the core pipeline and file-backed mock outbox remain 100% regression-free after the multi-identity changes).
  3. **Tier 3 (Local Baileys v7 Socket & QR Smoke Check):**
     * Run `$env:WHATSAPP_ADAPTER_MODE="baileys"; npm run dev` with a clean `./private/whatsapp-auth` directory to confirm Baileys `7.0.0-rc14` boots, resolves the WhatsApp Web version via `fetchLatestWaWebVersion()`, and renders a terminal QR code without crashing. *(Physical SIM pairing and live group send remain gated on Developer authorization).*

---

### Partition D — Scoped Documentation Sync, Independent QA Report & Git Commit

* **Owners:**
  * `developer.agent.md`: Documentation updates and `docs/logs/dev/2026-11-13_phase-06-2-baileys-v7-migration.md` (plus `docs/logs/fixes/...` if any defect was fixed during the phase).
  * `tester.agent.md`: Independent QA verification and `docs/logs/test/2026-11-13_phase-06-2-baileys-v7-migration-test.md`.
* **Files in Scope:**
  * `docs/architecture.md`
  * `docs/BAILEYS_INTEGRATION_SPEC.md`
  * `docs/project-plan.md`
  * `docs/DECISIONS.md`
  * `docs/operations-runbook.md`
  * `docs/logs/dev/2026-11-13_phase-06-2-baileys-v7-migration.md`
  * `docs/logs/test/2026-11-13_phase-06-2-baileys-v7-migration-test.md`
* **Implementation Tasks:**
  1. **Preserve Historical Records While Updating Current-State Specs:**
     * In `docs/architecture.md`, `docs/BAILEYS_INTEGRATION_SPEC.md`, and `docs/operations-runbook.md`: Update current-state transport specifications to reflect `@whiskeysockets/baileys` `7.0.0-rc14`, multi-identity (`PN` + `LID`) matching, `announce: true` admin posting rules, and the v7 server-acceptance (`acknowledgedAtIso`) contract.
     * In `docs/project-plan.md` and `docs/DECISIONS.md`: **Do not** alter historical `6.7.22` references inside completed Phase 0–6 sections. Instead, append a **Phase 6.2 (Baileys `7.0.0-rc14` Migration)** entry documenting the upgrade from `6.7.22` to `7.0.0-rc14`.
  2. **Write Mandatory Phase 6.2 Logs:**
     * Developer writes `docs/logs/dev/2026-11-13_phase-06-2-baileys-v7-migration.md`.
     * Tester independently reviews test output and writes `docs/logs/test/2026-11-13_phase-06-2-baileys-v7-migration-test.md`.
  3. **Strict Git Scope Audit & Commit:**
     * Run `git status --porcelain` and verify that `docs/admin_panel_architecture_phased_execution_plan.md` (and any other unrelated files) are **not** staged.
     * Stage only the explicit Phase 6.2 files and commit with prefix `feat(phase-06.2/baileys-v7): ...`.

---

## 4. Phase 6.2 Acceptance Checklist

- [ ] `@whiskeysockets/baileys` pinned to exact `"7.0.0-rc14"` in `package.json` and `package-lock.json`.
- [ ] `npm run typecheck`, `npm run build`, and `npm test` pass 100%.
- [ ] `IWhatsAppAdapter.getBotIdentities()` implemented in both `BaileysWhatsAppAdapter` and `MockWhatsAppAdapter` and wired through `src/app.ts` to `MessageIngestor`.
- [ ] `group-metadata.ts` allows `botCanSend = true` when `announce === true` and the bot is `admin` or `superadmin`, and `botCanSend = false` when the bot is a non-admin in an announcement-only group.
- [ ] Focused unit tests (`V7-T1` through `V7-T4`) pass for LID normalization, `participantAlt`, LID self-echo filtering, `BufferJSON` serialization, and group admin permissions.
- [ ] Historical `6.7.22` records in `docs/project-plan.md`, `docs/DECISIONS.md`, and `docs/logs/` remain intact, with Phase 6.2 added as a new record.
- [ ] Developer log (`dev`) and independent Tester log (`test`) created and verified.

**End of Baileys v7.0.0-rc14 Migration Plan (`docs/baileys_v7_0_0_rc14_migration_plan.md`).**