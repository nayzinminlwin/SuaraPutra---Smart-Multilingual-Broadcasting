# SuaraPutra: Phase 6.1 Remediation & 95% Live Simulation Plan

**Document Path:** `docs/phase-06-1-plan.md`  
**Parent Phase:** Phase 6 — End-to-End Composition Root, Full QA & Live Baileys Cutover  
**Audit Reference:** [`docs/audits/2026-11-11_phase-06-code-quality-audit.md`](./audits/2026-11-11_phase-06-code-quality-audit.md)  
**Authoritative Specifications:** [`docs/architecture.md`](./architecture.md), [`docs/project-plan.md`](./project-plan.md), [`docs/BAILEYS_INTEGRATION_SPEC.md`](./BAILEYS_INTEGRATION_SPEC.md)  
**Status:** Approved for Immediate Execution

---

## 1. Purpose & Execution Strategy

Instead of rolling back Phase 6, **Phase 6.1** remediates all 10 findings (`FINDING-01` through `FINDING-10`) identified in `docs/audits/2026-11-11_phase-06-code-quality-audit.md` and introduces a **File-Backed Baileys & Live Gemini Simulation Harness (`npm run simulate:live`)**.

This achieves **95% production execution** before the physical SIM card is inserted:
1. **Input (`simulation/inbox/`):** The developer places realistic message payloads in `simulation/inbox/messages.json` and sample `.jpg`/`.png` files in `simulation/inbox/images/`.
2. **Real Pipeline Execution:** The app masks those inputs as raw Baileys `messages.upsert` events, runs the exact `CP01`–`CP09` pipeline (strict timestamp FIFO queue, 5-gate filter, `data/media/` caching with eager RAM release, **live Gemini API calls** via `@google/genai`, URL validation, SQLite WAL persistence, single-read media cache, and rate-paced dispatch).
3. **Tangible File & Image Output (`simulation/outbox/`):** Every outbound group dispatch writes the translated message into per-group JSON files (`simulation/outbox/groups/{ms,en,zh-CN,ta}.json`) and copies/writes the actual forwarded binary image into per-group media folders (`simulation/outbox/media/{ms,en,zh-CN,ta}/`), plus a full audit summary (`simulation/outbox/simulation-report.json`).
4. **SIM Arrival Cutover (Remaining 5%):** When the redONE SIM arrives tomorrow morning, switching `WHATSAPP_ADAPTER_MODE=baileys` and scanning the QR code connects the already-verified pipeline directly to live WhatsApp.

---

## 2. Developer Guide: How to Structure `simulation/inbox/messages.json` & Images

### 2.1 Simulation Directory Layout

```text
simulation/
├── inbox/                                  # <-- DEVELOPER DROPS TEST INPUTS HERE
│   ├── messages.json                       # Batch of incoming messages to simulate
│   └── images/                             # Local folder containing sample images
│       ├── event-poster.jpg
│       └── academic-calendar.png
└── outbox/                                 # <-- APP WRITES REAL OUTPUTS HERE
    ├── broadcast-log.json                  # Chronological log of all 4-group broadcasts
    ├── simulation-report.json              # Full DB state (queued, ignored, held) + CP01-CP09 timings
    ├── groups/                             # Exact messages received by each destination group
    │   ├── ms.json                         # Malay Group (WHATSAPP_MALAY_GROUP_JID)
    │   ├── en.json                         # English Group (WHATSAPP_ENGLISH_GROUP_JID)
    │   ├── zh-CN.json                      # Mandarin Group (WHATSAPP_MANDARIN_GROUP_JID)
    │   └── ta.json                         # Tamil Group (WHATSAPP_TAMIL_GROUP_JID)
    └── media/                              # Forwarded binary images written per group
        ├── ms/
        ├── en/
        ├── zh-CN/
        └── ta/
```

---

### 2.2 How `messages.json` Works (Realistic Baileys `messages.upsert` Structure)

