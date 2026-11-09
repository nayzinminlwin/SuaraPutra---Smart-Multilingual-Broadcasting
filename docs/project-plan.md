# SuaraPutra: Master Phased Execution Plan

**Project Name:** SuaraPutra — Smart Multilingual Broadcasting  
**Document Path:** `docs/project-plan.md`  
**Version:** 1.0.0 (Binding Execution Playbook)  
**Baseline Date:** 8 November 2026  
**Authoritative References:**  
* Technical Source of Truth: [`docs/architecture.md`](./architecture.md)  
* Architectural Decisions Record: [`docs/DECISIONS.md`](./DECISIONS.md)  
* WhatsApp Transport Contract: [`docs/BAILEYS_INTEGRATION_SPEC.md`](./BAILEYS_INTEGRATION_SPEC.md)  
* Agent Definitions: `.github/agents/developer.agent.md`, `.github/agents/tester.agent.md`  
* Mandatory Skills: `.github/skills/documentation-workflow/SKILL.md`, `.github/skills/git-scope-and-commits/SKILL.md`, and all domain skill files in `.github/skills/*/SKILL.md`

---

## 1. Purpose & Scope Boundaries

### 1.1 Purpose of This Plan
This document partitions the implementation of **SuaraPutra** into **8 sequential, atomic, and verifiable phases (Phase 0 through Phase 7)**. It is designed to be executed step-by-step by autonomous coding and QA agents (`developer.agent.md` and `tester.agent.md`) under the supervision of the Lead Developer.

### 1.2 Strict v1 Scope Boundary (No Web Admin Panel)
* **In Scope:** Core backend broadcasting engine (Node.js + TypeScript), SQLite WAL persistence, Mock & Live Baileys WhatsApp adapters, 3-path media/message routing (`TEXT`, `IMAGE_CAPTION`, `IMAGE_ONLY` Zero-OCR passthrough), 4-stage Gemini 3.8 Flash AI & deterministic validation pipeline (`ms`, `en`, `zh-CN`, `ta`), persistent delivery queue with crash recovery, active debug tracing, microsecond ($\mu\text{s}$) telemetry checkpoints, and Oracle Cloud Free Tier server deployment.
* **Out of Scope:** The Web Administrative Dashboard (`src/web/` and `.github/agents/web_developer.agent.md`) is **strictly excluded** from the current execution scope. Agents must not scaffold or implement web UI/dashboard code during Phases 0–7.

---

## 2. Un-Negotiable Governance Rules (Mandatory for Every Phase)

Every agent executing any task in this plan **must** obey the following three un-negotiable rules. Violation of any rule invalidates the phase.

### 2.1 Rule 1: Un-Negotiable Documentation Workflow
Before concluding any phase, bug fix, or test cycle, the executing agent **must** read `.github/skills/documentation-workflow/SKILL.md` and generate/update the corresponding log files using the exact repository templates in `docs/templates/`:

1. **Development Log (`docs/templates/dev_log_template.md`):**
   * **Who:** `developer.agent.md`
   * **When:** Mandatory upon completing the implementation of every phase.
   * **Output Path:** `docs/logs/dev/YYYY-MM-DD_phase-0X-<phase-slug>.md`
   * **Required Content:** Phase objectives completed, exact files created/modified, architectural invariants respected, active debug & $\mu\text{s}$ telemetry checkpoints wired, and local verification output.
2. **Test Log (`docs/templates/test_log_template.md`):**
   * **Who:** `tester.agent.md` (or the agent executing phase validation tests).
   * **When:** Mandatory after running the unit/integration verification suite for every phase.
   * **Output Path:** `docs/logs/test/YYYY-MM-DD_phase-0X-<phase-slug>-test.md`
   * **Required Content:** Test suite executed, pass/fail breakdown, recorded microsecond ($\mu\text{s}$) checkpoint durations, edge-case coverage, and sign-off status.
3. **Fix Log (`docs/templates/fix_log_template.md`):**
   * **Who:** `developer.agent.md`
   * **When:** Mandatory whenever **any** defect, runtime error, schema mismatch, or test failure is encountered and resolved during a phase.
   * **Output Path:** `docs/logs/fixes/YYYY-MM-DD_phase-0X-fix-<short-issue-slug>.md`
   * **Required Content:** Symptom/error trace, root cause analysis, exact files/lines modified to fix the issue, and proof of regression test passing.

> **Hard Gate:** A phase is **not complete** until its documentation logs (`dev_log`, `test_log`, and any applicable `fix_log`) are written and verified against `docs/templates/`.

---

### 2.2 Rule 2: Un-Negotiable Git Scope & Commit Convention
Every agent **must** read and strictly enforce `.github/skills/git-scope-and-commits/SKILL.md`:

1. **Pre-Work & Pre-Commit Status Audit:**
   * Run `git status --porcelain` before starting a phase and again immediately before staging files.
2. **Strict File Isolation (Zero Collateral Changes):**
   * Stage **only** the specific source, test, and documentation log files belonging to the current phase using explicit file paths:
     ~~~bash
     git add <explicit-file-path-1> <explicit-file-path-2> ...
     ~~~
   * **FORBIDDEN COMMANDS:** Agents must **never** run `git add .`, `git add -A`, `git add --all`, `git commit -a`, `git clean`, `git checkout -- .`, `git restore .`, or `git reset --hard`.
   * **FORBIDDEN ACTIONS:** Never delete, revert, format, or commit any file or code update that is unrelated to the agent's current phase task. If untracked or modified files from the developer exist in the working tree, leave them completely untouched.
3. **Phase Commit Message Convention:**
   * Unless overridden by a more specific rule inside `.github/skills/git-scope-and-commits/SKILL.md`, every phase commit must follow this structure:
     ~~~text
     <type>(phase-0X/<scope>): <imperative summary under 72 chars>

     - Delivered: <bullet list of key modules implemented>
     - Telemetry: <checkpoints instrumented in this phase>
     - Verification: <test command and pass count>
     - Docs: docs/logs/dev/YYYY-MM-DD_phase-0X-..., docs/logs/test/YYYY-MM-DD_phase-0X-...
     ~~~
   * Allowed `<type>` values: `chore` (Phase 0), `feat` (Phases 1–7), `fix` (bug fixes), `test` (QA additions), `docs` (documentation-only).

---

### 2.3 Rule 3: Phase Gate Validation & Developer Override Protocol
1. **Strict Sequential Gating:** Phase $N+1$ must **never** start until Phase $N$'s Deliverables Checklist and Developer Success Analysis pass 100%.
2. **Explicit Developer Override / Postponement Exception:**
   * If a hardware/external dependency (such as live Oracle Cloud VM SSH connectivity in Phase 0 or physical redONE SIM pairing in Phase 7) is temporarily unavailable, the agent **must halt and ask the developer**.
   * Only when the developer explicitly instructs to skip or postpone a specific check (e.g., *"Postpone Oracle Server live validation; I will verify it myself later; proceed to Phase 1"*), the agent shall record `[POSTPONED_BY_DEVELOPER]` in the phase's `dev_log` and proceed to the next phase.

---

## 3. Active Debug Printing & Microsecond ($\mu\text{s}$) Telemetry Architecture

