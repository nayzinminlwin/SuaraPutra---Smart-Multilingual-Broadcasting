# SuaraPutra: Baileys v7.0.0-rc14 Assessment & Migration Plan (Phase 6.2)

**Project Name:** SuaraPutra — Smart Multilingual Broadcasting  
**Document Path:** `docs/phase-06-2-baileys-v7-migration-plan.md`  
**Version:** 1.0.0  
**Date:** 13 November 2026  
**Baseline Package:** `@whiskeysockets/baileys` `6.7.22`  
**Target Package:** `@whiskeysockets/baileys` `7.0.0-rc14` (Exact Pin)  
**Input Reference:** [`docs/audits/2026-11-13_baileys-v7-upgrade-findings.md`](./audits/2026-11-13_baileys-v7-upgrade-findings.md)  
**Status:** Approved for Execution Prior to Live SIM Pairing

---

## 1. Executive Verdict: Is It Worth Upgrading Now?

**Verdict: YES — Upgrading to `7.0.0-rc14` right now (before pairing the physical SIM card and before starting the Phase 7 Multi-Faculty Admin Panel) is strongly recommended.**

### 1.1 Why Upgrading Now Is High-Reward and Low-Risk

1. **WhatsApp Communities Force `@lid` Addressing (`V7-01` & `V7-04`):**
   * SuaraPutra is specifically designed to run inside **WhatsApp Communities**. WhatsApp now defaults to **Linked Identity JIDs (`@lid`)** instead of phone-number JIDs (`@s.whatsapp.net`) inside Communities and large groups to protect member phone privacy.
   * On `6.7.22`, `@lid` Signal sessions frequently fail to decrypt incoming group messages (`No sessions` / `Bad MAC`) and break `group-metadata.ts` permission checks (`botIsParticipant` and `botCanSend` evaluate to `false` when the group lists participants by `@lid` while `6.7.22` only checks the bot's `@s.whatsapp.net` phone JID).
   * `7.0.0-rc14` natively supports `lid-mapping` Signal sessions, `sock.user.lid`, and `participantAlt`.
2. **Built-In Anti-Ban Protection (`V7-03`):**
   * Baileys v7 removed automatic delivery ACKs specifically because WhatsApp's anti-abuse detection started flagging and banning linked devices that emit unofficial delivery receipts. Upgrading protects the faculty WhatsApp numbers from automated bans.
   * Furthermore, SuaraPutra's `SendMessageResult.acknowledgedAtIso` contract only requires the timestamp when `sock.sendMessage()` resolves (server stanza acceptance), **not** end-user device delivery receipts. Thus, `V7-03` requires **zero database schema or state-machine changes**.
3. **Zero Auth-State Migration Cost Today (`V7-02`):**
   * Right now, you have **zero production auth states** on disk. If you stay on `6.7.22` today and upgrade to v7 later after onboarding 5 UPM faculties in the Admin Panel, every faculty would have to wipe their session and re-scan QR codes. Upgrading today means your very first live SIM pairing is natively v7.
4. **ESM Prerequisites Are Already Met (`V7-05`):**
   * Your repository already runs on Node.js $\ge 22$ with `"type": "module"` and `"moduleResolution": "NodeNext"`. The hardest part of a v6 $\rightarrow$ v7 migration (CommonJS-to-ESM conversion) is already done.
5. **Strict Adapter Isolation Limits Code Changes to `src/whatsapp/`:**
   * Because of Architectural Invariant #1 (`IWhatsAppAdapter`), **0 lines of code** in `database/`, `ingestion/`, `ai/`, `validation/`, `routing/`, or `delivery/` need to change. Only `package.json` and the files inside `src/whatsapp/` require updates.

---

## 2. Resolution Strategy for Findings `V7-01` Through `V7-09`

| Finding ID | Severity | Resolution Design in Phase 6.2 |
| :--- | :--- | :--- |
| **V7-01** | High | **Multi-Identity Bot Matching (`PN` + `LID`):** Add a JID canonicalizer (`normalizeIdentityJid`) that strips device suffixes (e.g., `60123456789:14@s.whatsapp.net` $\rightarrow$ `60123456789@s.whatsapp.net`, `99887766:2@lid` $\rightarrow$ `99887766@lid`). Update `BaileysWhatsAppAdapter` to expose both `sock.user?.id` (PN) and `sock.user?.lid` (LID) so self-echo checks and group permission checks match either identity. |
| **V7-02** | Low | **Native v7 Multi-File Auth Store:** `useMultiFileAuthState` in `7.0.0-rc14` natively manages `lid-mapping`, `device-list`, and `tctoken`. Ensure `./private/whatsapp-auth` starts clean before live pairing. |
| **V7-03** | High | **Clarify Server-Acceptance Semantics (Keep `acknowledgedAtIso` Property Name):** Keep `acknowledgedAtIso` on `SendMessageResult` so zero downstream repositories/tests break, and document in `src/whatsapp/adapter.ts` and `docs/BAILEYS_INTEGRATION_SPEC.md` that it records the UTC timestamp when `sock.sendMessage()` resolves (provider request acceptance), without implying client ACK emission. |
| **V7-04** | Medium | **Alternate Identity Support (`participantAlt`):** In `event-normalizer.ts`, extract `senderJid` from `key.participant ?? key.participantAlt ?? key.remoteJid` (preferring the primary participant JID while checking `participantAlt` during bot self-echo detection). In `group-metadata.ts`, match group participants against the bot's PN and LID (checking participant `id`, `lid`, and `phoneNumber` / `participantAlt` fields if present). |
| **V7-05** | Medium | **Direct ESM Named Import:** Keep standard ESM imports (`makeWASocket`, `DisconnectReason`, `useMultiFileAuthState`, `downloadMediaMessage`, `fetchLatestBaileysVersion`, `BufferJSON`) from `@whiskeysockets/baileys` and verify with `tsc --noEmit`. |
| **V7-06** | Medium | **Exact Pin & Install Policy Update:** Pin `"@whiskeysockets/baileys": "7.0.0-rc14"` in `package.json`, update any version-specific `allowScripts` / build-script configuration in `package.json`, regenerate `package-lock.json`, and verify `whatsapp-rust-bridge` and `libsignal` load cleanly in `scripts/verify-environment.ts`. |
| **V7-07** | Medium | **Safe Raw Payload Serialization (`BufferJSON.replacer`):** In `src/whatsapp/event-normalizer.ts`, serialize `rawPayloadJson` using `JSON.stringify(msg, BufferJSON.replacer)` so binary `Uint8Array` / `Buffer` fields inside v7 protobuf message wrappers serialize deterministically without data corruption. |
| **V7-08** | Medium | **Preserve Phase 6 QR, Version & Pre-Open Gate:** Keep `qrcode-terminal` rendering, `fetchLatestBaileysVersion()` with graceful fallback, the pre-`open` upsert gate, bounded exponential backoff, and `DisconnectReason.loggedOut` halt in `src/whatsapp/baileys-client.ts`. |
| **V7-09** | Low | **Exact Version Pinning:** Pin `"7.0.0-rc14"` without `^` or `~` ranges so automated installs never pull an untested RC. |

---

## 3. Partitioned Execution Plan (Phase 6.2)

Agents (`developer.agent.md` and `tester.agent.md`) must execute Phase 6.2 sequentially across **Partitions A through D**.

---

### Partition A — Dependency Upgrade, Lockfile & Environment Verification (`V7-05`, `V7-06`, `V7-09`)

* **Objective:** Upgrade `@whiskeysockets/baileys` to exact version `7.0.0-rc14`, update install script policies if present, regenerate `package-lock.json`, and verify that all transitive dependencies (`whatsapp-rust-bridge`, `libsignal`, `p-queue`) install and load cleanly.
* **Files in Scope:**
  * `package.json`
  * `package-lock.json`
  * `scripts/verify-environment.ts`
* **Implementation Tasks:**
  1. In `package.json`, change `"@whiskeysockets/baileys": "6.7.22"` to exact `"@whiskeysockets/baileys": "7.0.0-rc14"`.
  2. If `package.json` contains a version-pinned script policy (e.g., `allowScripts` or `trustedDependencies`), update it to permit `7.0.0-rc14` and any required native/WASM bridge packages.
  3. Run `npm install` to regenerate `package-lock.json`.
  4. In `scripts/verify-environment.ts`, add a lightweight check confirming `@whiskeysockets/baileys` exports (`makeWASocket`, `BufferJSON`, `DisconnectReason`) load cleanly at runtime.
* **Verification Gate (Partition A):**
  * Run `npm ls @whiskeysockets/baileys` and confirm `7.0.0-rc14` is installed.
  * Run `npx tsx scripts/verify-environment.ts`.

---

### Partition B — LID-Aware Identity Matching, Normalizer (`BufferJSON`) & Group Metadata (`V7-01`, `V7-04`, `V7-07`)

* **Objective:** Upgrade identity matching, event normalization, and group permission inspection to handle WhatsApp v7 Linked Identity JIDs (`@lid`), device-suffixed JIDs (`:device@`), alternate participant fields (`participantAlt`), and `BufferJSON` serialization.
* **Files in Scope:**
  * `src/whatsapp/adapter.ts`
  * `src/whatsapp/event-normalizer.ts`
  * `src/whatsapp/group-metadata.ts`
  * `src/ingestion/message-ingestor.ts`
* **Implementation Tasks:**
  1. **JID Normalization & Multi-Identity Helper (`src/whatsapp/adapter.ts` or `src/whatsapp/group-metadata.ts`):**
     * Implement `normalizeUserJid(jid: string | null | undefined): string | null`:
       * Strips the `:device` suffix while preserving the domain (`"60123456789:12@s.whatsapp.net"` $\rightarrow$ `"60123456789@s.whatsapp.net"`, `"1029384756:4@lid"` $\rightarrow$ `"1029384756@lid"`).
     * Implement `isSameWhatsAppIdentity(candidateJids: Array<string | null | undefined>, knownBotJids: Array<string | null | undefined>): boolean` which normalizes both sets and returns `true` if any non-null normalized JID intersects.
  2. **Event Normalizer Updates (`src/whatsapp/event-normalizer.ts`):**
     * Support `key.participantAlt` and `key.remoteJidAlt` on v7 `WAMessageKey`:
       * Extract `senderJid` as `normalizeUserJid(key.participant ?? key.participantAlt ?? key.remoteJid) ?? ''`.
       * Add an optional `senderAltJid?: string | null` (normalized `key.participantAlt` if distinct from `senderJid`) on `NormalizedInboundMessage` so Gate 2 can check both `msg.senderJid` and `msg.senderAltJid` against the bot's identities.
     * Serialize `rawPayloadJson` using `JSON.stringify(rawMsg, BufferJSON.replacer)` (`V7-07`) so protobuf byte buffers never corrupt JSON output.
  3. **Gate 2 Self-Echo Check (`src/ingestion/message-ingestor.ts`):**
     * Allow `botJidProvider` to return `string | string[] | null` (containing both the bot's phone JID `sock.user?.id` and LID `sock.user?.lid`).
     * In Gate 2, drop the message as a self-echo if `msg.fromMe === true` **OR** `isSameWhatsAppIdentity([msg.senderJid, msg.senderAltJid], botJids)` is `true`.
  4. **LID-Aware Group Metadata Inspector (`src/whatsapp/group-metadata.ts`):**
     * Update `inspectGroupMetadata(metadata, botJids: string | string[] | null)` so participant matching checks each group participant's `id`, `lid`, and `phoneNumber` (or `jid`) against all known bot identities (`sock.user?.id` and `sock.user?.lid`).
     * Ensure `botIsParticipant` and `botCanSend` (checking `metadata.announce` vs. participant `admin === 'admin' | 'superadmin'`) work identically whether the group lists participants by `@s.whatsapp.net` or `@lid`.
* **Verification Gate (Partition B):**
  * Run `npm run typecheck`.

---

### Partition C — `BaileysWhatsAppAdapter` v7 Socket, Media & Send Contract (`V7-02`, `V7-03`, `V7-08`)

* **Objective:** Align `src/whatsapp/baileys-client.ts` with Baileys `7.0.0-rc14` types and socket behavior while preserving the Phase 6 QR rendering, dynamic web version lookup, pre-`open` message gate, and 30-second send timeout guard.
* **Files in Scope:**
  * `src/whatsapp/baileys-client.ts`
  * `src/whatsapp/adapter.ts`
* **Implementation Tasks:**
  1. **Bot Identity Exposure (`getBotJid` & `getBotIdentities`):**
     * In `BaileysWhatsAppAdapter`, keep `getBotJid(): string | null` returning the normalized primary JID (`normalizeUserJid(this.sock?.user?.id ?? this.sock?.user?.lid)`), and add `getBotIdentities(): string[]` returning all non-null normalized identities (`[this.sock?.user?.id, this.sock?.user?.lid]`) for `MessageIngestor` and `getGroupMetadata()`.
  2. **Socket & Media Compatibility (`V7-08`):**
     * Verify `useMultiFileAuthState(this.config.WHATSAPP_AUTH_DIR)` and `makeWASocket` compile cleanly with `7.0.0-rc14` types.
     * Verify `downloadMediaMessage(msg, 'buffer', {}, { logger, reuploadRequest: this.sock.updateMediaMessage })` matches `7.0.0-rc14` signature and types.
     * Preserve `qrcode-terminal` rendering on `connection.update` (`qr`), the `status === 'open'` gate before emitting `messages.upsert`, bounded exponential reconnect backoff, and `DisconnectReason.loggedOut` halt.
  3. **No-ACK Send Result Contract (`V7-03`):**
     * In `src/whatsapp/adapter.ts`, update the JSDoc on `SendMessageResult.acknowledgedAtIso` to explicitly state:
       > *"UTC timestamp when `sendMessage()` resolved and the transport provider accepted the outbound stanza (`result.key.id`). In Baileys v7, this reflects server stanza acceptance rather than client-emitted delivery ACK receipts."*
* **Verification Gate (Partition C):**
  * Run `npm run typecheck && npm run build`.

---

### Partition D — v7 Regression Tests, Live Simulation & Documentation Sync

* **Objective:** Prove all v7 behaviors (LID senders, `participantAlt`, LID group permissions, `BufferJSON` serialization, error boundaries, and the 11-fixture suite) with automated tests and update canonical documentation.
* **Files in Scope:**
  * `tests/unit/phase2-whatsapp-mock.test.ts`
  * `tests/unit/baileys-error-boundary.test.ts`
  * `docs/BAILEYS_INTEGRATION_SPEC.md`
  * `docs/architecture.md`
  * `docs/project-plan.md`
  * `docs/DECISIONS.md`
  * `docs/operations-runbook.md`
  * `docs/logs/dev/2026-11-13_phase-06-2-baileys-v7-migration.md`
  * `docs/logs/test/2026-11-13_phase-06-2-baileys-v7-migration-test.md`
* **Implementation Tasks:**
  1. **Add Focused Baileys v7 Unit Tests:**
     * **Test V7-T1 (LID Sender & `participantAlt` Normalization):** Normalize an inbound group message where `key.participant = "1029384756:3@lid"` and `key.participantAlt = "60123456789:0@s.whatsapp.net"`; assert `senderJid === "1029384756@lid"` and `senderAltJid === "60123456789@s.whatsapp.net"`.
     * **Test V7-T2 (LID Self-Echo Prevention in Gate 2):** Configure bot identities `["60199999999@s.whatsapp.net", "5544332211@lid"]`; inject a message with `fromMe: false` but `key.participant = "5544332211:2@lid"`; assert Gate 2 drops the message as a self-echo.
     * **Test V7-T3 (LID Group Metadata Permission Check):** Pass a v7 `GroupMetadata` object where `announce: true` and the bot appears in `participants` only by its `@lid` (`id: "5544332211@lid", admin: "admin"`); assert `botIsParticipant === true` and `botCanSend === true`.
     * **Test V7-T4 (`BufferJSON` Raw Payload Serialization):** Normalize a message containing a `Uint8Array` / `Buffer` inside its raw message object; assert `rawPayloadJson` serializes cleanly via `BufferJSON.replacer` without throwing or losing binary type tags.
  2. **Execute Full Verification & Simulation Suite:**
     ~~~bash
     npm run typecheck
     npm run build
     npm test
     npm run simulate:live
     ~~~
  3. **Sync Documentation & Write Phase 6.2 Logs:**
     * Update `@whiskeysockets/baileys` version references from `6.7.22` to `7.0.0-rc14` in `docs/architecture.md`, `docs/project-plan.md`, `docs/BAILEYS_INTEGRATION_SPEC.md`, `docs/DECISIONS.md`, and `docs/operations-runbook.md` (preserving historical Phase 0–6.1 logs untouched).
     * Create `docs/logs/dev/2026-11-13_phase-06-2-baileys-v7-migration.md` and `docs/logs/test/2026-11-13_phase-06-2-baileys-v7-migration-test.md`.
     * Stage and commit only Phase 6.2 files (`feat(phase-06.2/baileys-v7): migrate WhatsApp adapter to Baileys 7.0.0-rc14 with LID support`).

---

## 4. Acceptance Checklist (Phase 6.2 Gate)

- [ ] `@whiskeysockets/baileys` pinned to exact `"7.0.0-rc14"` in `package.json` and `package-lock.json`.
- [ ] `npm run typecheck` and `npm run build` pass with zero errors.
- [ ] LID (`@lid`), device-suffixed JID, and `participantAlt` normalization and self-echo tests pass.
- [ ] `group-metadata.ts` matches bot participation and admin rights across both `@s.whatsapp.net` and `@lid` identities.
- [ ] `rawPayloadJson` uses `BufferJSON.replacer`.
- [ ] All existing unit, integration, and 11-fixture simulation tests pass (`npm test` & `npm run simulate:live`).
- [ ] `$env:WHATSAPP_ADAPTER_MODE="baileys"; npm run dev` starts cleanly on `7.0.0-rc14` and renders a fresh terminal QR code.
- [ ] Mandatory Phase 6.2 `dev` and `test` logs committed.

---

**End of Baileys v7.0.0-rc14 Migration Plan (`docs/phase-06-2-baileys-v7-migration-plan.md`).**
```

### Summary of My Recommendation

1. **Why You Should Do This Upgrade Now:**
   * **WhatsApp Communities use `@lid` (`V7-01` & `V7-04`):** Without v7's LID Signal session and `sock.user.lid` support, a bot inside a WhatsApp Community can fail to decrypt messages from `@lid` senders or fail group permission checks.
   * **Anti-Ban Safety (`V7-03`):** v7 disables automatic delivery ACKs so WhatsApp does not flag your new SIM card as an unofficial automated client.
   * **Zero Migration Pain Today (`V7-02`):** Because you haven't paired your production SIM card or onboarded faculties yet, you have zero legacy auth folders to migrate.
2. **Next Step:** Save `docs/phase-06-2-baileys-v7-migration-plan.md` and tell your agent to execute **Partitions A through D**. Once Partition D finishes, you can scan the QR code with your new WhatsApp number directly on `7.0.0-rc14`!