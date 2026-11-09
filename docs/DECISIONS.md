# SuaraPutra: Project Architectural Decisions Record (ADR)

**Project Name:** SuaraPutra — Smart Multilingual Broadcasting  
**Baseline Date:** 9 November 2026  
**Status:** Approved & Binding Baseline  
**Target Execution Agents:** GPT 5.6 Luna / Autonomous Developer & QA Agents  

---

## 1. Project Identity & Scope Boundaries

* **Project Name:** SuaraPutra (*"SuaraPutra - Smart Multilingual Broadcasting"*).
* **Core Objective:** Monitor a single configured WhatsApp source group inside an existing WhatsApp Community, identify announcements using an LLM, synthesize accurate announcements across 4 configured languages, and broadcast each language version to its dedicated Community destination group.
* **Release Scope (v1 - Current):**
  * **In Scope:** Text announcements, image-only messages, and image + caption messages. Complete TypeScript backend, SQLite persistence, robust database-backed queue with retries and deduplication, mock-capable WhatsApp adapter.
  * **Out of Scope (v1):** Image OCR, web-based administrative dashboard, non-text media translation (audio, video, documents, stickers), multi-source group aggregation, manual broadcast approval workflows.

---

## 2. WhatsApp Transport & SIM Delay Strategy (Mock-First)

* **Context:** Delivery of the dedicated redONE SIM card is delayed. Live WhatsApp pairing via Baileys is postponed until the physical SIM arrives.
* **Decoupling Pattern:** The WhatsApp transport layer is strictly abstracted behind an adapter interface (`IWhatsAppAdapter`). Core ingestion, AI pipelines, database persistence, and queue dispatchers must not import Baileys directly.
* **Mock Implementation:**
  * Development and testing will use a `MockWhatsAppAdapter` driven by synthetic payloads adhering to [`docs/BAILEYS_INTEGRATION_SPEC.md`](./BAILEYS_INTEGRATION_SPEC.md).
  * Synthetic fixtures will simulate `messages.upsert` events for plain text (`conversation`), formatted text (`extendedTextMessage`), image without caption (`imageMessage`), image with caption (`imageMessage` + text), quoted context, and bot echo prevention (`key.fromMe = true`).
  * When the physical SIM arrives, the production `BaileysWhatsAppAdapter` will be plugged in without requiring modifications to core domain logic.

---

## 3. Media & Message Handling Rules (Zero OCR Policy)

* **No OCR:** Image text recognition (OCR) is explicitly excluded from scope. Images are treated purely as binary payloads.
* **Ingestion & Dispatch Logic by Type:**
  1. **Plain / Extended Text:** Passed through the full AI translation and validation pipeline; dispatched as text messages to target groups.
  2. **Image + Caption:**
     * The backend extracts and preserves the raw image binary buffer locally (then immediately frees it from RAM after disk write).
     * The text caption is extracted and processed through the AI pipeline.
     * The dispatcher reconstructs outbound messages by pairing the **original image buffer** with the corresponding **translated caption** for each destination group.
  3. **Image Only (No Caption):**
     * Passthrough / direct forwarding. The backend forwards the original image binary directly to all configured destination groups **without invoking the AI pipeline** (zero AI calls).

---

## 4. AI Pipeline & Model Selection

* **Primary Model:** **Gemini 3.8 Flash** (`gemini-3.8-flash`) unified across all processing stages.
* **SDK & Integration:** API-first approach using the official Google GenAI SDK (`@google/genai`), calling `ai.models.generateContent` with `temperature: 0.1`, `responseMimeType: 'application/json'`, and a constrained `responseJsonSchema`.
* **Unified Single-Call Processing:** All AI work is offloaded to a **single Gemini 3.8 Flash call** per message, which simultaneously evaluates worthiness and produces all 4 language translations. There are no separate classification or fact-extraction stages.
* **Processing Logic by Message Type:**
  * **`TEXT-MESSAGE`:** The model evaluates the message on a `1.0–10.0` worthiness scale (`score`).
    * If `score < 4.0`: The model returns `null` for all 4 language fields. The message is recorded as `not_announcement` and ignored — no delivery jobs are created.
    * If `score >= 4.0`: The model returns all 4 language translations (`English`, `Malay`, `Tamil`, `Mandarin`) in the same JSON response.
  * **`TEXT CAPTION FROM IMAGE`:** Worthiness evaluation is skipped. The model always sets `score = 10.0` and translates the caption directly into all 4 languages.
* **Nullable JSON Output Schema:** The model is constrained to a single `TranslationResponseSchema` (Zod-validated) where `score` is ordered first to allow fast-exit on low-scoring text messages without producing translation fields.
* **Content-Aware Bilingual & Multilingual Handling:**
  * **Code-Switched / Blended Posts** (e.g., *"Hari ini, we will open registration..."*): The blended text is processed as a unified whole and translated naturally into all 4 target languages.
  * **Polished Multi-Version Separated Posts** (e.g., complete English + divider + complete Malay): Existing language versions are **separated and placed verbatim** into their respective fields without re-translating; only the missing target languages (`Tamil` and `Mandarin`) are generated.
* **Security & Prompt Safety Invariants:**
  * Message contents are wrapped in `<untrusted_whatsapp_content>` tags and treated strictly as passive, untrusted data — never system instructions.
  * Model output must **never** determine destination group JIDs, alter routing rules, or modify system settings.

---

## 5. Target Languages & Group Routing