To make the entire codebase effortlessly traceable when anything breaks—and to provide granular performance visibility for future optimization—every phase must instrument **Active Debug Printing** and **Duration Checkpoints**.

### 3.1 Definition of End-to-End Start & End Timestamps
For every processed message, the system tracks two complementary timelines inside a per-message `PipelineTraceContext` (`traceId`):

1. **End-to-End Journey Timeline (Start $\rightarrow$ End):**
   * **START (`t_wa_source_sent_ms`):** The WhatsApp metadata timestamp when the original message was sent in the source group (`WAMessage.messageTimestamp * 1000`).
   * **LOCAL RECEIVE (`t_local_ingest_ms`):** Local wall-clock timestamp (`Date.now()`) when the message event enters `IWhatsAppAdapter`.
     * *Network/Transit Delta:* $\Delta_{\text{transit}} = \text{t\_local\_ingest\_ms} - \text{t\_wa\_source\_sent\_ms}$.
   * **END (`t_wa_translated_sent_ms`):** The timestamp of the translated message being sent / the exact final moment the payload is forwarded to and acknowledged by Baileys (`sendMessage` completion wall-clock `Date.now()` and outbound metadata timestamp).
   * **Total E2E Duration (`total_e2e_duration_ms`):**
     $$\text{total\_e2e\_duration\_ms} = \text{t\_wa\_translated\_sent\_ms} - \text{t\_wa\_source\_sent\_ms}$$

2. **High-Resolution Monotonic Microsecond ($\mu\text{s}$) Checkpoints:**
   * Because WhatsApp's `messageTimestamp` has 1-second resolution and may have slight clock skew relative to the local server, all internal stages are measured using Node.js high-resolution monotonic nanoseconds (`process.hrtime.bigint()`) converted to microseconds ($\mu\text{s}$):
     $$\text{duration\_us} = \left\lfloor \frac{\text{hrtime}_{\text{after}} - \text{hrtime}_{\text{before}}}{1000} \right\rfloor \text{ }\mu\text{s}$$
   * If a specific sub-step cannot be isolated (e.g., an internal SDK network wait vs. token generation), measure the overall stage duration and log sub-steps as `N/A (measured in parent stage)`.

### 3.2 Mandatory Microsecond ($\mu\text{s}$) Checkpoints Table

| Checkpoint ID | Stage / Process Name | Measured Scope | Unit |
| :--- | :--- | :--- | :--- |
| `CP01_INGEST_NORMALIZE` | **Message Ingestion & Normalization** | Raw Baileys `messages.upsert` event $\rightarrow$ `NormalizedInboundMessage` + binary media extraction | $\mu\text{s}$ |
| `CP02_GATE_CHECKS` | **5-Gate Scope, Loop & Dedup Check** | Source JID check + `fromMe` loop check + Kind check + SQLite `(chat_jid, message_id)` dedup + `data/media/` write | $\mu\text{s}$ |
| `CP03_CONTEXT_ASSEMBLY` | **Context Assembly** | Quoted message SQLite/payload lookup + sliding time-window query | $\mu\text{s}$ |
| `CP04_AI_CLASSIFY` | **Translation: Stage A Classification** | Prompt construction + `gemini-3.8-flash` call + Zod `ClassificationResultSchema` validation | $\mu\text{s}$ |
| `CP05_AI_FACT_EXTRACT` | **Translation: Stage B Fact Extraction** | Prompt construction + `gemini-3.8-flash` call + Zod `CanonicalAnnouncementSchema` validation + conflict check | $\mu\text{s}$ |
| `CP06_AI_TRANSLATE` | **Translation: Stage C Actual Translation** | Coverage analysis + hybrid 4-language synthesis (`ms`, `en`, `zh-CN`, `ta`) + Zod parse *(0 $\mu\text{s}$ if `IMAGE_ONLY`)* | $\mu\text{s}$ |
| `CP07_VALIDATION` | **Translation: Stage D Validation** | Deterministic verification of URLs, dates, numbers, phone digits, emails, and glossary invariants | $\mu\text{s}$ |
| `CP08_QUEUE_PERSIST` | **Persistent Queue Job Creation** | Atomic SQLite transaction writing `announcements`, `translations`, and 4 `delivery_jobs` | $\mu\text{s}$ |
| `CP09_MSG_RECONSTRUCT` | **Message Reconstruction (Per Target)** | Reading cached binary image buffer from `data/media/` + pairing with translated caption (or text formatting) | $\mu\text{s}$ |
| `CP10_DISPATCH_<LANG>` | **Outbound Baileys Dispatch (Per Target)** | `adapter.sendMessage()` execution for `ms`, `en`, `zh-CN`, and `ta` | $\mu\text{s}$ |
| `TOTAL_PIPELINE_US` | **Total Internal Pipeline Execution** | Sum of all active processing checkpoints from ingestion to final dispatch handoff | $\mu\text{s}$ & $\text{ms}$ |
| `TOTAL_E2E_WALL_MS` | **Total Start-to-End Journey Time** | `t_wa_translated_sent_ms` $-$ `t_wa_source_sent_ms` (from source WhatsApp metadata time to final dispatch) | $\text{ms}$ & $\mu\text{s}$ |

### 3.3 Active Debug Printing Format
When `LOG_LEVEL=debug` (the default during development and testing), every stage must emit structured, human-readable trace banners so any failure is immediately localizable:

~~~text
[TRACE:a8f3-91c2] ▶ [CP01_INGEST_NORMALIZE] START | msgId=BAE592A1 | chat=120363029@g.us | waSent=2026-11-08T07:15:00.000Z
[TRACE:a8f3-91c2] ✔ [CP01_INGEST_NORMALIZE] DONE (92 μs) | kind=IMAGE_CAPTION | textLen=184 | mediaBytes=148290
[TRACE:a8f3-91c2] ✔ [CP02_GATE_CHECKS] DONE (340 μs) | gates=5/5 PASSED | sha256=9f8e...2a1b | saved=data/media/BAE592A1.jpg
[TRACE:a8f3-91c2] ✔ [CP03_CONTEXT_ASSEMBLY] DONE (215 μs) | quoted=NONE | windowMsgs=1
[TRACE:a8f3-91c2] ✔ [CP04_AI_CLASSIFY] DONE (412,840 μs / 412.84 ms) | decision=announcement | conf=0.96 | cat=event
[TRACE:a8f3-91c2] ✔ [CP05_AI_FACT_EXTRACT] DONE (538,110 μs / 538.11 ms) | facts=5 (critical=4) | conflicts=0
[TRACE:a8f3-91c2] ✔ [CP06_AI_TRANSLATE] DONE (894,220 μs / 894.22 ms) | ms=consolidated, en=consolidated, zh-CN=translated, ta=translated
[TRACE:a8f3-91c2] ✔ [CP07_VALIDATION] DONE (145 μs) | status=PASSED | checkedUrls=1 | checkedDates=2
[TRACE:a8f3-91c2] ✔ [CP08_QUEUE_PERSIST] DONE (680 μs) | announcementId=ann_01J... | jobsCreated=4
[TRACE:a8f3-91c2] ✔ [CP09_MSG_RECONSTRUCT:ms] DONE (118 μs) | payload=IMAGE+CAPTION | bufferBytes=148290
[TRACE:a8f3-91c2] ✔ [CP10_DISPATCH_ms] DONE (48,310 μs) | outMsgId=mock-out-01 | target=ms_group@g.us
...
[TRACE:a8f3-91c2] 🏁 [JOURNEY_SUMMARY] waSourceSent=1762586100000 | finalDispatch=1762586106420 | E2E_Wall=6,420 ms (6,420,000 μs) | ActivePipeline=1,984,760 μs (1,984.76 ms)
~~~

