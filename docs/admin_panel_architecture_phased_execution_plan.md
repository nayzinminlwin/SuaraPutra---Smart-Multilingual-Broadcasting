# SuaraPutra: Multi-Faculty Admin Panel Architecture & Execution Plan

**Project Name:** SuaraPutra — Smart Multilingual Broadcasting  
**Document Path:** `docs/admin-panel-plan.md`  
**Version:** 1.0.0 (Binding Admin Panel Specification)  
**Last Updated:** 13 November 2026  
**Status:** Approved for Implementation  
**Authoritative References:**  
* Core Engine Architecture: [`docs/architecture.md`](./architecture.md)  
* Core Engine Execution Plan: [`docs/project-plan.md`](./project-plan.md)  
* WhatsApp Transport Contract: [`docs/BAILEYS_INTEGRATION_SPEC.md`](./BAILEYS_INTEGRATION_SPEC.md)  
* Agent Definitions: `.github/agents/web_developer.agent.md`, `.github/agents/developer.agent.md`, `.github/agents/tester.agent.md`

---

## 1. Executive Summary & Multi-Tenant Evolution

### 1.1 Mission & Scope Evolution
With the core translation, validation, and destination-aware FIFO broadcasting engine completed in Phases 0 through 6.1, **Phase 7** transforms SuaraPutra from a single-tenant CLI service into a **long-lived, multi-faculty platform** for Universiti Putra Malaysia (UPM).

Each UPM Faculty (e.g., `FSKTM`, `FENG`, `FBMK`, `SPE`) operates an isolated workspace within the Admin Panel where up to **10 faculty administrators** collaboratively manage:
1. Their faculty's dedicated **Baileys WhatsApp session** (paired via live QR scan in the browser).
2. Their **Source WhatsApp Group** and **Destination Language Groups** (wired by pasting WhatsApp group invite URLs).
3. Their faculty's **Emergency Broadcast Kill-Switch**.
4. Peer approval of new faculty admins and **consensus-gated WhatsApp number changes**.
5. A live, **immutable audit trail** of every administrative action.

### 1.2 Phased Delivery Structure
To keep delivery modular and risk-free, the Admin Panel is divided into two major phases:
* **Phase 7 (Core Multi-Faculty Admin Panel — Immediate Scope):**
  * Google SSO authentication (Firebase Auth / Google OAuth), new-user onboarding form, first-admin auto-bootstrap, peer approval notifications (max $10$ admins/faculty), and System Owner observer mode.
  * Faculty-scoped workspace isolation, live Baileys QR pairing, and adaptive 2-admin consensus for changing a faculty's connected WhatsApp number.
  * Source and language group wiring via WhatsApp group URLs (`https://chat.whatsapp.com/...`) with automatic mid-flight job cancellation when a language group is unwired.
  * Per-faculty Kill-Switch and database-enforced immutable activity logs streamed live via Server-Sent Events (SSE).
* **Phase 8 (Advanced Operations, WhatsApp Mirror UI, Supervised Mode & BYOK — Later Phase):**
  * Dynamic language management (add, remove, or replace languages up to a maximum of $6$ languages per faculty).
  * Bring Your Own Key (BYOK) & AI model selection per faculty with automatic fallback to the system default model.
  * WhatsApp-style live message mirror UI displaying every source group message with real-time status badges (`Skipped`, `Queued`, `Errored`, `Completed`) and per-message overrides (`Forward`, `Stop`, `Retry`, `Echo`, `Delete`).
  * `Automated` vs. `Supervised` broadcast mode toggle.

---

## 2. Core Workflows & Business Logic Specifications (Phase 7)

### 2.1 System Architecture & Request Flow

~~~mermaid
flowchart TD
    subgraph Client ["React + Vite + Tailwind SPA (Browser)"]
        G_AUTH["Google SSO (Firebase Auth)"]
        ONBOARD["New User Onboarding Form"]
        DASH["Faculty Admin Dashboard (Shared State)"]
        SYS_BAR["System Owner Faculty Switcher (Read-Only Observer)"]
    end

    subgraph WebServer ["Node.js HTTP & SSE Server (src/web/)"]
        AUTH_MW["Google Token & Role Middleware"]
        REST["Faculty REST API Routes"]
        SSE["Real-Time SSE Hub (/api/stream)"]
    end

    subgraph MultiTenantCore ["Multi-Faculty Core Engine"]
        SESSION_MGR["FacultySessionManager (Per-Faculty Baileys Socket)"]
        INGEST["FIFO Message Ingestor"]
        AI["Gemini Flash AI Processor"]
        DISPATCH["Destination-Aware FIFO Dispatcher"]
    end

    subgraph Storage ["SQLite WAL Database (data/automation.sqlite)"]
        DB_TENANT["faculties, admin_users, faculty_groups"]
        DB_CONSENSUS["number_change_requests & approvals"]
        DB_AUDIT["admin_activity_logs (Immutable Triggers)"]
    end

    G_AUTH --> AUTH_MW
    ONBOARD --> REST
    DASH <--> REST
    SYS_BAR --> REST
    SSE -->|Live QR, Approvals, Logs, Status| DASH
    REST --> DB_TENANT
    REST --> DB_CONSENSUS
    REST --> DB_AUDIT
    REST --> SESSION_MGR
    SESSION_MGR --> INGEST --> AI --> DISPATCH
