# Baileys v7.0.0-rc14 Upgrade Findings

**Date:** 2026-11-13  
**Status:** Findings only; no runtime upgrade performed  
**Baseline:** `@whiskeysockets/baileys` `6.7.22`  
**Target:** `@whiskeysockets/baileys` `7.0.0-rc14`

## 1. Executive finding

The upgrade is feasible, but it is not a dependency-only change. The project
already satisfies the ESM and Node.js prerequisites (`"type": "module"`,
Node.js `>=22`, and `NodeNext`), so the primary compatibility work is in the
WhatsApp adapter's identity handling, dependency behavior, and live transport
validation.

There is currently no running deployment, production WhatsApp session, or
operational data to migrate. The upgrade can therefore be validated from a
clean installation and a fresh pairing when live testing is authorized.

## 2. Findings

| ID | Severity | Finding | Consequence |
|---|---|---|---|
| V7-01 | High | v7 uses Linked Identity JIDs (LIDs) by default for new Signal sessions and may migrate existing sessions. | `participant`, bot identity, and group participant IDs may be `@lid`; phone-number JID assumptions can reject valid messages or fail self-echo and permission checks. |
| V7-02 | Low | v7 auth state includes LID-related keys, including `lid-mapping`, `device-list`, and `tctoken`. | No current auth state exists to migrate. Validate fresh auth-state creation and pairing when live testing begins. |
| V7-03 | High | Successful message ACKs are no longer sent by Baileys v7. | Existing `sendMessage()` resolution remains the adapter's transport result, not a WhatsApp delivery ACK. The current internal `acknowledgedAtIso` name and delivery evidence must be reviewed so the queue does not claim stronger delivery guarantees than the provider supplies. |
| V7-04 | Medium | `MessageKey` and `GroupMetadata` expose alternate PN/LID fields (`participantAlt`, `remoteJidAlt`, `ownerPn`, and related fields). | The normalizer currently persists only `participant`; group metadata currently compares one normalized string. The adapter should select and persist the preferred identifier while retaining alternate identity only where required for matching/audit. |
| V7-05 | Medium | v7 is ESM-only and exports `makeWASocket` as both a named and default export. | No architectural change is required: this repository is already ESM. The current named import should be compile-tested against the target package; avoid CommonJS interop workarounds. |
| V7-06 | Medium | The v7 package changes its dependency graph, including `whatsapp-rust-bridge`, `p-queue`, newer `music-metadata`, and npm-hosted `libsignal`. | `package-lock.json`, install-script allowlisting, native/WASM install behavior, and runtime memory/CPU on the `e2-micro` must be revalidated. The current `allowScripts` entry is version-specific and may need an explicit v7 entry. |
| V7-07 | Medium | The v7 migration guide removes most protobuf helpers and requires `BufferJSON` for protobuf serialization. | This project does not directly construct protobufs, but raw payload persistence uses `JSON.stringify(raw)`. Verify that the normalized payload path does not become a future protobuf serialization boundary; do not treat ordinary JSON as a safe serialization format for Baileys proto objects. |
| V7-08 | Medium | The current QR/open/reconnect behavior was recently fixed specifically for 6.7.22. | Re-test `connection.update`, QR refresh, `open` gating, `loggedOut` handling, `client_too_old`, and reconnect backoff. The dynamic WhatsApp Web version lookup must be verified against v7 rather than assumed compatible. |
| V7-09 | Low | The target is a release candidate, not a final v7 release. | Pin exactly to `7.0.0-rc14`; do not use a caret range. Record the release-candidate status and define a follow-up upgrade gate for the final v7 release. |

## 3. Repository impact map

### Required code review/change candidates

- `src/whatsapp/baileys-client.ts`
  - Compile and adapt imports/types against v7.
  - Validate `getBotJid()` and self-echo comparison for LID, PN, and
    device-suffixed JIDs.
  - Review `downloadMediaMessage()` and `socket.updateMediaMessage` typing and
    expired-media re-upload behavior.
  - Preserve the current QR rendering, `open` gate, bounded reconnect, and
    explicit `loggedOut` halt.
  - Treat a resolved `sendMessage()` as provider request success, not an ACK.
- `src/whatsapp/event-normalizer.ts`
  - Use the preferred participant identity and test `participantAlt`.
  - Confirm wrapper unwrapping, captions, timestamps, and `rawPayloadJson`
    with v7-shaped fixtures.
- `src/whatsapp/group-metadata.ts`
  - Test participant matching against both the bot's current identity and
    alternate PN/LID identity. Preserve full group JIDs as routing IDs.