If any step throws an error, the catch block **must** print:
~~~text
[TRACE:a8f3-91c2] ✖ [CP05_AI_FACT_EXTRACT] FAILED after 310,400 μs | errorCode=SCHEMA_VALIDATION_ERROR | details={...} | inputSnapshot={...}
~~~

---

## 4. Partitioned Executable Phases

---

### PHASE 0: Project Initialization, Toolchain, Telemetry Core & Oracle Server Setup

**Assigned Agents:** `developer.agent.md` (Setup & Scripts), `tester.agent.md` (Environment Verification)  
**Relevant Skills:** `project-context`, `typescript-node`, `backend-architecture`, `documentation-workflow`, `git-scope-and-commits`

#### 0.1 Objective
Initialize the Node.js + TypeScript repository, install all required production and development dependencies, establish the directory structure defined in `docs/architecture.md`, implement the Zod environment validator (`src/config/env.ts`), build the Active Debug Logger and Microsecond ($\mu\text{s}$) `PipelineTracer` (`src/observability/`), and prepare/configure the Oracle Cloud Free Tier ARM64 server environment.

#### 0.2 Implementation Tasks
1. **Project & Package Initialization:**
   * Create `package.json` with Node.js $\ge 22.0.0$ engine constraint and scripts: `build`, `start`, `dev`, `test`, `test:watch`, `lint`, `typecheck`.
   * Install production dependencies:
     * `@whiskeysockets/baileys` (pinned tested version)
     * `@google/genai` (official Google GenAI SDK for `gemini-3.8-flash`)
     * `better-sqlite3` (SQLite synchronous WAL driver)
     * `zod` (runtime schema validation)
     * `pino` & `pino-pretty` (structured & active debug logging)
     * `dotenv` (environment variable loading)
   * Install development dependencies:
     * `typescript`, `@types/node`, `@types/better-sqlite3`, `tsx`, `vitest`.
2. **TypeScript & Git Ignore Configuration:**
   * Create `tsconfig.json` with `"strict": true`, `"target": "ES2022"`, `"module": "NodeNext"`, `"moduleResolution": "NodeNext"`.
   * Configure `.gitignore` to strictly exclude `node_modules/`, `dist/`, `.env`, `data/`, `private/`, and `*.sqlite*`.
   * Create `.env.example` matching Section 8.1 of `docs/architecture.md` (excluding any web admin variables from active requirement).
3. **Environment & Static Config Modules (`src/config/`):**
   * Implement `src/config/env.ts` (`EnvConfigSchema` with Zod validation and startup debug dump of non-secret config values).
   * Implement `src/config/groups.ts` (static mapping of `WHATSAPP_SOURCE_GROUP_JID` and destination JIDs for `ms`, `en`, `zh-CN`, `ta`).
   * Implement `src/config/languages.ts` (target language metadata and style conventions).
4. **Active Debug Logger & Microsecond ($\mu\text{s}$) Telemetry Engine (`src/observability/`):**
   * Implement `src/observability/logger.ts` with secret redaction (`AI_API_KEY`, auth tokens) and verbose debug formatting.
   * Implement `src/observability/telemetry.ts` (`PipelineTracer` class):
     * Accepts `traceId`, `messageId`, and `waSourceSentTimestampMs`.
     * Provides `startCheckpoint(name)` / `endCheckpoint(name, metadata)` using `process.hrtime.bigint()` to record exact $\mu\text{s}$ (`durationUs`).
     * Provides `finalizeJourney(finalDispatchTimestampMs)` to compute both `total_pipeline_us` and `total_e2e_wall_ms` (`finalDispatchTimestampMs - waSourceSentTimestampMs`) and print the `[JOURNEY_SUMMARY]` banner.
5. **Oracle Cloud Server Setup & Provisioning (`scripts/` & `deploy/`):**
   * Create `scripts/setup-oracle-server.sh` (idempotent Ubuntu 24.04 ARM64 provisioning script: installs `build-essential`, `python3`, `sqlite3`, Node.js 22 LTS, creates `/opt/suaraputra`, `data/media`, `private/whatsapp-auth` with `chmod 700`, and configures `ufw` firewall).
   * Create `deploy/suaraputra.service` (`systemd` unit file with `Restart=on-failure`, `RestartSec=5s`, graceful `SIGTERM` handling).
   * Create `scripts/verify-environment.ts` (diagnostic CLI that checks Node version, native `better-sqlite3` C++ binding compilation, filesystem permissions on `data/` and `private/`, and microsecond timer accuracy).
   * Execute Oracle Cloud server setup if SSH credentials/host are provided by the developer, or pause for the developer's explicit validation/postponement decision.

#### 0.3 Phase 0 Deliverables Checklist
- [ ] `package.json`, `package-lock.json`, `tsconfig.json`, `.gitignore`, and `.env.example` created and valid.
- [ ] All packages installed cleanly (`npm ls` reports zero missing dependencies; `better-sqlite3` native binary compiles and loads).
- [ ] Directory skeleton (`src/`, `tests/`, `docs/logs/dev/`, `docs/logs/test/`, `docs/logs/fixes/`, `scripts/`, `deploy/`) initialized.
- [ ] `src/config/env.ts`, `src/config/groups.ts`, and `src/config/languages.ts` implemented with Zod validation.
- [ ] `src/observability/logger.ts` and `src/observability/telemetry.ts` implemented with $\mu\text{s}$ (`process.hrtime.bigint()`) checkpoint tracking and E2E journey calculation.
- [ ] `scripts/setup-oracle-server.sh`, `deploy/suaraputra.service`, and `scripts/verify-environment.ts` created.
- [ ] Unit tests in `tests/unit/phase0-init.test.ts` pass (`npm test`).
- [ ] **Un-negotiable Docs:** `docs/logs/dev/YYYY-MM-DD_phase-00-initialization.md` and `docs/logs/test/YYYY-MM-DD_phase-00-initialization-test.md` created from `docs/templates/`.
- [ ] **Un-negotiable Git Commit:** Only Phase 0 files staged and committed following `.github/skills/git-scope-and-commits/SKILL.md`.

#### 0.4 Developer Success Analysis & Gate Validation (Phase 0)
To verify whether Phase 0 is a complete success before advancing:
1. Run `npx tsx scripts/verify-environment.ts` and `npm test`.
2. Inspect console output: confirm that the sample `PipelineTracer` run prints `[CP01_...]` checkpoints in microseconds ($\mu\text{s}$) and `[JOURNEY_SUMMARY]` with start-to-end timestamps.
3. Verify Oracle Server readiness (or issue an explicit instruction: *"Postpone live Oracle Server validation; proceed to Phase 1"*).