~~~

### 2.2 Authentication, Onboarding Form & Role Model
1. **Google SSO Sign-In:**
   * Every administrator signs in using their Google account (verified on the backend via Firebase Admin / Google OAuth ID token verification).
2. **System Owner ("Observer Mode"):**
   * If the authenticated Google email matches `SUPER_ADMIN_EMAIL` in `.env`, the user is authenticated with `system_role = 'SYSTEM_OWNER'`.
   * The System Owner bypasses the faculty onboarding form and receives a **Faculty Switcher Dropdown** in the top navigation bar to inspect any faculty's dashboard, queue health, and activity logs for system maintenance.
   * **Strict Non-Interference Rule:** The System Owner does **not** occupy one of a faculty's $10$ admin slots, does **not** receive faculty approval notifications, and does **not** participate in faculty admin approvals or WhatsApp number change consensus votes.
3. **New Admin Onboarding Form:**
   * Any non-owner user signing in for the first time lands on the **Faculty Onboarding Form** and must submit:
     * `name`: Pre-filled from Google profile (editable).
     * `email`: Locked to verified Google email.
     * `role`: **Mandatory** selection from strictly three options: `'lecturer'`, `'student'`, or `'academic_staff'`.
     * `faculty_code`: **Mandatory** faculty identifier (e.g., `'FSKTM'`, `'FENG'`, `'SPE'`, `'FBMK'`, etc.). This strictly determines which faculty tenant the user belongs to.
     * `organization`: **Nullable** string (e.g., `"Computer Science Club"`, `"Student Representative Council"`, or `null`). Informative descriptor visible to fellow faculty admins.
     * `position`: **Nullable** string describing their title within their `organization` or `role` (e.g., `"Executive Member of International Affairs"`, `"Head of Computer Science Department, FSKTM"`, or `null`).
   * ** canonical Profile Examples:**
     ~~~json
     [
       {
         "name": "Alex",
         "role": "student",
         "faculty": "FSKTM",
         "organization": "Computer Science Club",
         "position": "Executive Member of International Affairs"
       },
       {
         "name": "Dr. Thina",
         "role": "lecturer",
         "faculty": "FSKTM",
         "organization": null,
         "position": "Head of Computer Science Department, FSKTM"
       }
     ]
     ~~~

### 2.3 First-Admin Auto-Bootstrap & The 10-Admin Faculty Cap
When a new user submits the Onboarding Form for a target `faculty_code`, the backend executes an atomic SQLite transaction inspecting the current count of active admins ($N_{\text{active}}$) for that faculty:

| Active Admin Count ($N_{\text{active}}$) | System Action | User Experience |
| :--- | :--- | :--- |
| **$N_{\text{active}} = 0$**<br>*(First Admin of Faculty)* | User is **immediately auto-approved** (`status = 'active'`). An immutable log entry is written: `"Auto-approved as founding administrator for <faculty_code>"`. | Redirected immediately into the active Faculty Admin Panel with full privileges. |
| **$1 \le N_{\text{active}} < 10$**<br>*(Standard Onboarding)* | User is saved with `status = 'pending_approval'`. Real-time SSE notification is pushed to all active admins of that faculty. | User sees: *"Your request has been forwarded to the `<faculty_code>` admin team. You can log in as soon as one of the admins accepts."* |
| **$N_{\text{active}} \ge 10$**<br>*(Faculty Cap Reached)* | Request is rejected before insertion (or held as blocked). | User sees: *"`<faculty_code>` already has the maximum of 10 active administrators."* |

* **Single-Admin Approval Rule:** When a user is in `pending_approval`, **any one ($1$)** current active admin of that same faculty can click **Accept** (Provided $N_{\text{active}} < 10$ at approval time) or **Deny**. The decision is logged permanently in `admin_activity_logs` with the approving/denying admin's name and timestamp.

### 2.4 Adaptive Consensus Protocol for WhatsApp Number Changes
Each faculty connects one dedicated WhatsApp account via Baileys QR code scan:
1. **First-Time Connection (`connected_phone_jid IS NULL`):**
   * Any active admin of the faculty can click **"Start QR Pairing"**, scan the QR code streamed over SSE, and link the faculty's initial WhatsApp number without waiting for a second admin.
