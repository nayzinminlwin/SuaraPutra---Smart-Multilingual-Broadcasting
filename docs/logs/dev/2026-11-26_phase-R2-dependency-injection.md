# Development Log: Phase R2 — Dependency Injection & Service Wiring

**Date and time:** 2026-11-26 22:12 +08:00
**Agent:** AI assistant using Copilot SDK in VS Code
**Moderator:** Not specified
**Status:** Completed

## 1. Objective

Add targeted dependency overrides to application composition, ensure safe configuration logging, make the broadcast kill switch a boolean, and document why ingestion concurrency remains capped at one.

## 2. Scope and Acceptance Criteria

**Authorized phase:** R2 — Dependency Injection & Service Wiring
**Acceptance criteria:**

- `ApplicationDependencies` allows overriding the database, repositories, AI processor, delivery queue, and WhatsApp adapter.
- A test proves an injected source repository is used instead of the default repository.
- Application config logging receives `getSafeConfig()` output so the AI API key is excluded from structured log data.
- `BROADCAST_KILL_SWITCH` parses to a boolean, and application dispatch uses it directly.
- The ingestion concurrency cap and conditions for raising it are documented.
- Existing tests and TypeScript type checking pass.

**Explicitly out of scope:**

- R3 service decomposition and R4 database remediation.
- Changes to application behavior other than dependency override points and boolean kill-switch semantics.
- Any access to the production database or WhatsApp auth folder.

## 3. References

- [Remediation plan](../../audits/remediation-plan.md), Phase R2
- [Development log template](../../templates/dev_log_template.md)
- [TypeScript and Node.js skill](../../../.github/skills/typescript-node/SKILL.md)
- [Backend architecture skill](../../../.github/skills/backend-architecture/SKILL.md)

## 4. Changes Made

**Files created:**

- `tests/unit/remediation-r2.test.ts`
- `docs/logs/dev/2026-11-26_phase-R2-dependency-injection.md`

**Files modified:**

- `src/app.ts`
- `src/config/env.ts`
- `docs/architecture.md`
- `docs/project-plan.md`
- `scripts/run-live-simulation.ts`
- `tests/integration/e2e-pipeline.test.ts`
- `tests/unit/remediation-r1.test.ts`

**Files deleted:** None

**Implementation summary:**

- Exported `ApplicationDependencies` as optional app-level overrides for the database, repositories, processor, queue, and adapter. The application uses overrides where supplied and constructs defaults for the rest.
- Retained the existing top-level adapter option for compatibility; an adapter passed in `dependencies` takes precedence.
- Passed `getSafeConfig(this.config)` to `logSafeConfig`.
- Transformed the environment-string kill switch to a boolean and updated the application, simulation, and typed test configurations to use booleans.
- Updated the architecture config example and project-plan usage text to match the boolean runtime contract; `.env` documentation continues to use string values because environment variables are strings.
- Documented that ingestion stays serial until ordering, deduplication, and recovery are tested safe under parallel processing.
- Added tests for injected repository use, default/true/false boolean parsing, kill-switch dispatch behavior, and exclusion of the API key from structured log output.

## 5. Technical Decisions and Deviations

- **Decision:** Keep `ApplicationOptions.adapter` while adding `dependencies.adapter`.
  **Rationale:** Existing callers remain compatible; the explicit dependency override wins when both are supplied.
- **Decision:** The application continues to migrate and close an injected `DatabaseClient`; injected repositories must be compatible with that database.
  **Rationale:** The app lifecycle remains the owner of persistence initialization and shutdown.
- **Decision:** Retain `MAX_CONCURRENT_INGESTIONS` with an explanatory constraint instead of removing the field.
  **Rationale:** Existing config consumers/tests remain stable, and the comment states evidence required before raising the cap.
- **Deviation:** None from R2.

## 6. Deliverables

| Deliverable | Status | Description |
|---|---|---|
| Typed application dependency overrides | Complete | Exported interface wired into runtime construction. |
| Injected repository test | Complete | A spy on an injected source repository is called; the app's default source table remains untouched for the duplicate event. |
| Safe config logging | Complete | Logger output contains the safe-config message and excludes a sentinel API key. |
| Boolean kill switch | Complete | Default, `true`, and `false` parse as booleans; `true` prevents dispatch while preserving pending jobs. |
| Ingestion concurrency constraint | Complete | Config comment documents current serial requirement and conditions for raising it. |
| Regression verification | Complete | Full test suite and type check passed. |

## 7. Verification

**Commands run:**

```text
npm test -- tests/unit/remediation-r2.test.ts tests/unit/phase0-init.test.ts tests/unit/phase5-delivery-queue.test.ts --reporter=dot
npm test -- --reporter=dot
npm run typecheck
git diff --check
```

**Results:**

- **Passed:** Targeted R2, config, and queue suite — 3 test files, 34 tests passed.
- **Passed:** `npm test -- --reporter=dot` — 10 test files, 94 tests passed.
- **Passed:** `npm run typecheck` — zero TypeScript errors.
- **Passed:** `git diff --check` — no whitespace errors.
- **Skipped / blocked:** No live WhatsApp account or operational database was used.

## 8. Risks, Known Issues, and Follow-up

- Callers that construct `EnvConfig` directly must now use a boolean `BROADCAST_KILL_SWITCH`; environment-variable inputs remain strings and are transformed by `parseEnv`.
- Injected repositories are expected to be compatible with the database used by the app; the app migrates and closes an injected database as part of its lifecycle.
- **Tester focus:** Verify partial dependency overrides compose with defaults and the kill switch remains fail-safe in all startup configurations.

## 9. Commit and Documentation

**Commit:** `ae7d850` (`refactor(remediation-R2/di): inject application services safely`)
**Related documentation:** [Remediation plan](../../audits/remediation-plan.md)