---

### PHASE 1: SQLite WAL Database Engine, Migrations & Typed Repositories

**Assigned Agents:** `developer.agent.md`, `tester.agent.md`  
**Relevant Skills:** `database-management`, `typescript-node`, `testing-and-qa`, `documentation-workflow`, `git-scope-and-commits`

#### 1.1 Objective
Implement the SQLite persistence layer using `better-sqlite3` in `WAL` mode, execute the 9-table DDL schema migration from Section 6.2 of `docs/architecture.md`, and build all 6 typed repositories with active debug query logging and microsecond execution timing.

#### 1.2 Implementation Tasks
1. **Database Connection Client (`src/database/client.ts`):**
   * Initialize `better-sqlite3` connection.
   * Enforce `PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA temp_store = MEMORY;`.
   * Instrument a debug wrapper that logs SQL statement execution time in $\mu\text{s}$ when `LOG_LEVEL=debug`.
2. **Migration Runner & Initial Schema (`src/database/migrator.ts`, `src/database/migrations/001_initial_schema.sql`):**
   * Create `001_initial_schema.sql` with all 9 tables (`group_config`, `source_messages`, `announcements`, `announcement_sources`, `translations`, `delivery_jobs`, `glossary_terms`, `prompt_versions`, `event_logs`) and all indexes/constraints from `docs/architecture.md`.
   * Implement idempotent migration tracking (`_migrations` table) with transaction rollback on error.
3. **Typed Repositories (`src/database/repositories/`):**
   * `source-message.repo.ts`: Insert message, check `(chat_jid, message_id)` existence, query sliding window by `(chat_jid, timestamp_ms)`, lookup quoted message.
   * `announcement.repo.ts`: Create announcement, link `announcement_sources`, update status (`processing`, `ignored`, `held_*`, `queued`, `completed`).
   * `translation.repo.ts`: Upsert/fetch translations per `(announcement_id, language_code)`.
   * `delivery-job.repo.ts`: Atomic 4-job creation transaction, atomic lease acquisition (`pending`/`retry_wait` $\rightarrow$ `sending`), mark `sent`, `retry_wait`, `uncertain`, `failed_permanent`, and reclaim expired `sending` leases.
   * `glossary.repo.ts`: CRUD and active glossary lookup for `ms`, `en`, `zh-CN`, `ta`.
   * `event-log.repo.ts`: Persist structured audit logs and telemetry JSON payloads.

#### 1.3 Phase 1 Deliverables Checklist
- [ ] `src/database/client.ts` and `src/database/migrator.ts` implemented.
- [ ] `src/database/migrations/001_initial_schema.sql` matches `docs/architecture.md` 100%.
- [ ] All 6 repositories implemented with strict TypeScript types and zero raw SQL leaked outside `src/database/`.
- [ ] Unit tests in `tests/unit/phase1-database.test.ts` verify:
  - WAL mode pragma is active.
  - Duplicate `(chat_jid, message_id)` insert is rejected/detected deterministically.
  - Duplicate `(announcement_id, target_group_jid)` or `idempotency_key` on `delivery_jobs` is rejected.
  - Atomic transaction rolls back all tables if any single insert fails.
- [ ] **Un-negotiable Docs:** `docs/logs/dev/YYYY-MM-DD_phase-01-database.md` and `docs/logs/test/YYYY-MM-DD_phase-01-database-test.md` (plus `fix_log` if any test failed during development) created.
- [ ] **Un-negotiable Git Commit:** Only Phase 1 files staged and committed.

#### 1.4 Developer Success Analysis & Gate Validation (Phase 1)
1. Run `npm test -- tests/unit/phase1-database.test.ts`.
2. Inspect debug output to verify every repository operation logs its $\mu\text{s}$ duration and parameters clearly.
3. Confirm all constraints (`CHECK`, `UNIQUE`, `FOREIGN KEY`) enforce data integrity.

---

### PHASE 2: WhatsApp Transport Abstraction, `MockWhatsAppAdapter` & Synthetic Fixture Suite

**Assigned Agents:** `developer.agent.md`, `tester.agent.md`  
**Relevant Skills:** `whatsapp-baileys`, `backend-architecture`, `testing-and-qa`, `documentation-workflow`, `git-scope-and-commits`

#### 2.1 Objective
Implement the decoupled `IWhatsAppAdapter` interface, build the Baileys `WAMessage` event normalizer (`src/whatsapp/event-normalizer.ts`) strictly adhering to `docs/BAILEYS_INTEGRATION_SPEC.md`, implement `MockWhatsAppAdapter` with fault-injection capabilities, and create the 11 synthetic Baileys test fixtures.

#### 2.2 Implementation Tasks
1. **Transport Contract (`src/whatsapp/adapter.ts`):**
   * Define `IWhatsAppAdapter`, `NormalizedInboundMessage`, `OutboundMessagePayload`, `SendMessageResult`, `SupportedMessageKind`, and `GroupMetadataSummary` as specified in Section 3.1 of `docs/architecture.md`.
2. **Baileys Event Normalizer (`src/whatsapp/event-normalizer.ts`):**
   * Instrument `CP01_INGEST_NORMALIZE` ($\mu\text{s}$) checkpoint around normalization.
   * Extract `WAMessage.messageTimestamp` (converted to ms) as the **Start Timestamp (`t_wa_source_sent_ms`)** of the telemetry trace.
   * Normalize `conversation`, `extendedTextMessage`, and `imageMessage` (distinguishing `IMAGE_CAPTION` vs. `IMAGE_ONLY`).
   * Extract `contextInfo` (`stanzaId`, `participant`, `quotedMessage` text/caption).
   * Unwrap `ephemeralMessage` / `documentWithCaptionMessage` while ignoring `viewOnceMessage*` and marking video/audio/sticker/poll/reaction as `UNSUPPORTED`.
3. **Mock WhatsApp Adapter (`src/whatsapp/mock-adapter.ts`):**
   * Implement `injectSyntheticUpsert(rawPayload, mediaBuffers)` to feed synthetic Baileys events into registered `onMessage` handlers.
   * Implement `sendMessage(targetGroupJid, payload)` with inspectable outbox recording, outbound timestamp metadata generation (`t_wa_translated_sent_ms`), and configurable fault injection (`NORMAL`, `TRANSIENT_ERROR`, `AMBIGUOUS_TIMEOUT`, `PERMANENT_ERROR`).
4. **Synthetic Fixture Suite (`tests/fixtures/baileys-events/` & `tests/fixtures/media/`):**
   * Create all 11 JSON fixtures defined in Section 10.1 of `docs/architecture.md` plus sample valid JPEG/PNG binary buffers in `tests/fixtures/media/`.