To ensure `src/whatsapp/event-normalizer.ts` (`CP01_INGEST_NORMALIZE`) is tested with **100% realistic Baileys payloads**, `simulation/inbox/messages.json` uses the exact Baileys `messages.upsert` stanza structure, with one convenience field (`_localImagePath`) inside `imageMessage` (or top-level `mediaFiles` map) that tells the simulator which file from `simulation/inbox/images/` to load as the decrypted image buffer.

> **Important Note on `remoteJid`:** If you set `"remoteJid": "$SOURCE_GROUP"` (or leave it matching your `.env` `WHATSAPP_SOURCE_GROUP_JID`), the simulator automatically substitutes `config.WHATSAPP_SOURCE_GROUP_JID` so Gate 1 always matches your `.env` configuration.

#### Complete Copy-Paste Template for `simulation/inbox/messages.json`

Below are the **5 realistic Baileys message patterns** you can mix and match inside `simulation/inbox/messages.json`:

```json
{
  "type": "notify",
  "messages": [
    {
      "_comment": "1. TEXT-ONLY ANNOUNCEMENT (Baileys conversation stanza)",
      "key": {
        "remoteJid": "$SOURCE_GROUP",
        "fromMe": false,
        "id": "SIM_MSG_001",
        "participant": "60123456789@s.whatsapp.net"
      },
      "pushName": "Dr. Ahmad (Academic Office)",
      "messageTimestamp": 1762860000,
      "message": {
        "conversation": "Good morning everyone. Please be informed that the Final Year Project (FYP) proposal submission deadline has been extended to 20 November 2026 at 5:00 PM. Submit your PDF via https://fyp.upm.edu.my/submit."
      }
    },
    {
      "_comment": "2. CODE-SWITCHED BILINGUAL TEXT + QUOTED REPLY (Baileys extendedTextMessage)",
      "key": {
        "remoteJid": "$SOURCE_GROUP",
        "fromMe": false,
        "id": "SIM_MSG_002",
        "participant": "60123456789@s.whatsapp.net"
      },
      "pushName": "Dr. Ahmad (Academic Office)",
      "messageTimestamp": 1762860060,
      "message": {
        "extendedTextMessage": {
          "text": "Perhatian semua pelajar: For students taking CSC4602 Machine Learning, kuliah esok (12 Nov, 10:00 AM) akan dijalankan secara online melalui Google Meet: https://meet.google.com/abc-defg-hij",
          "contextInfo": {
            "stanzaId": "SIM_MSG_001",
            "participant": "60123456789@s.whatsapp.net",
            "quotedMessage": {
              "conversation": "Good morning everyone. Please be informed that the Final Year Project (FYP) proposal submission deadline has been extended to 20 November 2026 at 5:00 PM."
            }
          }
        }
      }
    },
    {
      "_comment": "3. POLISHED MULTI-VERSION BILINGUAL POST (Should separate EN & MS verbatim, translate TA & ZH)",
      "key": {
        "remoteJid": "$SOURCE_GROUP",
        "fromMe": false,
        "id": "SIM_MSG_003",
        "participant": "60198765432@s.whatsapp.net"
      },
      "pushName": "Putra International Centre",
      "messageTimestamp": 1762860120,
      "message": {
        "conversation": "[INTERNATIONAL STUDENT VISA RENEWAL REMINDER]\nAll international students whose student pass expires in December 2026 must submit their renewal documents to the i-Putra counter by 18 November 2026.\nPortal: https://intl.upm.edu.my/visa\nThank you.\n- Putra International Centre (i-Putra)\n-----------------------------------------\n[PERINGATAN PEMBAHARUAN VISA PELAJAR ANTARABANGSA]\nSemua pelajar antarabangsa yang pas pelajarnya tamat pada bulan Disember 2026 hendaklah menghantar dokumen pembaharuan ke kaunter i-Putra sebelum 18 November 2026.\nPortal: https://intl.upm.edu.my/visa\nTerima kasih.\n- Pusat Antarabangsa Putra (i-Putra)"
      }
    },
    {
      "_comment": "4. IMAGE WITH CAPTION (Baileys imageMessage with caption -> AI translates caption + forwards image)",
      "key": {
        "remoteJid": "$SOURCE_GROUP",
        "fromMe": false,
        "id": "SIM_MSG_004",
        "participant": "60123456789@s.whatsapp.net"
      },
      "pushName": "FSKTM Secretariat",
      "messageTimestamp": 1762860180,
      "message": {
        "imageMessage": {
          "_localImagePath": "simulation/inbox/images/event-poster.jpg",
          "mimetype": "image/jpeg",
          "caption": "Join us for the AI & Robotics Symposium 2026 on 25 November 2026 (9:00 AM - 4:00 PM) at Dewan Besar UPM! Free lunch and e-certificates provided. Register now at https://symposium.upm.edu.my/register"
        }
      }
    },
    {
      "_comment": "5. IMAGE ONLY (Baileys imageMessage with NO caption -> Zero-AI direct binary forward)",
      "key": {
        "remoteJid": "$SOURCE_GROUP",
        "fromMe": false,
        "id": "SIM_MSG_005",
        "participant": "60123456789@s.whatsapp.net"
      },
      "pushName": "FSKTM Secretariat",
      "messageTimestamp": 1762860240,
      "message": {
        "imageMessage": {
          "_localImagePath": "simulation/inbox/images/academic-calendar.png",
          "mimetype": "image/png"
        }
      }
    },
    {
      "_comment": "6. CASUAL CHAT NOISE (Should score < 4.0 and be ignored with null translations)",
      "key": {
        "remoteJid": "$SOURCE_GROUP",
        "fromMe": false,
        "id": "SIM_MSG_006",
        "participant": "60112233445@s.whatsapp.net"
      },
      "pushName": "Student A",
      "messageTimestamp": 1762860300,
      "message": {
        "conversation": "Okay noted with thanks! See you guys tomorrow morning 👍"
      }
    }
  ]
}
```

