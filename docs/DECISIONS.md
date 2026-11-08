# SuaraPutra: Project Architectural Decisions Record (ADR)

**Project Name:** SuaraPutra — Smart Multilingual Broadcasting  
**Baseline Date:** 8 November 2026  
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
     * The backend extracts and preserves the raw image binary buffer locally.
     * The text caption is extracted and processed through the AI pipeline.
     * The dispatcher reconstructs outbound messages by pairing the **original image buffer** with the corresponding **translated caption** for each destination group.
  3. **Image Only (No Caption):**
     * Passthrough / direct forwarding. The backend forwards the original image binary directly to all configured destination groups without invoking the AI pipeline.

---

## 4. AI Pipeline & Model Selection

* **Primary Model:** **Gemini 3.8 Flash** (`gemini-3.8-flash`) unified across all processing stages.
* **SDK & Integration:** API-first approach using the official Google GenAI SDK (`@google/genai`).
* **Processing Stages:**
  * **Stage A (Classification):** Evaluates incoming message content + quoted/recent context to classify as `announcement`, `not_announcement`, or `uncertain`. Non-announcements are logged and dropped.
  * **Stage B (Fact Extraction):** Extracts structured canonical facts (event dates, times, venues, deadlines, contact details, URLs, instructions) into a validated schema.
  * **Stage C (Language Coverage & Translation):** Evaluates source language completeness across the 4 targets (`ms`, `en`, `zh-CN`, `ta`). Reuses complete source language sections without redundant translation; generates complete, natural translations for partial or missing languages based on canonical facts.
  * **Stage D (Factual Validation):** Deterministic programmatic validation of protected values (dates, times, numbers, URLs, proper names) comparing generated outputs against canonical facts before allowing dispatch.
* **Security & Prompt Safety Invariants:**
  * Message contents are untrusted data, never system instructions.
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

---

## 6. Persistence, Reliability & Error Handling

* **Database:** **SQLite** with Write-Ahead Logging (`WAL` mode), foreign keys enabled, and strict transaction wrappers.
* **Deduplication:**
  * Enforced unique constraint on `(chat_jid, message_id)` for inbound source messages.
  * Unique idempotency key per `(announcement_id, destination_group_jid)` on delivery jobs to guarantee zero duplicate broadcasts upon retry or process reboot.
* **Job Queue States:**
  * Explicit states: `pending` $\rightarrow$ `sending` $\rightarrow$ `sent`.
  * Failure & recovery states: `retry_wait`, `uncertain`, `failed_permanent`.
  * Unverified / timed-out outbound sends must be flagged `uncertain` and held for manual/automated reconciliation rather than blindly retried.
* **Crash Recovery:** Startup routine scans and reclaims orphaned `sending` jobs based on lease timeouts.

---

## 7. Hosting & Infrastructure (Zero-Budget Target)

* **Deployment Target:** **Oracle Cloud Free Tier (Always Free ARM Compute Instance)**.
  * **Resource Profile:** Ampere A1 Compute (up to 4 OCPUs, 24 GB RAM, 200 GB persistent block volume).
  * **Region:** Singapore (`ap-singapore-1`) for low network latency to Malaysian WhatsApp servers.
  * **Cost:** Permanent \$0 / month.
* **Architectural Rationale:**
  * Baileys requires an uninterrupted, stateful WebSocket connection to WhatsApp servers with persistent linked-device authentication files.
  * Serverless platforms (e.g., Google Cloud Run) scale to zero and enforce request timeouts, causing frequent disconnects and re-pairing failures.
  * An always-on Linux VM running Node.js managed under `systemd` or `pm2` provides continuous socket connectivity and local SQLite WAL access without infrastructure expense.

---

## 8. Documentation & Agent Workflow Strategy

* **`docs/DECISIONS.md` (This Document):** Captures the agreed high-level architecture decisions and project boundaries.
* **`docs/architecture.md` (Next Document):** The definitive technical Source of Truth detailing component interaction, internal contracts, TypeScript interfaces, database schema DDL, and error recovery policies.
* **Agent Execution Role:**
  * Autonomous agents (GPT 5.6 Luna, Developer, Tester, Web Developer) will consult `docs/architecture.md` as the authoritative technical reference.
  * Implementation phases will be detailed in an actionable, step-by-step Execution Plan with explicit verification checklists and logging requirements.

---

## 9. Project Timeline & Milestone Phasing

* **Week 1 (Core Broadcasting System):**
  1. Milestone 1: Project setup, SQLite database migrations, repositories, and domain contracts.
  2. Milestone 2: Mock WhatsApp adapter & ingestion pipeline with deduplication and loop detection.
  3. Milestone 3: Gemini 3.8 Flash AI pipeline (classification, fact extraction, multilingual translation, validation).
  4. Milestone 4: Database-backed persistent delivery queue, image/caption assembler, and dispatcher.
  5. Milestone 5: End-to-end integration testing with synthetic test suites.
  6. Milestone 6: Live Baileys integration swap (upon physical SIM arrival) and Oracle Cloud deployment.
* **Week 2 (Administrative Extension):**
  * Milestone 7: Web administrative monitoring dashboard (queue inspection, delivery audit logs, system health metrics).