#### 2.3 Phase 2 Deliverables Checklist
- [ ] `src/whatsapp/adapter.ts`, `src/whatsapp/event-normalizer.ts`, and `src/whatsapp/mock-adapter.ts` implemented.
- [ ] All 11 synthetic JSON fixtures and sample binary images created in `tests/fixtures/`.
- [ ] Unit tests in `tests/unit/phase2-whatsapp-mock.test.ts` verify:
  - Plain text, extended text with quote, image with caption, and image without caption normalize accurately.
  - `CP01_INGEST_NORMALIZE` prints duration in $\mu\text{s}$ and captures `t_wa_source_sent_ms`.
  - `MockWhatsAppAdapter` fault modes (`TRANSIENT_ERROR`, `AMBIGUOUS_TIMEOUT`, `PERMANENT_ERROR`) trigger expected typed errors.
- [ ] **Un-negotiable Docs:** `docs/logs/dev/YYYY-MM-DD_phase-02-whatsapp-mock.md` and `docs/logs/test/YYYY-MM-DD_phase-02-whatsapp-mock-test.md` created.
- [ ] **Un-negotiable Git Commit:** Only Phase 2 files staged and committed.

#### 2.4 Developer Success Analysis & Gate Validation (Phase 2)
1. Run `npm test -- tests/unit/phase2-whatsapp-mock.test.ts`.
2. Verify that zero files outside `src/whatsapp/` import `@whiskeysockets/baileys`.
3. Inspect the `CP01_INGEST_NORMALIZE` debug logs for each of the 11 fixtures (target normalization time: $< 500\text{ }\mu\text{s}$).

---

### PHASE 3: Ingestion Pipeline, 5-Gate Filter, 3-Path Media Store & Context Assembler

**Assigned Agents:** `developer.agent.md`, `tester.agent.md`  
**Relevant Skills:** `backend-architecture`, `database-management`, `whatsapp-baileys`, `testing-and-qa`, `documentation-workflow`, `git-scope-and-commits`

#### 3.1 Objective
Implement the 5-Gate Ingestion Filter (`src/ingestion/message-ingestor.ts`), SHA-256 deduplicator (`src/ingestion/deduplicator.ts`), local image binary store (`src/ingestion/media-store.ts`), bounded Context Assembler (`src/ingestion/context-assembler.ts`), and the 3-Path router (`TEXT`, `IMAGE_CAPTION`, and `IMAGE_ONLY` Zero-OCR passthrough).

#### 3.2 Implementation Tasks
1. **Local Media Store (`src/ingestion/media-store.ts`):**
   * Save inbound image buffers atomically to `data/media/${messageId}.${ext}`, verify non-zero byte length, compute SHA-256 hex digest, and provide fast binary buffer loading for outbound reconstruction.
2. **Deduplicator (`src/ingestion/deduplicator.ts`):**
   * Check primary `(chat_jid, message_id)` uniqueness in SQLite and compute deterministic SHA-256 `content_hash`.
3. **5-Gate Message Ingestor (`src/ingestion/message-ingestor.ts`):**
   * Instrument `CP02_GATE_CHECKS` ($\mu\text{s}$) with per-gate sub-timings printed in debug mode:
     * Gate 1: Source Group JID match (`chatJid === WHATSAPP_SOURCE_GROUP_JID`).
     * Gate 2: Self-Echo / Loop prevention (`fromMe === false` and `senderJid !== botJid`).
     * Gate 3: Supported Message Kind (`TEXT`, `IMAGE_CAPTION`, `IMAGE_ONLY`).
     * Gate 4: Primary SQLite deduplication (`(chat_jid, message_id)`).
     * Gate 5: Media integrity & local caching to `data/media/`.
   * Persist accepted `source_messages` row in SQLite.
   * Route `IMAGE_ONLY` messages directly to the **Zero-OCR Passthrough** transaction (creating the `announcements` row and 4 `IMAGE_ONLY` `delivery_jobs` without calling the AI pipeline).
4. **Context Assembler (`src/ingestion/context-assembler.ts`):**
   * Instrument `CP03_CONTEXT_ASSEMBLY` ($\mu\text{s}$).
   * Resolve quoted messages (from SQLite `source_messages` first, falling back to `msg.quotedText` from Baileys `contextInfo`).
   * Query bounded recent messages within `CONTEXT_WINDOW_SECONDS` (up to `CONTEXT_MAX_MESSAGES`), annotating `sameSender` and `alreadyProcessedAnnouncementId`.

#### 3.3 Phase 3 Deliverables Checklist
- [ ] `src/ingestion/media-store.ts`, `src/ingestion/deduplicator.ts`, `src/ingestion/context-assembler.ts`, and `src/ingestion/message-ingestor.ts` implemented.
- [ ] `CP02_GATE_CHECKS` and `CP03_CONTEXT_ASSEMBLY` ($\mu\text{s}$) instrumented with active debug printing.
- [ ] Unit/integration tests in `tests/unit/phase3-ingestion.test.ts` verify:
  - Messages from non-source groups, `fromMe = true` self-echoes, and duplicate `message_id`s are dropped at Gates 1, 2, and 4.
  - `IMAGE_ONLY` fixture (`05_image_only_infographic.json`) caches the PNG to `data/media/`, skips AI, and creates 4 `IMAGE_ONLY` delivery jobs in SQLite.
  - `06_quoted_reply_deadline_extension.json` and `07_multi_message_split_announcement.json` assemble quoted and window context accurately.
- [ ] **Un-negotiable Docs:** `docs/logs/dev/YYYY-MM-DD_phase-03-ingestion.md` and `docs/logs/test/YYYY-MM-DD_phase-03-ingestion-test.md` created.
- [ ] **Un-negotiable Git Commit:** Only Phase 3 files staged and committed.

#### 3.4 Developer Success Analysis & Gate Validation (Phase 3)
1. Run `npm test -- tests/unit/phase3-ingestion.test.ts`.
2. Inspect debug logs to confirm `CP01_INGEST_NORMALIZE`, `CP02_GATE_CHECKS`, and `CP03_CONTEXT_ASSEMBLY` print exact $\mu\text{s}$ durations and gate pass/drop reasons.

---

### PHASE 4: Gemini 3.8 Flash AI Pipeline (Stage A Classification, Stage B Fact Extraction & Stage C Hybrid Translation)

**Assigned Agents:** `developer.agent.md`, `tester.agent.md`  
**Relevant Skills:** `ai-translation-engine`, `typescript-node`, `testing-and-qa`, `documentation-workflow`, `git-scope-and-commits`

#### 4.1 Objective
Implement the unified `gemini-3.8-flash` AI pipeline using `@google/genai` (plus a deterministic mock AI provider for offline unit tests), covering Stage A (Classification), Stage B (Canonical Fact Extraction), and Stage C (Language Coverage Analysis & Hybrid 4-Language Synthesis for `ms`, `en`, `zh-CN`, and `ta`), with `<untrusted_whatsapp_data>` prompt isolation and microsecond stage checkpoints.

#### 4.2 Implementation Tasks
1. **Model Provider (`src/ai/model-provider.ts`):**
   * Implement `IModelProvider` with `GeminiModelProvider` (`@google/genai`, `model: config.AI_MODEL` = `'gemini-3.8-flash'`, structured JSON schema mode, `temperature: 0.1`) and `MockModelProvider` (deterministic responses for offline test fixtures).
   * Register prompt SHA-256 hashes in the `prompt_versions` SQLite table on startup.