2. **Changing an Already-Connected WhatsApp Number (`connected_phone_jid IS NOT NULL`):**
   * Replacing an active WhatsApp number is a high-impact operation that disconnects the existing session and clears `./private/whatsapp-auth/<faculty_id>/`.
   * The required number of distinct admin approvals ($R_{\text{approvals}}$) adapts dynamically to the faculty's current active admin count ($N_{\text{active}}$):
     $$R_{\text{approvals}} = \min\left(2,\ N_{\text{active}}\right)$$
   * **Case A ($N_{\text{active}} = 1$):** The sole admin's initiation counts as $1/1$ approval, immediately unlocking the session reset and new QR pairing flow.
   * **Case B ($N_{\text{active}} \ge 2$):**
     * **Admin 1** clicks **"Request WhatsApp Number Change"**. This creates an open request in `number_change_requests` with Admin 1 recorded as Approval $1/2$.
     * All other active admins of that faculty see a prominent live notification banner: *"`<Admin 1 Name>` requested to change the connected WhatsApp number ($1/2$ approvals)."*
     * Once **Admin 2** (a different active admin of the same faculty) clicks **"Approve Number Change"** ($2/2$ approvals), the backend atomically logs out the old Baileys socket, deletes `./private/whatsapp-auth/<faculty_id>/`, records the consensus event in `admin_activity_logs`, and unlocks the QR scanner to pair the new number.

### 2.5 Dynamic Group Wiring via URLs & Mid-Flight Cancellation Rules
Admins manually create their Source Group and Destination Language Groups in WhatsApp and paste the group invite URLs (`https://chat.whatsapp.com/<inviteCode>`)—or direct `@g.us` JIDs in mock/simulation mode—into the Admin Panel:

1. **Wiring a Group (Add / Edit):**
   * The backend validates the WhatsApp invite URL format and extracts `<inviteCode>`.
   * When connected to live Baileys, the adapter calls `sock.groupGetInviteInfo(inviteCode)` (and `sock.groupAcceptInvite(inviteCode)` if the bot is not yet a participant) to resolve the canonical `group_jid` (`120363...@g.us`) and `group_subject`.
   * The resolved `group_jid`, `invite_url`, `display_name`, and `enabled = 1` are persisted in `faculty_groups`, and an immutable log entry is written to `admin_activity_logs`.
2. **Unwiring / Deleting a Destination Language Group Mid-Flight:**
   * All admins of a faculty share the same live configuration. If an admin unwires or deletes a destination language group (e.g., Tamil `ta`), that group immediately stops receiving updates while the remaining wired language groups (`ms`, `en`, `zh-CN`) continue operating normally.
   * **Mandatory Mid-Flight Cancellation Transaction:** At the exact moment a destination language group $(F, L)$ is unwired or disabled, the backend executes an atomic SQLite transaction:
     1. Marks the `faculty_groups` slot for $(F, L)$ as `enabled = 0, group_jid = NULL, invite_url = NULL`.
     2. Cancels all queued or backoff-waiting delivery jobs for that faculty and language:
        ~~~sql
        UPDATE delivery_jobs
        SET status = 'cancelled',
            last_error_code = 'GROUP_UNWIRED_BY_ADMIN',
            last_error_message = 'Destination language group was unwired by an admin prior to dispatch',
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE faculty_id = ?
          AND language_code = ?
          AND status IN ('pending', 'retry_wait');
        ~~~
     3. Reconciles any parent `announcements` rows whose remaining sibling jobs are already complete.
     4. **In-Flight AI & Dispatcher Guard:**
        * If an announcement is mid-AI translation (`status = 'processing'`) when language $L$ is unwired, `DeliveryQueue.enqueue()` checks active `faculty_groups` at enqueue time and only creates `delivery_jobs` for currently wired languages.
        * If a job for language $L$ was already leased (`status = 'sending'`) milliseconds before the unwire action, `dispatcher.ts` re-verifies that $(F, L)$ is still wired immediately before calling `adapter.sendMessage()`; if unwired, it aborts the send and transitions the job to `cancelled`.

### 2.6 Per-Faculty Emergency Kill-Switch
* Every faculty has an independent `kill_switch_active` boolean flag in the `faculties` table.
* When an admin toggles the Kill-Switch **ON**:
  * Outbound dispatching and new AI translations for **that specific faculty** halt immediately.
  * Other faculties on the platform continue broadcasting without interruption.
  * The action is recorded in `admin_activity_logs` and broadcast live via SSE to all open browser tabs for that faculty.

### 2.7 Append-Only Immutable Activity Audit Logs
* Every state-changing action in the Admin Panel (approving/denying an admin, wiring/unwiring a group, toggling the kill-switch, requesting/approving a WhatsApp number change, pairing a number) writes a record to `admin_activity_logs` containing `faculty_id`, `actor_admin_id`, `actor_name`, `actor_role`, `action_type`, `summary_text`, `metadata_json`, and `created_at`.
* **Database-Level Immutability:** SQLite `BEFORE UPDATE` and `BEFORE DELETE` triggers on `admin_activity_logs` unconditionally execute `SELECT RAISE(ABORT, 'admin_activity_logs is append-only and immutable')`. Neither application code nor manual SQL queries can alter or delete historical log rows.