* **Source:** Exactly one configured source group JID (filtered at ingestion).
* **Target Destinations (4 Languages):**
  * **Malay (`ms`):** Natural Malaysian Malay; formal/community announcement tone.
  * **English (`en`):** Clear, natural English; official terms and names preserved.
  * **Mandarin (`zh-CN`):** Simplified Chinese; standardized community terminology.
  * **Tamil (`ta`):** Natural, readable written Tamil for Malaysian community notices.
* **Routing Configuration:** Static mapping stored in application environment configuration (`WHATSAPP_DESTINATION_JIDS`). AI models have zero authority over routing tables.
* **Dispatch Language Order:** `1=ms`, `2=en`, `3=zh-CN`, `4=ta` — applied consistently across delivery job `language_order` and FIFO poll ordering.

---

## 6. Persistence, Reliability & Error Handling

* **Database:** **SQLite** with Write-Ahead Logging (`WAL` mode), foreign keys enabled, and strict transaction wrappers (`better-sqlite3` synchronous ACID transactions).
* **Deduplication:**
  * Enforced unique constraint on `(chat_jid, message_id)` for inbound source messages.
  * Unique `idempotency_key` per `(announcement_id, language_code, target_group_jid)` on delivery jobs to guarantee zero duplicate broadcasts upon retry or process reboot.
* **Job Queue States:**
  * Normal flow: `pending` → `sending` → `sent`.
  * Failure & recovery states: `retry_wait`, `uncertain`, `failed_permanent`, `cancelled`.
  * Unverified / timed-out outbound sends must be flagged `uncertain` and held for manual/automated reconciliation rather than blindly retried. **`uncertain` jobs are never auto-retried.**
* **Crash Recovery:** Startup routine (and periodic $60\text{s}$ sweep) scans and reclaims orphaned `sending` jobs with expired leases, transitioning them to `uncertain`.
* **Deterministic Output Validation:** Before queuing any delivery jobs, a TypeScript `TranslationValidator` checks that all 4 language outputs are non-empty strings ($\le 4096$ chars) and that every URL present in the source text is preserved verbatim across all 4 outputs. On validation failure, the AI processor retries once; if the second attempt also fails, the announcement is saved as `held_validation_failed` with no delivery jobs created.

---

## 7. Hosting & Infrastructure (Google Cloud Compute Engine)

* **Deployment Target:** **Google Cloud Compute Engine `e2-micro`** (instance name: `suaraputra-server`, project: `suaraputra`).
  * **Resource Profile:** `x86_64` architecture, 2 visible vCPUs (0.25 vCPU sustained baseline, 2.0 vCPU burst), `1 GB` physical RAM, `30 GB` Standard Persistent Disk (`pd-standard`).
  * **Operating System & Runtime:** Ubuntu 24.04.5 LTS (`x86_64`), Node.js 22.23.4 LTS, SQLite 3.45.1, `better-sqlite3` `13.0.3`, `@whiskeysockets/baileys` `6.7.22`.
  * **Cost:** Permanent \$0 / month (Google Cloud Free Tier Always Free `e2-micro`).
* **Resource Guardrails (Critical for 1 GB RAM):**
  * **2 GB Swap File (`/swapfile`)** with `vm.swappiness=10` to absorb transient memory spikes.
  * **V8 Heap Limit:** `NODE_OPTIONS=--max-old-space-size=512` and `MemoryMax=800M` enforced in `deploy/suaraputra.service`.
  * **Strict Sequential FIFO Ingestion (`MAX_CONCURRENT_INGESTIONS = 1`)** and eager `Buffer` release after disk write to minimize peak RAM usage.
* **Architectural Rationale:**
  * Baileys requires an uninterrupted, stateful WebSocket connection to WhatsApp servers with persistent linked-device authentication files.
  * Serverless platforms (e.g., Google Cloud Run) scale to zero and enforce request timeouts, causing frequent disconnects and re-pairing failures.
  * An always-on Linux VM running Node.js managed under `systemd` provides continuous socket connectivity and local SQLite WAL access on a permanent free-tier instance.

---

## 8. Documentation & Agent Workflow Strategy

* **`docs/DECISIONS.md` (This Document):** Captures the agreed high-level architecture decisions and project boundaries.
* **`docs/architecture.md` (Authoritative Source of Truth):** The definitive technical Source of Truth detailing component interaction, internal contracts, TypeScript interfaces, database schema DDL, and error recovery policies. In any conflict, `docs/architecture.md` takes absolute precedence.
* **Agent Execution Role:**
  * Autonomous agents (GPT 5.6 Luna, Developer, Tester, Web Developer) will consult `docs/architecture.md` as the authoritative technical reference.
  * Implementation phases will be detailed in an actionable, step-by-step Execution Plan with explicit verification checklists and logging requirements.

---

## 9. Project Timeline & Milestone Phasing

* **Week 1 (Core Broadcasting System):**
  1. Milestone 1: Project setup, SQLite database migrations, repositories, and domain contracts.
  2. Milestone 2: Mock WhatsApp adapter & ingestion pipeline with deduplication and loop detection.
  3. Milestone 3: Gemini 3.8 Flash AI pipeline — single unified call scoring (`1.0–10.0`) + 4-language translation/separation, Nullable JSON schema, and deterministic `TranslationValidator`.
  4. Milestone 4: Database-backed persistent FIFO delivery queue, image/caption assembler, dispatcher with single-read media cache, and exponential backoff retry policy.
  5. Milestone 5: End-to-end integration testing with synthetic test suites.
  6. Milestone 6: Live Baileys integration swap (upon physical SIM arrival) and Google Cloud Compute Engine `e2-micro` deployment.
* **Week 2 (Administrative Extension):**
  * Milestone 7: Web administrative monitoring dashboard (queue inspection, delivery audit logs, system health metrics).