2. **Zod Schemas & Prompt Templates (`src/ai/schemas/`, `src/ai/prompts/`):**
   * Implement `classification.schema.ts`, `canonical-facts.schema.ts`, and `translation.schema.ts` matching Section 5 of `docs/architecture.md`.
   * Wrap all WhatsApp message text, captions, and context inside `<untrusted_whatsapp_data>` tags with strict anti-injection system instructions.
3. **Stage A — Classifier (`src/ai/classifier.ts`):**
   * Instrument `CP04_AI_CLASSIFY` ($\mu\text{s}$).
   * Evaluate primary text/caption + assembled context.
   * Enforce confidence policy: `announcement` with $\text{confidence} \ge \text{CLASSIFIER\_THRESHOLD\_HIGH}$ proceeds to Stage B; lower confidence transitions announcement to `held_low_confidence`; `uncertain` transitions to `held_uncertain`; `not_announcement` transitions to `ignored`.
4. **Stage B — Canonical Fact Extractor (`src/ai/fact-extractor.ts`):**
   * Instrument `CP05_AI_FACT_EXTRACT` ($\mu\text{s}$).
   * Extract atomic facts (`date`, `time`, `venue`, `url`, `phone`, `email`, `amount`, `deadline`, etc.) across mixed source languages and evaluate `languageCoverage` (`complete`, `partial`, `missing`, `conflicting`) for `ms`, `en`, `zh-CN`, and `ta`.
   * If `conflicts.length > 0` or `requiresHold === true`, transition announcement to `held_conflict` and halt.
5. **Stage C — Language Coverage & Hybrid Translator (`src/ai/language-coverage.ts`, `src/ai/translator.ts`):**
   * Instrument `CP06_AI_TRANSLATE` ($\mu\text{s}$).
   * Inject active institutional terms from `glossary_terms`.
   * Apply hybrid strategy per language:
     * `complete` $\rightarrow$ `reused` (preserve/normalize existing complete section without redundant retranslation).
     * `partial` $\rightarrow$ `consolidated` (merge existing target-language text with facts supplied in other languages).
     * `missing` $\rightarrow$ `translated` (synthesize complete, natural announcement from canonical facts).

#### 4.3 Phase 4 Deliverables Checklist
- [ ] `src/ai/model-provider.ts`, `src/ai/classifier.ts`, `src/ai/fact-extractor.ts`, `src/ai/language-coverage.ts`, `src/ai/translator.ts`, schemas, and prompts implemented.
- [ ] `CP04_AI_CLASSIFY`, `CP05_AI_FACT_EXTRACT`, and `CP06_AI_TRANSLATE` ($\mu\text{s}$) instrumented with detailed debug output.
- [ ] Unit/integration tests in `tests/unit/phase4-ai-pipeline.test.ts` verify:
  - Casual chat (`08_casual_chat_noise.json`) is classified as `not_announcement` and ignored after Stage A.
  - Mixed English + Malay announcement (`02_text_mixed_en_ms.json`) combines facts from both languages into all 4 outputs (`ms`, `en`, `zh-CN`, `ta`).
  - Complete 4-language source message (`03_text_four_languages_complete.json`) uses `reused` strategy.
  - Conflicting dates (`09_conflicting_dates_announcement.json`) halts at Stage B with `held_conflict`.
  - Prompt injection attempt (`11_prompt_injection_attempt.json`) cannot alter routing or bypass schemas.
- [ ] **Un-negotiable Docs:** `docs/logs/dev/YYYY-MM-DD_phase-04-ai-pipeline.md` and `docs/logs/test/YYYY-MM-DD_phase-04-ai-pipeline-test.md` created.
- [ ] **Un-negotiable Git Commit:** Only Phase 4 files staged and committed.

#### 4.4 Developer Success Analysis & Gate Validation (Phase 4)
1. Run `npm test -- tests/unit/phase4-ai-pipeline.test.ts`.
2. Optional live check (if `AI_API_KEY` is configured in `.env`): run a single test announcement through live `gemini-3.8-flash` and inspect the microsecond ($\mu\text{s}$) breakdown for Stages A, B, and C and the naturalness of the `ms`, `en`, `zh-CN`, and `ta` outputs.

---

### PHASE 5: Stage D Deterministic Factual Validator & Quarantine Controls

**Assigned Agents:** `developer.agent.md`, `tester.agent.md`  
**Relevant Skills:** `ai-translation-engine`, `backend-architecture`, `testing-and-qa`, `documentation-workflow`, `git-scope-and-commits`

#### 5.1 Objective
Implement Stage D deterministic validation (`src/validation/translation-validator.ts` and `src/validation/protected-values.ts`) so that no translation with a mutated URL, missing date/number token, altered phone/email, or violated `must_not_translate` glossary term can ever be queued for broadcast.

#### 5.2 Implementation Tasks
1. **Protected Values Checker (`src/validation/protected-values.ts`):**
   * **URL Check:** Verify every critical `url` fact and regex-extracted source URL appears verbatim in `ms`, `en`, `zh-CN`, and `ta`.
   * **Email & Phone Check:** Verify verbatim email addresses and normalized digit sequences of phone numbers across all 4 outputs.
   * **Date, Time & Numeric Check:** Verify canonical day/year numbers (`15`, `2026`), time digits (`9`, `12`), and price/amount digits appear in all 4 outputs.
   * **Glossary Invariant Check:** Verify any `glossary_terms` entry with `must_not_translate = 1` present in the source appears unchanged in all 4 outputs.
2. **Translation Validator & Single Regeneration Retry (`src/validation/translation-validator.ts`):**
   * Instrument `CP07_VALIDATION` ($\mu\text{s}$).
   * Check completeness (all 4 languages present, non-empty, $\le 4096$ chars, all critical `fact.key`s included).
   * If validation fails on the first pass, log a `WARN` debug trace with the exact failed tokens and trigger **at most 1 regeneration retry** in Stage C with the specific error feedback.
   * If validation still fails, mark the announcement `status = 'held_validation_failed'`, persist the failed translations with `validation_errors_json` for inspection, and **do not create any delivery jobs**.

#### 5.3 Phase 5 Deliverables Checklist
- [ ] `src/validation/protected-values.ts` and `src/validation/translation-validator.ts` implemented.
- [ ] `CP07_VALIDATION` ($\mu\text{s}$) checkpoint instrumented with active debug logs showing every protected token checked.
- [ ] Unit tests in `tests/unit/phase5-validation.test.ts` verify:
  - Valid 4-language outputs pass in $< 1000\text{ }\mu\text{s}$.
  - A mutated URL (e.g., `https://example.invalid/reg` instead of `https://example.invalid/register`) or wrong date (`16` instead of `15`) is caught deterministically.
  - Failed validation triggers 1 retry and quarantines the announcement as `held_validation_failed` if still invalid.
- [ ] **Un-negotiable Docs:** `docs/logs/dev/YYYY-MM-DD_phase-05-validation.md` and `docs/logs/test/YYYY-MM-DD_phase-05-validation-test.md` created.
- [ ] **Un-negotiable Git Commit:** Only Phase 5 files staged and committed.