---

## 3. Multi-Tenant Database Schema (`003_multi_tenant_admin_panel.sql`)

To preserve 100% compatibility with existing Phase 0–6.1 tables while upgrading to multi-faculty operation and future-proofing for Phase 8 (up to $6$ dynamic languages, BYOK, and Supervised Mode), Migration `003` introduces the following schema:

~~~sql
-- 1. Faculties (Tenant Root Table)
CREATE TABLE IF NOT EXISTS faculties (
  id TEXT PRIMARY KEY, -- Canonical code, e.g., 'FSKTM', 'FENG', 'SPE'
  display_name TEXT NOT NULL,
  whatsapp_status TEXT NOT NULL DEFAULT 'disconnected' CHECK (
    whatsapp_status IN ('disconnected', 'qr_ready', 'connecting', 'open', 'close', 'logged_out')
  ),
  connected_phone_jid TEXT,
  connected_phone_display TEXT,
  kill_switch_active INTEGER NOT NULL DEFAULT 0 CHECK (kill_switch_active IN (0, 1)),
  operating_mode TEXT NOT NULL DEFAULT 'automated' CHECK (
    operating_mode IN ('automated', 'supervised')
  ),
  -- Phase 8 BYOK readiness columns (NULL = use system default Gemini config)
  custom_ai_provider TEXT,
  custom_ai_model TEXT,
  custom_ai_api_key_encrypted TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Seed default faculty so existing single-tenant fixtures/tests map seamlessly
INSERT OR IGNORE INTO faculties (id, display_name)
VALUES ('DEFAULT', 'Default Faculty Workspace');

-- 2. Faculty Administrator Accounts (Max 10 Active per Faculty enforced in transaction)
CREATE TABLE IF NOT EXISTS admin_users (
  id TEXT PRIMARY KEY, -- UUIDv4
  google_sub TEXT NOT NULL UNIQUE, -- Google OAuth subject ID
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  avatar_url TEXT,
  faculty_id TEXT NOT NULL REFERENCES faculties(id) ON DELETE RESTRICT,
  role TEXT NOT NULL CHECK (role IN ('lecturer', 'student', 'academic_staff')),
  organization TEXT, -- Nullable informative description (Club, Committee, etc.)
  position TEXT, -- Nullable informative title connected to Organization or Role
  status TEXT NOT NULL DEFAULT 'pending_approval' CHECK (
    status IN ('pending_approval', 'active', 'denied', 'removed')
  ),
  approved_by_admin_id TEXT REFERENCES admin_users(id),
  approved_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_admin_users_faculty_status
  ON admin_users (faculty_id, status);

-- 3. Faculty Wired WhatsApp Groups (Source + Up to 6 Destination Languages)
CREATE TABLE IF NOT EXISTS faculty_groups (
  id TEXT PRIMARY KEY, -- UUIDv4
  faculty_id TEXT NOT NULL REFERENCES faculties(id) ON DELETE CASCADE,
  group_role TEXT NOT NULL CHECK (group_role IN ('source', 'destination')),
  language_code TEXT, -- NULL for 'source'; e.g. 'ms', 'en', 'zh-CN', 'ta' for 'destination'
  language_label TEXT, -- e.g. 'Malay', 'English', 'Mandarin', 'Tamil'
  language_order INTEGER NOT NULL DEFAULT 1 CHECK (language_order BETWEEN 0 AND 6),
  invite_url TEXT, -- https://chat.whatsapp.com/... entered by admin
  group_jid TEXT, -- Resolved 120363...@g.us JID (NULL when unwired)
  group_display_name TEXT,
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  wired_by_admin_id TEXT REFERENCES admin_users(id),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (faculty_id, group_role, language_code)
);

CREATE INDEX IF NOT EXISTS idx_faculty_groups_lookup
  ON faculty_groups (faculty_id, group_role, enabled);

-- 4. WhatsApp Number Change Consensus Requests
CREATE TABLE IF NOT EXISTS number_change_requests (
  id TEXT PRIMARY KEY, -- UUIDv4
  faculty_id TEXT NOT NULL REFERENCES faculties(id) ON DELETE CASCADE,
  initiated_by_admin_id TEXT NOT NULL REFERENCES admin_users(id),
  required_approvals INTEGER NOT NULL CHECK (required_approvals IN (1, 2)),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending', 'approved_unlocked', 'completed', 'cancelled', 'expired')
  ),
  reason TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  resolved_at TEXT
);

CREATE TABLE IF NOT EXISTS number_change_approvals (
  request_id TEXT NOT NULL REFERENCES number_change_requests(id) ON DELETE CASCADE,
  admin_id TEXT NOT NULL REFERENCES admin_users(id) ON DELETE RESTRICT,
  approved_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (request_id, admin_id)
);

-- 5. Append-Only Immutable Admin Activity Logs
CREATE TABLE IF NOT EXISTS admin_activity_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  faculty_id TEXT NOT NULL REFERENCES faculties(id) ON DELETE RESTRICT,
  actor_admin_id TEXT REFERENCES admin_users(id),
  actor_name TEXT NOT NULL,
  actor_role TEXT NOT NULL, -- 'lecturer' | 'student' | 'academic_staff' | 'system'
  action_type TEXT NOT NULL,
  summary_text TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_admin_activity_faculty_time
  ON admin_activity_logs (faculty_id, id DESC);

-- Database-Level Immutability Triggers (Logs CANNOT be altered or deleted)
CREATE TRIGGER IF NOT EXISTS trg_admin_activity_logs_no_update
BEFORE UPDATE ON admin_activity_logs
BEGIN
  SELECT RAISE(ABORT, 'admin_activity_logs is immutable and cannot be updated');
END;

CREATE TRIGGER IF NOT EXISTS trg_admin_activity_logs_no_delete
BEFORE DELETE ON admin_activity_logs
BEGIN
  SELECT RAISE(ABORT, 'admin_activity_logs is immutable and cannot be deleted');
END;

-- 6. Add faculty_id Scoping to Operational Tables (Defaulting to 'DEFAULT' for backwards compatibility)
ALTER TABLE source_messages ADD COLUMN faculty_id TEXT NOT NULL DEFAULT 'DEFAULT';
ALTER TABLE announcements ADD COLUMN faculty_id TEXT NOT NULL DEFAULT 'DEFAULT';
ALTER TABLE delivery_jobs ADD COLUMN faculty_id TEXT NOT NULL DEFAULT 'DEFAULT';
~~~

---

## 4. Backend API, Real-Time SSE & Multi-Session Baileys Architecture

### 4.1 `FacultySessionManager` & GCP `e2-micro` Memory Guardrails (`src/whatsapp/faculty-session-manager.ts`)
* **Multi-Session Storage Isolation:** Each faculty's Baileys authentication credentials are stored in a dedicated subdirectory:
  $$\texttt{./private/whatsapp-auth/\$\{facultyId\}/}$$
* **On-Demand Socket Lifecycle:** `FacultySessionManager` maintains `Map<string, IWhatsAppAdapter>`. Sockets are started only for faculties that have completed pairing or have an active QR pairing session in progress.
* **QR Code Streaming & Timeout:** When an admin clicks **"Connect WhatsApp"**, `BaileysWhatsAppAdapter` listens to `connection.update` (`qr` string event), converts or forwards the QR payload over the faculty's SSE channel (`event: whatsapp_qr`), and automatically closes the unauthenticated socket if the QR code is not scanned within $120\text{ seconds}$ so idle sockets never waste RAM on the `e2-micro` VM.

### 4.2 REST API Contract (`src/web/routes/`)
All `/api/*` routes require a valid `Authorization: Bearer <google_id_token_or_session_jwt>` header.

| Method & Endpoint | Access Scope | Description |
| :--- | :--- | :--- |
| `POST /api/auth/session` | Any Google User | Verifies Google ID token. Returns `SYSTEM_OWNER` profile, existing `admin_users` profile (`active` / `pending_approval` / `denied`), or `{ status: 'unregistered' }` to trigger the Onboarding Form. |
| `POST /api/auth/onboard` | Unregistered User | Submits `{ name, role, facultyCode, organization, position }`. Enforces the $10$-admin cap and $0$-admin auto-bootstrap rule. |
| `GET /api/system/faculties` | `SYSTEM_OWNER` (or Public List for Onboarding) | Lists faculties. Allows `SYSTEM_OWNER` to switch active observed `facultyId`. |
| `GET /api/faculty/:facultyId/state` | Active Faculty Admin or `SYSTEM_OWNER` | Returns faculty connection status, kill-switch state, wired groups (`source` + `destination` languages), queue metrics, active/pending admins, and open number-change requests. |
| `POST /api/faculty/:facultyId/admins/:userId/decision` | Active Faculty Admin (Strict) | Accepts or denies a `pending_approval` admin request for that faculty (enforcing $N_{\text{active}} < 10$). Writes immutable activity log. |
| `PUT /api/faculty/:facultyId/groups/source` | Active Faculty Admin | Wires or updates the Source WhatsApp Group URL (`inviteUrl`). Resolves `group_jid` via Baileys and logs activity. |
| `DELETE /api/faculty/:facultyId/groups/source` | Active Faculty Admin | Unwires the Source WhatsApp Group and logs activity. |
| `PUT /api/faculty/:facultyId/groups/language/:langCode` | Active Faculty Admin | Wires or updates a Destination Language Group URL (`ms`, `en`, `zh-CN`, `ta`). Resolves `group_jid`, sets `enabled = 1`, and logs activity. |
| `DELETE /api/faculty/:facultyId/groups/language/:langCode` | Active Faculty Admin | Unwires a Destination Language Group (`enabled = 0, group_jid = NULL`) and **atomically cancels all `pending` / `retry_wait` jobs** for that language. |
| `POST /api/faculty/:facultyId/kill-switch` | Active Faculty Admin | Toggles `kill_switch_active` (`true` / `false`) for the faculty and logs activity. |
| `POST /api/faculty/:facultyId/whatsapp/pair` | Active Faculty Admin | Starts initial QR pairing (if no number connected) or initiates/executes pairing if a number-change request is `approved_unlocked`. |
| `POST /api/faculty/:facultyId/whatsapp/change-request` | Active Faculty Admin | Initiates a request to change the connected WhatsApp number (auto-approves if $N_{\text{active}} = 1$; requires 2nd admin if $N_{\text{active}} \ge 2$). |
| `POST /api/faculty/:facultyId/whatsapp/change-request/:reqId/approve` | Second Active Faculty Admin | Records the 2nd admin's approval ($2/2$), disconnects the old WhatsApp session, wipes auth keys, and unlocks QR pairing. |
| `GET /api/faculty/:facultyId/activity-logs` | Active Faculty Admin or `SYSTEM_OWNER` | Returns paginated immutable `admin_activity_logs` for the faculty. |

### 4.3 Real-Time Server-Sent Events (`/api/faculty/:facultyId/stream`)
Every open Admin Panel tab subscribes to `/api/faculty/:facultyId/stream` (`text/event-stream`). Whenever any admin makes a change, all connected admins of that faculty immediately receive:
* `activity_log_created`: Appends the new immutable log entry to the live activity feed.
* `group_wiring_updated`: Updates the Source/Language group cards and queue counts in real time.
* `kill_switch_toggled`: Flips the emergency kill-switch banner across all open tabs.
* `admin_request_updated`: Alerts admins of a new `pending_approval` applicant or updates the team roster.
* `whatsapp_qr` / `whatsapp_status`: Streams the live Baileys QR code image/string and connection state (`connecting` $\rightarrow$ `open`).
* `number_change_updated`: Updates the $1/2 \rightarrow 2/2$ consensus banner in real time.

---

## 5. Frontend Application Architecture (`web/` — React + Vite + Tailwind CSS)

To ensure zero extra Node.js server processes on the `1 GB` RAM `e2-micro` VM, the frontend is a clean **React 19 + Vite + TypeScript + Tailwind CSS** Single-Page Application compiled into `dist/public/` and served statically by `src/web/server.ts`.

### 5.1 Frontend Directory Structure

~~~text
web/
├── index.html
├── vite.config.ts
├── tailwind.config.ts
└── src/
    ├── main.tsx
    ├── App.tsx
    ├── auth/
    │   ├── firebase.ts                   # Google SSO client initialization
    │   ├── AuthContext.tsx               # Session state (Unregistered, Pending, Active, SystemOwner)
    │   ├── LoginPage.tsx                 # Google Sign-In landing page
    │   ├── OnboardingFormPage.tsx        # Role, Faculty, Organization, Position form
    │   └── PendingApprovalPage.tsx       # Waiting screen for pending_approval users
    ├── components/
    │   ├── TopNavbar.tsx                 # Faculty badge, System Owner Faculty Switcher, User profile
    │   ├── KillSwitchBanner.tsx          # High-visibility Faculty Kill-Switch toggle & status
    │   ├── WhatsAppConnectionCard.tsx    # Live QR modal, connected number badge & 2-Admin change flow
    │   ├── GroupWiringMatrix.tsx         # Source Group URL input + 4 Language Group URL cards
    │   ├── AdminTeamRoster.tsx           # Active admins (X/10), Pending requests Accept/Deny cards
    │   └── LiveActivityLogFeed.tsx       # Real-time SSE immutable audit stream
    └── hooks/
        └── useFacultyStream.ts           # SSE hook syncing live state across faculty admins
~~~

---

## 6. Partitioned Execution Plan for Phase 7 (Core Admin Panel)

Agents (`developer.agent.md`, `web_developer.agent.md`, and `tester.agent.md`) must execute Phase 7 across **6 sequential partitions (Partitions 7A through 7F)**:

### Partition 7A — Multi-Tenant SQLite Migration & Repositories
* **Scope:** `src/database/migrations/003_multi_tenant_admin_panel.sql` and typed repositories (`faculty.repo.ts`, `admin-user.repo.ts`, `faculty-group.repo.ts`, `number-change.repo.ts`, `admin-activity-log.repo.ts`).
* **Key Requirements:**
  1. Enforce the $0$-admin auto-bootstrap and $10$-admin cap inside `admin-user.repo.ts` using an atomic SQLite `IMMEDIATE` transaction.
  2. Enforce adaptive consensus ($\min(2, N_{\text{active}})$) and distinct-admin voter check inside `number-change.repo.ts`.
  3. Enforce `BEFORE UPDATE` and `BEFORE DELETE` immutability triggers on `admin_activity_logs`.
  4. Implement atomic mid-flight cancellation of `pending` and `retry_wait` jobs in `delivery-job.repo.ts` when a `faculty_groups` language slot is unwired.
* **Verification Gate:** Unit tests in `tests/unit/phase7a-admin-database.test.ts` verify first-admin auto-approval, 2nd–10th admin pending state, 11th admin rejection, immutable log trigger aborts on `UPDATE`/`DELETE`, and mid-flight job cancellation upon group unwiring.

### Partition 7B — Multi-Faculty Engine Wiring & Mid-Flight Cancellation Guards
* **Scope:** `src/whatsapp/faculty-session-manager.ts`, `src/ingestion/message-ingestor.ts`, `src/delivery/queue.ts`, `src/delivery/dispatcher.ts`.
* **Key Requirements:**
  1. Scope ingestion, queueing, kill-switch checks, and dispatching by `faculty_id`.
  2. In `DeliveryQueue.enqueue()`, dynamically query `faculty_groups` (`enabled = 1 AND group_jid IS NOT NULL`) so unwired language groups never receive new jobs.
  3. In `Dispatcher.dispatchNext()`, verify the target language group is still wired and the faculty kill-switch is `0` immediately before calling `adapter.sendMessage()`.
  4. Implement WhatsApp invite URL parser (`https://chat.whatsapp.com/<code >`) and Baileys `groupGetInviteInfo` / `groupAcceptInvite` resolution.
* **Verification Gate:** Integration tests in `tests/unit/phase7b-multi-faculty-engine.test.ts` verify that unwiring Tamil (`ta`) mid-flight cancels queued `ta` jobs while Malay (`ms`), English (`en`), and Mandarin (`zh-CN`) complete normally.

### Partition 7C — HTTP Server, Google SSO Auth Middleware, REST API & SSE Hub
* **Scope:** `src/web/server.ts`, `src/web/auth/google-auth.ts`, `src/web/sse/event-hub.ts`, `src/web/routes/*`, `src/config/env.ts` (adding `SUPER_ADMIN_EMAIL`, `GOOGLE_CLIENT_ID`, `WEB_ADMIN_PORT`).
* **Key Requirements:**
  1. Implement Google ID token verification (plus a deterministic test-token bypass only when `NODE_ENV=test`).
  2. Implement `SYSTEM_OWNER` observer recognition (`email === config.SUPER_ADMIN_EMAIL`) with read-only access to all faculties and strict exclusion from faculty admin counts/approvals.
  3. Implement all REST endpoints in Section 4.2 and real-time SSE broadcasting in Section 4.3, ensuring every state mutation writes an immutable row to `admin_activity_logs` inside the same transaction.
* **Verification Gate:** API integration tests in `tests/integration/phase7c-admin-api.test.ts` verify onboarding, peer approval, System Owner observer access, 2-admin number change consensus, group URL wiring/unwiring, kill-switch toggling, and SSE event emission.

### Partition 7D — React + Vite + Tailwind Frontend: Auth, Onboarding & Team Approvals
* **Scope:** `web/` scaffolding, `LoginPage.tsx`, `OnboardingFormPage.tsx`, `PendingApprovalPage.tsx`, `TopNavbar.tsx` (with System Owner Faculty Switcher), and `AdminTeamRoster.tsx`.
* **Key Requirements:**
  1. Build the Google Sign-In flow and the Onboarding Form with strict validation (`Role` in `lecturer | student | academic_staff`, `Faculty` selector, optional `Organization` and `Position`).
  2. Build the Pending Approval waiting screen and the real-time Admin Team Roster showing $X/10$ active admins and 1-click **Accept / Deny** buttons for pending requests.
* **Verification Gate:** Frontend build (`npm run build:web`) and component/flow tests pass with zero TypeScript errors.

### Partition 7E — React + Vite + Tailwind Frontend: Group Wiring, QR Pairing, Consensus & Live Audit Feed
* **Scope:** `KillSwitchBanner.tsx`, `WhatsAppConnectionCard.tsx`, `GroupWiringMatrix.tsx`, `LiveActivityLogFeed.tsx`, `useFacultyStream.ts`.
* **Key Requirements:**
  1. Build the Source Group and 4 Destination Language Group wiring cards where admins paste `https://chat.whatsapp.com/...` URLs, edit existing URLs, or unwire groups with instant visual feedback across all open tabs.
  2. Build the Baileys QR Pairing modal and the 2-Admin Number Change Consensus banner ($1/2 \rightarrow 2/2$ approval workflow).
  3. Build the per-faculty Emergency Kill-Switch control and the real-time, append-only Activity Log panel.
* **Verification Gate:** Full frontend + backend production build (`npm run build`) serves the complete SPA from `src/web/server.ts`.

### Partition 7F — End-to-End Multi-Faculty QA & Documentation Sign-Off
* **Scope:** `tests/integration/phase7-e2e-admin-panel.test.ts`, `docs/operations-runbook.md`, and `docs/logs/*`.
* **Verification Gate:** Complete E2E verification of onboarding, 10-admin cap, 2-admin number change consensus, group unwiring mid-flight cancellation, kill-switch isolation, and immutable activity logs.

---

## 7. Phase 8 Blueprint (Later Phase Expansion Roadmap)

The database schema and API boundaries established in Phase 7 are explicitly designed so that **Phase 8** features can be added cleanly without breaking changes:

### 7.1 Dynamic Language Management (Up to 6 Languages per Faculty)
* **Workflow:** Admins can add a new target language (e.g., Arabic `ar`, Indonesian `id`, Japanese `ja`), remove an existing language (such as Malay), or replace a language—up to a maximum of **$6$ active destination languages** per faculty ($\le 6$).
* **Technical Execution:**
  * The admin manually creates the WhatsApp group for the new language and wires its URL into a new language slot in `faculty_groups` (enforcing `COUNT(*) <= 6`).
  * `translation.prompt.ts` and `translation.schema.ts` dynamically construct the Gemini JSON response schema from the faculty's active `faculty_groups` language list rather than a hardcoded 4-language list.

### 7.2 Bring Your Own Key (BYOK) & Custom Model Selection with Auto-Fallback
* **Workflow:** A faculty admin can configure a custom AI provider/model and API key in the Faculty Settings panel (`faculties.custom_ai_provider`, `custom_ai_model`, `custom_ai_api_key_encrypted`).
* **Resilient Fallback:**
  * If a faculty configures BYOK, `AiProcessor` attempts the call using the faculty's key/model first.
  * If the custom key fails (invalid key, quota exhausted `429`, model/SDK mismatch) or the admin clicks **"Rollback to System Default"**, the backend logs a `WARN` activity event and automatically falls back to the system default Gemini configuration so faculty broadcasts never halt.

### 7.3 WhatsApp-Style Live Source Group Mirror UI & Per-Message Actions
* **Visual Experience:** A dedicated page in the Admin Panel styled like **WhatsApp Web** displaying the chronological message stream of the faculty's wired Source Group (text bubbles, images with captions, standalone images, quoted replies, sender pushNames, and timestamps).
* **Real-Time Status Badges Beside Every Message:**
  * `Skipped` (`score < 4.0` or ignored in Supervised mode)
  * `Queued` / `Processing` (in FIFO queue, AI translation, or active delivery)
  * `Errored` (`held_validation_failed`, `failed_permanent`, or `uncertain`)
  * `Completed` (all wired destination language groups marked `sent`)
* **Per-Message Admin Override Actions:**
  1. **`Forward` (for `Skipped` messages):** Bypasses the `< 4.0` AI score filter, forces 4-language translation, and queues delivery jobs to all wired groups.
  2. **`Stop` (for `Queued` / `Processing` messages):** Immediately cancels all `pending` / `retry_wait` delivery jobs for that announcement.
  3. **`Retry` (for `Errored` messages):** Re-runs AI translation (if `held_validation_failed`) or resets failed/uncertain `delivery_jobs` back to `pending`.
  4. **`Echo / Repeat` (for `Completed` messages):** Creates a fresh broadcast batch to re-send the translated announcement to the destination groups as a reminder.
  5. **`Delete` (for `Completed` messages):** Iterates over the recorded `outgoing_message_id`s in `delivery_jobs` and invokes Baileys `sock.sendMessage(targetGroupJid, { delete: msgKey })` to revoke ("Delete for Everyone") the broadcast across all destination WhatsApp groups.

### 7.4 `Automated` vs. `Supervised` Operating Mode
* Controlled via `faculties.operating_mode` (`'automated'` vs. `'supervised'`):
  * **`Automated` Mode (Default):** Incoming messages pass through the AI evaluator (`score >= 4.0` for text; automatic for images) and broadcast automatically.
  * **`Supervised` Mode:** Incoming source messages are ingested, displayed immediately in the **WhatsApp-Style Live Mirror UI** with status `Awaiting Approval`, and held before broadcast. An admin scrolls the WhatsApp Mirror UI and clicks **`Forward`** (which triggers translation + broadcast, bypassing AI score filtering) or **`Ignore`** (which marks the message `Skipped`) beside each message.

---

**End of Multi-Faculty Admin Panel Architecture & Execution Plan (`docs/admin-panel-plan.md`).**