# Development Log: Phase 00 — Initialization, Telemetry Core & Oracle Setup

**Date and time:** 2026-11-08 17:00 +08:00
**Agent:** Developer agent
**Moderator:** Project owner
**Status:** Completed with approved hosting deviation

## 1. Objective

Initialize the Node.js/TypeScript backend foundation, typed configuration, active debug logging, microsecond telemetry, local environment verification, and Oracle provisioning artifacts.

## 2. Scope and Acceptance Criteria

**Authorized phase:** Phase 00 — Project Initialization, Toolchain, Telemetry Core & Oracle Server Setup

- Toolchain and directory skeleton are valid.
- Configuration, logger, tracer, verifier, and deployment artifacts are implemented.
- Phase 0 tests and environment diagnostics pass locally.
- Cloud VM readiness is verified.

**Explicitly out of scope:** SQLite schema/repositories, WhatsApp adapters, AI pipeline, delivery queue, and web dashboard.

## 3. References

- [Project plan](../../project-plan.md)
- [Architecture](../../architecture.md)
- [Documentation workflow](../../../.github/skills/documentation-workflow/SKILL.md)

## 4. Changes Made

**Files created:** package/toolchain configuration, `src/config/*`, `src/observability/*`, `scripts/*`, `deploy/suaraputra.service`, Phase 0 unit tests, and this log.

**Files modified:** None.

**Implementation summary:**

- Added strict Node.js 22 TypeScript configuration and secret/data exclusions.
- Added Zod environment validation and static four-language routing metadata.
- Added redacting Pino logger and `process.hrtime.bigint()` pipeline tracer with journey summaries.
- Added local environment diagnostics and idempotent Ubuntu 24.04 provisioning artifacts.

## 5. Technical Decisions and Deviations

- **Decision:** Keep the AI key required by the authoritative environment schema even when the mock provider is selected. **Rationale:** Match `docs/architecture.md`; tests use a synthetic key only.
- **Decision:** Google Cloud Compute Engine is used instead of Oracle Cloud. **Rationale:** The project owner selected Google Cloud and completed the VM setup.
- **Deviation:** The GCP VM is `e2-micro` on `x86_64`, rather than the planned Oracle ARM64 profile. **Rationale:** This is the owner-provided hosting environment; Phase 0 provisioning and runtime checks still pass.

## 6. Deliverables

| Deliverable | Status | Description |
|---|---|---|
| Local toolchain | Complete | Package manifest, lockfile, compiler, ignore rules, and example environment |
| Config and observability | Complete | Zod config, routing, logger, and tracer |
| Provisioning | Complete | Google Cloud VM validated: Ubuntu 24.04, Node 22, SQLite, service user, secure directories, and UFW |
| Tests and diagnostics | Complete | Unit tests, build, typecheck, dependency install, and environment verifier passed locally and remote runtime checks passed |

## 7. Verification

**Commands run:**

```text
npm install
npm test
npm run typecheck
npm run build
npm prune; npm ls --depth=0
npx tsx scripts/verify-environment.ts
```

**Results:**

- **Passed:** 3 unit tests; strict typecheck; TypeScript build; native `better-sqlite3` load; environment verifier; tracer checkpoint and journey summary output.
- **Failed:** None after upgrading to compatible `better-sqlite3` 13.0.3 and Baileys 6.7.22 pins.
- **Skipped / blocked:** Live Oracle validation pending owner input. `npm install` reports 4 dependency audit vulnerabilities; these are recorded as a follow-up risk and were not force-fixed.

## 8. Risks, Known Issues, and Follow-up

- The GCP service unit is not installed or active yet; application deployment is a later phase deliverable.
- The current VM architecture and machine size differ from the approved Oracle reference profile and should be reviewed before production workload deployment.

## 9. Commit and Documentation

**Commit:** Pending explicit phase commit after final staging review.
**Related documentation:** This log and the Phase 0 QA log.