#### 5.4 Developer Success Analysis & Gate Validation (Phase 5)
1. Run `npm test -- tests/unit/phase5-validation.test.ts`.
2. Inspect debug output for `CP07_VALIDATION` to confirm each protected value check (URL, date, time, phone, glossary) is explicitly logged.

---

### PHASE 6: Persistent Delivery Queue, Message Reconstructor, Dispatcher & Crash Recovery

**Assigned Agents:** `developer.agent.md`, `tester.agent.md`  
**Relevant Skills:** `queue-and-reliability`, `database-management`, `whatsapp-baileys`, `testing-and-qa`, `documentation-workflow`, `git-scope-and-commits`

#### 6.1 Objective
Implement the static language-to-group router (`src/routing/message-router.ts`), persistent SQLite delivery queue (`src/delivery/queue.ts`), retry backoff policy (`src/delivery/retry-policy.ts`), outbound message reconstructor & rate-paced dispatcher (`src/delivery/dispatcher.ts`), startup crash recovery (`sending` $\rightarrow$ `uncertain`), and the final end-to-end journey telemetry calculator.

#### 6.2 Implementation Tasks
1. **Static Message Router (`src/routing/message-router.ts`):**
   * Map validated `ms`, `en`, `zh-CN`, and `ta` outputs strictly to configured destination group JIDs from `src/config/groups.ts` (never from AI output).
   * Compute deterministic idempotency keys: `${announcementId}:${languageCode}:${targetGroupJid}`.
2. **Persistent Queue & Crash Lease Recovery (`src/delivery/queue.ts`):**
   * Instrument `CP08_QUEUE_PERSIST` ($\mu\text{s}$) around the atomic SQLite transaction that persists the `announcements` status (`queued`), 4 `translations`, and 4 `delivery_jobs`.
   * Implement atomic lease acquisition (`pending`/`retry_wait` $\rightarrow$ `sending` with 45-second `lease_expires_at`).
   * Implement `recoverOrphanedJobs()` on startup and every 60s: any job stuck in `sending` past `lease_expires_at` transitions to `uncertain` (`LEASE_EXPIRED_CRASH`) and logs a `CRITICAL` event without auto-retrying.
3. **Retry Policy (`src/delivery/retry-policy.ts`):**
   * Classify transport errors:
     * Pre-send transient error (`WhatsAppTransientError`) with $\text{attempts} < 5$ $\rightarrow$ `retry_wait` with exponential backoff $\min(300, 5 \times 2^{\text{attempt}-1}) + \text{jitter}$.
     * Ambiguous send timeout (`WhatsAppAmbiguousTimeoutError` after 30s) $\rightarrow$ `uncertain` (halt auto-retry immediately).
     * Permanent error (`WhatsAppPermanentError` or $\text{attempts} \ge 5$) $\rightarrow$ `failed_permanent`.
4. **Message Reconstructor & Dispatcher (`src/delivery/dispatcher.ts`):**
   * Respect `BROADCAST_KILL_SWITCH`: if `'true'`, pause dequeuing immediately.
   * Instrument `CP09_MSG_RECONSTRUCT` ($\mu\text{s}$) per job:
     * `TEXT`: construct `{ type: 'TEXT', text: job.textContent }`.
     * `IMAGE_CAPTION`: read cached image binary buffer from `job.mediaLocalPath` (`data/media/...`) and pair with translated caption `{ type: 'IMAGE', imageBuffer, mimeType, caption: job.textContent }`.
     * `IMAGE_ONLY`: read cached image binary buffer from `job.mediaLocalPath` and construct `{ type: 'IMAGE', imageBuffer, mimeType }` (no caption).
   * Instrument `CP10_DISPATCH_<LANG>` ($\mu\text{s}$) around `adapter.sendMessage(job.targetGroupJid, payload)` with sequential pacing (`DELIVERY_PACING_MS`).
   * Upon completing the 4th destination job for an announcement, invoke `tracer.finalizeJourney(acknowledgedAtMs)` to print the complete `[JOURNEY_SUMMARY]` from source WhatsApp metadata timestamp to final Baileys dispatch timestamp and persist the telemetry breakdown in `event_logs`.

#### 6.3 Phase 6 Deliverables Checklist
- [ ] `src/routing/message-router.ts`, `src/delivery/queue.ts`, `src/delivery/retry-policy.ts`, and `src/delivery/dispatcher.ts` implemented.
- [ ] `CP08_QUEUE_PERSIST`, `CP09_MSG_RECONSTRUCT`, `CP10_DISPATCH_<LANG>`, and `[JOURNEY_SUMMARY]` (`TOTAL_PIPELINE_US` & `TOTAL_E2E_WALL_MS`) instrumented.
- [ ] Unit/integration tests in `tests/unit/phase6-delivery-queue.test.ts` verify:
  - `TEXT`, `IMAGE_CAPTION` (original image buffer + translated caption), and `IMAGE_ONLY` (original image buffer passthrough) reconstruct and dispatch to the 4 destination groups accurately.
  - Transient failure on 1 group (`ta`) transitions only `ta` to `retry_wait` and succeeds on retry without resending `ms`, `en`, or `zh-CN`.
  - Simulated 30s send timeout transitions the job to `uncertain` and never auto-retries it.
  - Simulated crash (expired `sending` lease) transitions the orphaned job to `uncertain` on recovery startup.
- [ ] **Un-negotiable Docs:** `docs/logs/dev/YYYY-MM-DD_phase-06-delivery-queue.md` and `docs/logs/test/YYYY-MM-DD_phase-06-delivery-queue-test.md` created.
- [ ] **Un-negotiable Git Commit:** Only Phase 6 files staged and committed.

#### 6.4 Developer Success Analysis & Gate Validation (Phase 6)
1. Run `npm test -- tests/unit/phase6-delivery-queue.test.ts`.
2. Inspect the console `[JOURNEY_SUMMARY]` block to confirm all 10 checkpoints (`CP01` through `CP10`) and the overall start-to-end duration print in $\mu\text{s}$ and $\text{ms}$.

---

### PHASE 7: End-to-End Composition Root, Full Synthetic QA & Live `BaileysWhatsAppAdapter` Integration

**Assigned Agents:** `developer.agent.md`, `tester.agent.md`  
**Relevant Skills:** `whatsapp-baileys`, `backend-architecture`, `queue-and-reliability`, `testing-and-qa`, `documentation-workflow`, `git-scope-and-commits`

#### 7.1 Objective
Wire all layers together in the application composition root (`src/app.ts`) and health monitor (`src/observability/health.ts`), implement the production `BaileysWhatsAppAdapter` (`src/whatsapp/baileys-client.ts` and `src/whatsapp/group-metadata.ts`), run the complete 11-fixture End-to-End integration test suite with full telemetry benchmarking, and prepare `docs/operations-runbook.md` for live SIM pairing and Oracle Cloud operation.