- `src/whatsapp/adapter.ts`, delivery repositories, and delivery tests
  - Review the `acknowledgedAtIso` terminology and evidence contract. This is
    an application-contract decision, not a reason to add ACK emulation.
- `package.json` and `package-lock.json`
  - Pin the target version, regenerate the lockfile, review transitive
    dependencies and scripts, and update the explicit install-script policy.

### Documentation requiring synchronization

- `docs/project-plan.md` and `docs/architecture.md` currently state
  `6.7.22`; update those references only after the upgrade is approved and
  verified.
- `docs/BAILEYS_INTEGRATION_SPEC.md` should describe LID-aware participant
  handling and the v7 send-result limitation.
- `docs/DECISIONS.md` and the operations runbook should record the fresh
  pairing and release-candidate operational procedure.
- The existing [Phase 6 QR compatibility log](../logs/dev/2026-11-13_phase-06-baileys-qr-compatibility.md)
  remains valid as historical evidence for the 6.7.22 fix; it should not be
  rewritten to imply that v7 has been validated.

## 4. Data and operational consequences

1. **Fresh auth state is required for live validation.** No existing auth
   state or operational data needs migration. When live testing is authorized,
   create the configured auth directory outside Git and validate fresh
   pairing, reconnect, and message decryption.
2. **Identity is no longer phone-number-only.** Routing still uses configured
   group JIDs ending in `@g.us`; message sender and bot identity comparisons
   must accept LIDs. Do not convert LIDs back to phone numbers as a routing
   requirement.
3. **Delivery evidence is weaker than ACK semantics.** Existing uncertain
   timeout handling remains necessary. A resolved `sendMessage()` should be
   documented as an adapter/provider request result, while database state must
   continue to prevent blind retries after an uncertain timeout.
4. **Resource behavior may change.** The new Rust bridge/libsignal path and
   dependency graph require a clean install and a memory/CPU observation on
   the production-sized VM before live cutover.

## 5. Required upgrade sequence

1. Create a dependency-only branch/change and pin
   `@whiskeysockets/baileys` to `7.0.0-rc14`.
2. Regenerate the lockfile and inspect dependency, install-script, and
   license/provenance changes.
3. Run typecheck/build and the full unit/integration suite.
4. Add focused tests for LID participants, alternate participants, bot
   identity matching, v7-shaped group metadata, media re-upload, and the
   no-ACK send-result contract.
5. Run the existing 11-fixture simulation and Baileys error-boundary tests.
6. Run a fresh live test with a new auth directory: QR refresh, pairing,
   `open` transition, source filtering, media download, one destination send,
   reconnect, and logged-out halt.
7. Record resource usage and database delivery outcomes on the `e2-micro`
   equivalent.
8. Only after all gates pass, update canonical version references and perform
   the controlled production cutover.

## 6. Acceptance gates

- [ ] Exact target version is installed and recorded in `package-lock.json`.
- [ ] `npm run typecheck`, `npm run build`, and `npm test` pass.
- [ ] All 11 synthetic fixtures pass without changing provider-independent
      normalized DTO contracts unexpectedly.
- [ ] LID/PN identity and group participant matching tests pass.
- [ ] Fresh auth-state creation and pairing are exercised when live testing is
      authorized.
- [ ] QR, connection-open gate, reconnect, logged-out halt, media download,
      and send timeout behavior pass on v7.
- [ ] Delivery documentation does not claim successful ACKs that v7 no longer
      emits.
- [ ] Live Community/group permission smoke test passes before publishing is
      enabled.

## 7. Evidence and references

Repository evidence:

- [Baileys adapter](../../src/whatsapp/baileys-client.ts)
- [Event normalizer](../../src/whatsapp/event-normalizer.ts)
- [Group metadata adapter](../../src/whatsapp/group-metadata.ts)
- [Package manifest](../../package.json)
- [Phase 6 QR compatibility log](../logs/dev/2026-11-13_phase-06-baileys-qr-compatibility.md)
- [Baileys integration specification](../../BAILEYS_INTEGRATION_SPEC.md)

Upstream references checked on 2026-11-13:

- [Baileys v7 migration guide](https://github.com/WhiskeySockets/docs/blob/main/migration/v7.mdx)
- [v7.0.0-rc14 release](https://github.com/WhiskeySockets/Baileys/releases/tag/v7.0.0-rc14)
- [Scoped npm package metadata](https://registry.npmjs.org/@whiskeysockets%2fbaileys/7.0.0-rc14)

