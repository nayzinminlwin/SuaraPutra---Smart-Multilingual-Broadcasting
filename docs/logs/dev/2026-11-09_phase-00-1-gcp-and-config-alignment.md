# Development Log: Phase 0.1 — GCP Guardrails, Config & Telemetry Alignment

**Date and time:** 2026-11-09 21:55 +08:00
**Agent:** Developer agent
**Moderator:** Project owner
**Status:** Completed

## 1. Objective

Align Phase 0 configuration, telemetry, diagnostics, and deployment artifacts
with the approved Gemini single-call and Google Cloud `e2-micro` architecture.

## 2. Scope and Acceptance Criteria

**Authorized phase:** Phase 0.1 — GCP `e2-micro` Guardrails, Config Schema & Telemetry Alignment

- Replace the obsolete classifier threshold with the score threshold.
- Enforce single-concurrency ingestion and the media-size guardrail.
- Align retention with the 14-day policy.
- Implement CP01–CP09 telemetry and retry warning output.
- Provide GCP provisioning and systemd memory guardrails.
- Update diagnostics and unit tests.

**Explicitly out of scope:** Database, WhatsApp adapter, AI processor, delivery
queue, and dashboard implementation.

## 3. References

- [Project plan](../../project-plan.md)
- [Architecture](../../architecture.md)
- [TypeScript and Node.js skill](../../../.github/skills/typescript-node/SKILL.md)

## 4. Changes Made

**Files created:**

- `scripts/setup-gcp-server.sh`
- `docs/logs/dev/2026-11-09_phase-00-1-gcp-and-config-alignment.md`
- `docs/logs/test/2026-11-09_phase-00-1-gcp-and-config-alignment-test.md`

**Files modified:**

- `.env.example`
- `src/config/env.ts`
- `src/observability/telemetry.ts`
- `scripts/verify-environment.ts`
- `tests/unit/phase0-init.test.ts`
- `deploy/suaraputra.service`

**Files deleted:**

- `scripts/setup-oracle-server.sh`

**Implementation summary:**

- Added the fixed announcement score, FIFO concurrency, media-size, and
  retention configuration contracts.
- Added canonical pipeline checkpoint names and retry warning banners.
- Added idempotent GCP swap, journald, runtime, directory, and service-user
  provisioning.
- Added systemd heap and memory limits.

## 5. Technical Decisions and Deviations

- **Decision:** Keep the tracer's CP09 base name as `CP09_DISPATCH`; language
  suffixes are supplied by dispatch callers.
  **Rationale:** The authoritative contract defines `CP09_DISPATCH_<LANG>`.
- **Deviation:** The provisioning script validates the host prerequisites but
  does not install or enable the application service.
  **Rationale:** Service deployment is a later composition/deployment concern.

## 6. Deliverables

| Deliverable | Status | Description |
|---|---|---|
| Configuration alignment | Complete | New score, FIFO, media, and retention fields |
| Telemetry alignment | Complete | CP01–CP09 constants and retry helper |
| GCP provisioning | Complete | 2 GB swap and 200 MB journald cap |
| Systemd guardrails | Complete | 512 MB Node heap and 800 MB service limit |
| Diagnostics and tests | Complete | Updated to exercise the new contract |

## 7. Verification

**Commands run:**

```text
npm test
npm run typecheck
npm run build
npx tsx scripts/verify-environment.ts
git diff --check
```

**Results:**

- **Passed:** 3 unit tests, strict typecheck, TypeScript build, environment
  diagnostics with CP01–CP09 output and retry warning, Bash syntax validation,
  and `git diff --check`.
- **Failed:** Initial Bash syntax validation caught a malformed heredoc in the
  GCP script; it was corrected and the final validation passed.
- **Skipped / blocked:** Live GCP provisioning was not run from the Windows
  development host.

## 8. Risks, Known Issues, and Follow-up

- Live execution of the provisioning script remains an operational deployment
  check.
- Phase 1 owns SQLite implementation.
- **Tester focus:** Verify configuration boundaries, all checkpoint names,
  retry warning output, and service guardrails.

## 9. Commit and Documentation

**Commit:** Not committed
**Related documentation:** This log and the Phase 0.1 QA log.