#### 7.2 Implementation Tasks
1. **Production Baileys Adapter (`src/whatsapp/baileys-client.ts`, `src/whatsapp/group-metadata.ts`):**
   * Implement `BaileysWhatsAppAdapter` adhering to `docs/BAILEYS_INTEGRATION_SPEC.md` and Section 3.4 of `docs/architecture.md`:
     * Multi-file auth state in `WHATSAPP_AUTH_DIR` (`./private/whatsapp-auth`).
     * Reconnection with bounded exponential backoff on non-loggedOut disconnects; immediate halt and `CRITICAL` log on `DisconnectReason.loggedOut`.
     * 30-second timeout wrapper on `sock.sendMessage` throwing `WhatsAppAmbiguousTimeoutError`.
     * Group metadata inspector (`getGroupMetadata`) to verify Community parent/sub-group topology and posting permissions.
2. **Health Monitor & Data Retention Task (`src/observability/health.ts`):**
   * Implement `HealthService.getSnapshot()` returning queue counts, WhatsApp connection status, held announcements count, and SQLite WAL size.
   * Implement daily cleanup routine for old `not_announcement` records and cached media older than `DATA_RETENTION_DAYS`.
3. **Application Composition Root (`src/app.ts`):**
   * Wire `EnvConfig`, `SQLiteClient`, `Migrator`, Repositories, `IWhatsAppAdapter` (`MockWhatsAppAdapter` or `BaileysWhatsAppAdapter` based on `WHATSAPP_ADAPTER_MODE`), `MessageIngestor`, AI Pipeline, `TranslationValidator`, `DeliveryQueue`, and `Dispatcher`.
   * Implement graceful shutdown on `SIGINT` / `SIGTERM` (stop dequeuing new jobs, await in-flight send up to timeout, close WhatsApp socket, checkpoint and close SQLite WAL).
4. **Full End-to-End Integration Test Suite (`tests/integration/e2e-pipeline.test.ts`):**
   * Execute all 11 synthetic fixtures end-to-end through `src/app.ts` and produce a consolidated **Telemetry Benchmark Table** (`CP01` to `CP10` in $\mu\text{s}$ + `TOTAL_E2E_WALL_MS`) in the test log.
5. **Operations Runbook (`docs/operations-runbook.md`):**
   * Document QR/pairing procedure when the redONE SIM arrives, group JID discovery helper command, kill-switch activation, `uncertain` job reconciliation SQL/CLI commands, and Oracle Cloud `systemd` deployment steps.

#### 7.3 Phase 7 Deliverables Checklist
- [ ] `src/whatsapp/baileys-client.ts`, `src/whatsapp/group-metadata.ts`, `src/observability/health.ts`, `src/app.ts`, and `docs/operations-runbook.md` implemented.
- [ ] End-to-end integration test suite (`tests/integration/e2e-pipeline.test.ts`) passes 100% across all 11 fixture scenarios and failure/recovery simulations.
- [ ] Complete microsecond ($\mu\text{s}$) telemetry benchmark table recorded across all message types (`TEXT`, `IMAGE_CAPTION`, `IMAGE_ONLY`).
- [ ] Live SIM / Baileys smoke test executed (or marked `[POSTPONED_BY_DEVELOPER]` if physical redONE SIM has not yet arrived).
- [ ] **Un-negotiable Docs:** `docs/logs/dev/YYYY-MM-DD_phase-07-e2e-and-baileys.md` and `docs/logs/test/YYYY-MM-DD_phase-07-e2e-and-baileys-test.md` created.
- [ ] **Un-negotiable Git Commit:** Only Phase 7 files staged and committed.

#### 7.4 Developer Success Analysis & Final Release Sign-Off (Phase 7)
1. Run the complete test suite (`npm test` and `npm run build`) and verify zero TypeScript errors and 100% test pass rate.
2. Review the consolidated Telemetry Benchmark Report in `docs/logs/test/YYYY-MM-DD_phase-07-e2e-and-baileys-test.md` to inspect exact $\mu\text{s}$ latencies for ingestion, gate checks, context assembly, AI classification/extraction/translation/validation, reconstruction, and dispatch.
3. Verify `git status` is clean and `git log` shows one clean, scoped commit per phase with all corresponding `dev_log`, `test_log`, and `fix_log` files intact.

---

## 5. Summary Phase Execution Matrix

| Phase | Name | Primary Owner | Mandatory Logs (`docs/logs/...`) | Commit Scope Prefix | Gate Requirement |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Phase 0** | Initialization, Telemetry Core & Oracle Setup | `developer.agent` + `tester.agent` | `dev/YYYY-MM-DD_phase-00-*`, `test/YYYY-MM-DD_phase-00-*` | `chore(phase-00/init):` | Local toolchain + $\mu\text{s}$ tracer pass; Oracle VM verified (or explicitly postponed by dev) |
| **Phase 1** | SQLite WAL Engine, Migrations & Repositories | `developer.agent` + `tester.agent` | `dev/YYYY-MM-DD_phase-01-*`, `test/YYYY-MM-DD_phase-01-*` | `feat(phase-01/database):` | All 9 tables, constraints, ACID transactions & repo unit tests pass |
| **Phase 2** | WhatsApp Interface, Mock Adapter & Fixtures | `developer.agent` + `tester.agent` | `dev/YYYY-MM-DD_phase-02-*`, `test/YYYY-MM-DD_phase-02-*` | `feat(phase-02/whatsapp-mock):` | `CP01` normalizer + 11 synthetic fixtures + fault injection tests pass |
| **Phase 3** | Ingestion, 5-Gate Filter, Media Store & Context | `developer.agent` + `tester.agent` | `dev/YYYY-MM-DD_phase-03-*`, `test/YYYY-MM-DD_phase-03-*` | `feat(phase-03/ingestion):` | `CP02` & `CP03` + 3-path routing (`TEXT`, `IMAGE_CAPTION`, `IMAGE_ONLY`) pass |
| **Phase 4** | Gemini 3.8 Flash Pipeline (Stages A, B, C) | `developer.agent` + `tester.agent` | `dev/YYYY-MM-DD_phase-04-*`, `test/YYYY-MM-DD_phase-04-*` | `feat(phase-04/ai-pipeline):` | `CP04`–`CP06` + hybrid 4-language (`ms`, `en`, `zh-CN`, `ta`) tests pass |
| **Phase 5** | Stage D Deterministic Factual Validator | `developer.agent` + `tester.agent` | `dev/YYYY-MM-DD_phase-05-*`, `test/YYYY-MM-DD_phase-05-*` | `feat(phase-05/validation):` | `CP07` protected values (URLs, dates, numbers, glossary) + retry/quarantine pass |
| **Phase 6** | Persistent Queue, Reconstructor & Dispatcher | `developer.agent` + `tester.agent` | `dev/YYYY-MM-DD_phase-06-*`, `test/YYYY-MM-DD_phase-06-*` | `feat(phase-06/delivery):` | `CP08`–`CP10` + `uncertain` timeout lock + crash recovery + `[JOURNEY_SUMMARY]` pass |
| **Phase 7** | E2E Composition, Full QA & Live Baileys Client | `developer.agent` + `tester.agent` | `dev/YYYY-MM-DD_phase-07-*`, `test/YYYY-MM-DD_phase-07-*` | `feat(phase-07/e2e-baileys):` | All 11 E2E scenarios + telemetry benchmark pass; ready for live SIM cutover |

---

**End of Master Phased Execution Plan (`docs/project-plan.md`).**