#### How the Simulator Processes `_localImagePath`
When `scripts/run-live-simulation.ts` reads each message in `simulation/inbox/messages.json`:
1. If `message.imageMessage._localImagePath` is present, the simulator reads that file from disk into a `Buffer`, computes its exact `fileLength` and `fileSha256` (injecting them into `imageMessage` just like WhatsApp's servers do), and strips the helper `_localImagePath` property before passing the pure Baileys payload and `mediaBuffers` map into `MockWhatsAppAdapter.injectSyntheticUpsert()`.
2. This guarantees `event-normalizer.ts` receives a **100% authentic Baileys `messages.upsert` event**.

---

## 3. Partitioned Execution Plan (Phase 6.1)

Agents must execute Phase 6.1 sequentially across **Partitions A through E**. Do not advance to the next partition until the current partition's verification commands pass 100%.

---

### Partition A — Durable AI Failure & Ingestion State Persistence (`FINDING-03`, `FINDING-04`, `FINDING-05`)

* **Audit Findings Addressed:**
  * `FINDING-03` (Critical): `AiProcessor` attempts to update `announcements.status = 'held_validation_failed'` using an `announcementId` before the `announcements` row exists in SQLite, throwing `Announcement not found` and masking the real AI provider error.
  * `FINDING-04` (High): When `AiProcessor` returns `held_validation_failed`, `MessageIngestor` exits early without persisting the held `announcements` row or audit details.
  * `FINDING-05` (High): When a message scores `< 4.0` (`ignored`), `MessageIngestor` omits the primary source message (`role = 'primary'`) from `announcement_sources`, which can cause retention pruning to misclassify the source message.
* **Files in Scope:**
  * `src/ingestion/message-ingestor.ts`
  * `src/ai/ai-processor.ts`
  * `src/database/repositories/announcement.repo.ts`
  * `tests/unit/phase3-ingestion.test.ts`
  * `tests/unit/phase4-ai-and-validation.test.ts`
* **Implementation Tasks:**
  1. **Create `processing` Announcement Before Invoking AI (or Persist Atomically in `MessageIngestor`):**
     * In `src/ingestion/message-ingestor.ts`, for `TEXT` and `IMAGE_CAPTION` paths, atomically insert the initial `announcements` row (`status = 'processing'`, `classification = 'announcement'`, `evaluation_score = 0`, `primary_source_message_id = sourceMsg.id`, `source_timestamp_ms = msg.timestampMs`, `payload_type = msg.kind`) and link `announcement_sources` (`role = 'primary'` plus any `quoted` and `window_context` sources) **before** calling `aiProcessor.process()`.
  2. **Durable `held_validation_failed` Persistence (`FINDING-03` & `FINDING-04`):**
     * If `aiProcessor.process()` exhausts its retries on a provider error (`429`, `500`, `503`, timeout) or fails `TranslationValidator` after 1 regeneration retry:
       * Update the existing `announcements` row to `status = 'held_validation_failed'`, storing `raw_ai_response_json` (if any response was received) and `evaluation_score`.
       * If translations were returned but failed validation, persist the failed `translations` rows with `validation_status = 'failed'` and `validation_errors_json` for inspection.
       * Log a structured `ERROR` or `WARN` event in `event_logs` with the original provider/validation error message—never masking it with `Announcement not found`.
       * Create **zero** `delivery_jobs` and cleanly resolve the FIFO step so the next message in the queue proceeds.
  3. **Complete Source Association on `ignored` Announcements (`FINDING-05`):**
     * When `score < 4.0` (`ignored`), update the `announcements` row to `classification = 'not_announcement'`, `evaluation_score = result.score`, `status = 'ignored'`, `raw_ai_response_json = result.rawJson`, and ensure `announcement_sources` contains the primary source message (`role = 'primary'`) alongside any context sources.
* **Verification Gate (Partition A):**
  * Run `npm run typecheck && npm test -- tests/unit/phase3-ingestion.test.ts tests/unit/phase4-ai-and-validation.test.ts`.
  * Verify that simulated AI provider failure (`503`), simulated URL validation failure, and `score < 4.0` ignored messages all persist durable `announcements` and `announcement_sources` (`role = 'primary'`) rows in SQLite without throwing `Announcement not found`.

---

### Partition B — Unified `CP01`–`CP09` Telemetry Trace & Timestamp-Sorted FIFO Queue (`FINDING-02`, `FINDING-06`)

* **Audit Findings Addressed:**
  * `FINDING-02` (High): `CP01` creates a separate throwaway tracer in `event-normalizer.ts`, `CP02` only prints a console line without recording in `PipelineTracer`, and `CP03` starts a new tracer in `message-ingestor.ts`, causing `TOTAL_PIPELINE_US` and `[JOURNEY_SUMMARY]` to omit `CP01` and `CP02`.
  * `FINDING-06` (High): `MessageIngestor` chains incoming messages strictly in callback arrival order rather than ordering queued messages across batches by `(timestamp_ms ASC, ingestion_seq ASC)`.
* **Files in Scope:**
  * `src/observability/telemetry.ts`
  * `src/whatsapp/adapter.ts`
  * `src/whatsapp/event-normalizer.ts`
  * `src/ingestion/message-ingestor.ts`
  * `tests/unit/phase2-whatsapp-mock.test.ts`
  * `tests/unit/phase3-ingestion.test.ts`
* **Implementation Tasks:**
  1. **Unify `PipelineTracer` Across `CP01`–`CP09` (`FINDING-02`):**
     * Allow `NormalizedInboundMessage` (or an optional `tracer?: PipelineTracer` property on `NormalizedInboundMessage`) to carry the `PipelineTracer` instance created at the start of `normalizeBaileysEvent()` in `src/whatsapp/event-normalizer.ts`.
     * Record `CP01_INGEST_NORMALIZE` on that tracer.
     * When `MessageIngestor.handleMessage(msg)` receives `msg`, reuse `msg.tracer` (or create one if called directly in isolated unit tests and backfill `CP01` as `0 us` only when normalizer was bypassed).
     * Start `CP02_FIFO_WAIT` on `tracer` when the message enters the FIFO queue and end `CP02_FIFO_WAIT` when the FIFO worker begins processing the message, so `CP02_FIFO_WAIT` is stored inside `tracer.getCheckpoints()`.
     * Ensure `CP03_GATE_CHECKS` wraps all 5 gates **including** the `source_messages` insert (`sourceMessageRepo.create`) before ending `CP03_GATE_CHECKS`.
     * Verify `TOTAL_PIPELINE_US` sums `CP01` through `CP09` and prints all 9 checkpoints in `[JOURNEY_SUMMARY]`.
  2. **Timestamp-Sorted Pending FIFO Queue (`FINDING-06`):**
     * Replace the raw Promise chain in `src/ingestion/message-ingestor.ts` with a pending queue array (`pendingQueue: Array<{ msg: NormalizedInboundMessage; arrivalSeq: number; resolve: () => void; reject: (err: unknown) => void }>`).
     * While the single active worker (`isProcessing = true`) is busy processing Message 1, any new messages pushed into `pendingQueue` are sorted before the next dequeue by:
       $$\text{sortOrder}: \quad \texttt{a.msg.timestampMs - b.msg.timestampMs} \;\;\text{or}\;\; \texttt{a.arrivalSeq - b.arrivalSeq}$$
     * This guarantees that if two separate event batches arrive while the worker is busy, messages waiting in the queue are always processed in strict `(timestampMs ASC, arrivalSeq ASC)` chronological order.
* **Verification Gate (Partition B):**
  * Run `npm run typecheck && npm test -- tests/unit/phase2-whatsapp-mock.test.ts tests/unit/phase3-ingestion.test.ts`.
  * Verify that an end-to-end trace contains `CP01_INGEST_NORMALIZE` and `CP02_FIFO_WAIT` inside `getCheckpoints()`, and that out-of-order arrivals queued while a slow message is in-flight execute in `timestampMs ASC` order.

---

### Partition C — Composition Root Startup, Dynamic Bot JID, Graceful Shutdown, Retention & Baileys Error Boundary (`FINDING-01`, `FINDING-07`, `FINDING-08`, `FINDING-09`, `FINDING-10`)

* **Audit Findings Addressed:**
  * `FINDING-01` (Critical): Windows `import.meta.url` comparison in `src/app.ts` uses an invalid `file://` slash format, preventing `npm start` from calling `main()`.
  * `FINDING-07` (High): Graceful shutdown disconnects the adapter immediately without awaiting an active in-flight dispatch.
  * `FINDING-08` (Medium/High): `HealthMonitor.runRetention()` is never scheduled in `src/app.ts`.
  * `FINDING-09` (High): `BaileysWhatsAppAdapter.handleUpsert()` is invoked with `void` and no `.catch()` boundary, risking unhandled promise rejections.
  * `FINDING-10` (Medium): `adapter.getBotJid()` is read before `adapter.connect()`, passing a stale `null` into `MessageIngestor`.
* **Files in Scope:**
  * `src/app.ts`
  * `src/delivery/dispatcher.ts`
  * `src/ingestion/message-ingestor.ts`
  * `src/observability/health.ts`
  * `src/whatsapp/baileys-client.ts`
* **Implementation Tasks:**
  1. **Platform-Safe CLI Entry Check (`FINDING-01`):**
     * In `src/app.ts`, use `import { pathToFileURL } from 'node:url'; import path from 'node:path';` and check:
       ```typescript
       const isDirectRun = process.argv[1]
         ? import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
         : false;
       ```
  2. **Dynamic Bot JID Resolution (`FINDING-10`):**
     * Allow `MessageIngestor` to accept `botJidProvider: string | null | (() => string | null)` (supporting both a static string for existing unit tests and `() => adapter.getBotJid()` in `src/app.ts`).
     * Inside Gate 2, resolve the current bot JID dynamically on every message check so live Baileys sessions always use the authenticated JID after `connection === 'open'`.
  3. **Graceful In-Flight Dispatch Draining (`FINDING-07`):**
     * In `src/delivery/dispatcher.ts` (and `src/app.ts`), track any currently executing `dispatchNext()` Promise (`activeDispatchPromise: Promise<unknown> | null`) and a `stopping` flag.
     * When `shutdown()` is invoked in `src/app.ts`:
       1. Set `stopping = true` and clear the dispatcher polling interval so no new job leases are claimed.
       2. Await `activeDispatchPromise` (bounded by `config.DELIVERY_SEND_TIMEOUT_MS`).
       3. Stop `DeliveryRecoveryScheduler` and the retention scheduler timer.
       4. Call `await adapter.disconnect()`.
       5. Run `db.pragma('wal_checkpoint(TRUNCATE)')` and close the SQLite connection.
  4. **Scheduled Data Retention (`FINDING-08`):**
     * In `src/app.ts`, run `healthMonitor.runRetention()` once on startup (wrapped in `try/catch` logging `DATA_RETENTION_COMPLETED` or `DATA_RETENTION_FAILED`) and schedule a periodic timer (default every 24 hours, `.unref()`ed and cleared on `shutdown()`).
  5. **Baileys Upsert Error Boundary (`FINDING-09`):**
     * In `src/whatsapp/baileys-client.ts`, wrap the `messages.upsert` listener (`this.handleUpsert(upsert)`) in a `.catch((err) => ...)` boundary (and per-message `try/catch` inside `handleUpsert`) that logs a structured `ERROR` entry via `logger.error` (and optional error callback) without crashing the process or dropping subsequent messages in the batch.
* **Verification Gate (Partition C):**
  * Run `npm run typecheck && npm run build && npm test`.
  * Add focused unit/integration assertions verifying:
    * Dynamic `getBotJid()` resolution blocks self-echoes after `connect()`.
    * `app.stop()` waits for an in-flight `sendMessage` Promise to settle before calling `adapter.disconnect()`.
    * `runRetention()` executes on startup and cleans up on `stop()`.
    * A throwing media download / handler inside `BaileysWhatsAppAdapter` is caught and logged without an unhandled rejection.

---

### Partition D — File-Backed Outbox & 95% Live Gemini Simulation Runner (`npm run simulate:live`)

* **Objective:** Enable the developer to run the full application pipeline against realistic JSON messages and images in `simulation/inbox/` using the **real Gemini API** (`AI_PROVIDER=gemini`) and inspect the translated group JSON files and forwarded image binaries in `simulation/outbox/`.
* **Files in Scope:**
  * `src/whatsapp/mock-adapter.ts`
  * `scripts/run-live-simulation.ts` (New)
  * `simulation/inbox/messages.json` (New sample batch)
  * `simulation/inbox/images/event-poster.jpg` & `simulation/inbox/images/academic-calendar.png` (Copied from `tests/fixtures/media/`)
  * `package.json` (Add `"simulate:live": "tsx scripts/run-live-simulation.ts"`)
  * `.gitignore` (Ignore `simulation/outbox/` runtime outputs while keeping `simulation/inbox/` tracked)
* **Implementation Tasks:**
  1. **File-Backed Outbox Support in `MockWhatsAppAdapter` (`src/whatsapp/mock-adapter.ts`):**
     * Add an optional `fileOutboxDir?: string` and `groupJidToLanguageMap?: Record<string, string>` option to `MockWhatsAppAdapter`.
     * Whenever `sendMessage(targetGroupJid, payload)` succeeds in `NORMAL` mode and `fileOutboxDir` is configured:
       * Determine the target language code (`ms`, `en`, `zh-CN`, `ta`) from `targetGroupJid`.
       * If `payload.type === 'IMAGE'`, write `payload.imageBuffer` to `path.join(fileOutboxDir, 'media', lang, `${seq}_${outgoingMessageId}.${ext}`)`.
       * Append the delivered message entry (`outgoingMessageId`, `acknowledgedAtIso`, `targetGroupJid`, `language`, `payloadType`, `text` or `caption`, `savedMediaPath`) to:
         * `path.join(fileOutboxDir, 'groups', `${lang}.json`)`
         * `path.join(fileOutboxDir, 'broadcast-log.json')`
  2. **Live Simulation CLI Runner (`scripts/run-live-simulation.ts`):**
     * Loads `.env` via `dotenv/config`.
     * Reads `simulation/inbox/messages.json` (or a custom path passed via `--inbox=...`).
     * Replaces `"$SOURCE_GROUP"` in `key.remoteJid` with `config.WHATSAPP_SOURCE_GROUP_JID`.
     * For any message containing `message.imageMessage._localImagePath`, reads the binary file from disk, computes its SHA-256 and byte length, registers the `Buffer` in `mediaBuffers[key.id]`, and removes `_localImagePath` so the stanza is pure Baileys JSON.
     * Boots the real `createApp()` composition root from `src/app.ts` using an isolated simulation SQLite database (`simulation/outbox/simulation.sqlite`) and `MockWhatsAppAdapter` configured with `fileOutboxDir: 'simulation/outbox'`.
     * Injects the upsert batch, waits until the FIFO ingestion queue and `delivery_jobs` queue drain completely (all jobs in terminal states), and writes `simulation/outbox/simulation-report.json` containing:
       * Total messages ingested, announcements queued, ignored (`score < 4.0`), and held (`held_validation_failed`).
       * All generated translations (`ms`, `en`, `zh-CN`, `ta`) and evaluation scores (`1.0–10.0`).
       * Per-message `CP01`–`CP09` microsecond ($\mu\text{s}$) telemetry breakdown.
     * Calls `await app.stop()` cleanly.
  3. **Seed Realistic Sample Inputs (`simulation/inbox/`):**
     * Create `simulation/inbox/messages.json` with the 6 realistic messages from Section 2.2 of this plan (`TEXT`, code-switched `extendedTextMessage` with quote, separated bilingual post, `IMAGE_CAPTION`, `IMAGE_ONLY`, and casual chat noise).
     * Copy `tests/fixtures/media/poster.jpg` $\rightarrow$ `simulation/inbox/images/event-poster.jpg` and `tests/fixtures/media/infographic.png` $\rightarrow$ `simulation/inbox/images/academic-calendar.png`.
* **Verification Gate (Partition D):**
  * Run `npm run simulate:live` (works with `AI_PROVIDER=gemini` when `AI_API_KEY` is set in `.env`, or `AI_PROVIDER=mock` in CI).
  * Verify that `simulation/outbox/groups/ms.json`, `en.json`, `zh-CN.json`, `ta.json`, `simulation/outbox/media/{ms,en,zh-CN,ta}/*`, and `simulation/outbox/simulation-report.json` are generated cleanly on disk.

---

### Partition E — Negative-Path E2E Regression Suite, Documentation Logs & Final Commit Gate

* **Objective:** Close all test-evidence gaps listed in Section 4 of `docs/audits/2026-11-11_phase-06-code-quality-audit.md`, update the Phase 6/6.1 documentation logs, and prepare the repository for final commit.
* **Files in Scope:**
  * `tests/integration/e2e-pipeline.test.ts`
  * `docs/logs/dev/2026-11-11_phase-06-1-remediation-and-live-sim.md`
  * `docs/logs/fixes/2026-11-11_phase-06-1-audit-remediation.md`
  * `docs/logs/test/2026-11-11_phase-06-1-remediation-and-live-sim-test.md`
  * `docs/audits/2026-11-11_phase-06-code-quality-audit.md` (Mark findings `FINDING-01` through `FINDING-10` as Resolved)
* **Implementation Tasks:**
  1. **Expand `tests/integration/e2e-pipeline.test.ts` with Negative & Lifecycle E2E Tests:**
     * **E2E-02 (AI Provider Failure Durability):** Inject a message where the AI provider fails all 3 attempts (`503`); assert the original error is logged, the announcement is saved in SQLite as `held_validation_failed` with its primary `announcement_sources` row, zero delivery jobs are created, and subsequent FIFO messages still process normally.
     * **E2E-03 (Held Validation Failure Durability):** Inject a message where AI mutates a source URL on both attempts; assert `announcements.status = 'held_validation_failed'` and failed `translations` rows are durably persisted.
     * **E2E-04 (Cross-Batch Timestamp FIFO Reordering):** While Message 1 (`timestamp = 1000`) is actively running AI, inject two separate upsert batches out of timestamp order (`Batch A: timestamp = 3000`, `Batch B: timestamp = 2000`); assert `Batch B (2000)` is processed and queued before `Batch A (3000)`.
     * **E2E-05 (Unified `CP01`–`CP09` Journey Summary):** Assert that the completed `PipelineTracer` for an end-to-end announcement contains all 9 checkpoints (`CP01_INGEST_NORMALIZE` through `CP09_DISPATCH_ta`) and `totalPipelineUs > 0`.
     * **E2E-06 (Graceful Shutdown During In-Flight Send):** Trigger `app.stop()` while `adapter.sendMessage()` is mid-flight ($200\text{ ms}$ simulated latency); assert `app.stop()` awaits the in-flight send completion before disconnecting the adapter.
  2. **Execute Full Verification Suite:**
     ```bash
     npm run typecheck
     npm run build
     npm test
     npm run simulate:live
     git status --porcelain
     ```
  3. **Generate Mandatory Logs:**
     * Write `docs/logs/dev/2026-11-11_phase-06-1-remediation-and-live-sim.md`, `docs/logs/fixes/2026-11-11_phase-06-1-audit-remediation.md`, and `docs/logs/test/2026-11-11_phase-06-1-remediation-and-live-sim-test.md`.

---

## 4. Summary Remediation Matrix (`FINDING-01` to `FINDING-10`)

| Finding ID | Severity | Partition | Summary of Fix | Verification Test |
| :--- | :--- | :--- | :--- | :--- |
| **FINDING-01** | Critical | Partition C | Use `pathToFileURL(path.resolve(process.argv[1])).href` in `src/app.ts` | Startup entry test & `npm run simulate:live` |
| **FINDING-02** | High | Partition B | Propagate single `PipelineTracer` from `CP01` (`event-normalizer.ts`) through `CP02` (`message-ingestor.ts`) to `CP09` (`dispatcher.ts`) | `E2E-05` (`CP01`–`CP09` unified trace check) |
| **FINDING-03** | Critical | Partition A | Create `processing` announcement row before AI call so failure handler never throws `Announcement not found` | `E2E-02` (AI `503` failure persistence test) |
| **FINDING-04** | High | Partition A | Persist `held_validation_failed` announcement and failed translations in SQLite when validation fails | `E2E-03` (Mutated URL hold persistence test) |
| **FINDING-05** | High | Partition A | Always link primary source (`role = 'primary'`) in `announcement_sources` for `ignored` (`score < 4.0`) rows | `phase3-ingestion.test.ts` & `E2E-01` |
| **FINDING-06** | High | Partition B | Replace arrival-order Promise chain with pending queue sorted by `(timestampMs ASC, arrivalSeq ASC)` | `E2E-04` (Out-of-order batch FIFO test) |
| **FINDING-07** | High | Partition C | Track active dispatch Promise and await completion (up to send timeout) before disconnecting in `app.stop()` | `E2E-06` (Graceful shutdown during active send) |
| **FINDING-08** | Medium/High | Partition C | Schedule `HealthMonitor.runRetention()` on startup and daily interval in `src/app.ts`, cleaned up on shutdown | `e2e-pipeline.test.ts` retention lifecycle check |
| **FINDING-09** | High | Partition C | Wrap `handleUpsert()` in `baileys-client.ts` with `.catch()` and per-message `try/catch` error logging | `baileys-client` error boundary unit test |
| **FINDING-10** | Medium | Partition C | Pass dynamic `() => adapter.getBotJid()` resolver to `MessageIngestor` so Gate 2 reads Bot JID after connect | Dynamic Bot JID self-echo test |

---

**End of Phase 6.1 Remediation & 95% Live Simulation Plan (`docs/phase-06-1-plan.md`).**