# QA Report: Phase 6 — E2E Composition and Baileys Adapter

**Date:** 2026-11-11
**Tester:** Developer-run independent regression
**Environment:** Windows, Node.js 22 toolchain, SQLite temporary databases,
mock WhatsApp transport
**Build or commit under test:** Working tree
**Status:** Conditionally Passed

## 1. Scope

**Task or implementation tested:** Composition root, mock E2E pipeline,
telemetry propagation, queue dispatch, and live adapter type/build boundary.

**Requirements tested:**

- All 11 synthetic fixture scenarios.
- FIFO ingestion, AI/validation, image forwarding, destination routing, and
  four-language dispatch.
- CP01–CP09 trace output and journey summaries.
- Type safety and production build.

**References:**

- [Project plan](../../project-plan.md)
- [Development log](../dev/2026-11-11_phase-06-e2e-and-baileys.md)
- [Architecture](../../architecture.md)

**Out of scope:** Real WhatsApp pairing and GCP systemd activation.

## 2. Test Results

| ID | Test / Scenario | Expected Result | Status | Evidence / Notes |
|---|---|---|---|---|
| T-01 | 11 synthetic fixtures | All normalize and route safely | PASS | 1 integration test passed |
| T-02 | FIFO burst and image paths | Chronological queueing and original media reuse | PASS | 44 mock sends; image cache traces observed |
| T-03 | AI and validation | Low-score ignore; translated outputs validate | PASS | 10 model calls; no validation hold |
| T-04 | Full regression | Existing behavior preserved | PASS | 7 files, 60 tests |
| T-05 | Live SIM/systemd smoke test | Real account and VM operation | BLOCKED | Physical SIM unavailable; no explicit postponement received |

## 3. Automated Testing

**Commands run:**

```text
npm run typecheck
npm test -- tests/integration/e2e-pipeline.test.ts
npm test
npm run build
```

**Results:**

- **Passed:** Typecheck; targeted E2E 1/1; full suite 60/60; build.
- **Failed:** 0.
- **Skipped / blocked:** Live transport and deployment smoke test.

### Representative telemetry benchmark

Captured from the successful fixture-01 journey in the targeted E2E run:

| Checkpoint | Duration |
|---|---:|
| CP01_INGEST_NORMALIZE | 770 us |
| CP02_FIFO_WAIT | 909 us |
| CP03_GATE_CHECKS | 1,794 us |
| CP04_CONTEXT_ASSEMBLY | 449 us |
| CP05_AI_PROCESS | 627 us |
| CP06_VALIDATION | 272 us |
| CP07_QUEUE_PERSIST | 7,733 us |
| CP08_MSG_RECONSTRUCT | 353 / 42 / 43 / 43 us |
| CP09_DISPATCH_ms/en/zh-CN/ta | 719 / 152 / 114 / 121 us |
| TOTAL_PIPELINE_US | 233,811 us |

The fixture's source timestamp predates the test wall clock; therefore its
TOTAL_E2E_WALL_MS is not a production latency measurement.

## 4. Issues Found

No unresolved functional defects remain in the synthetic suite. Initial
integration defects and their fixes are recorded in
[the Phase 6 fix log](../fixes/2026-11-11_phase-06-fix-e2e-wiring.md).

## 5. Final Assessment

**Status:** CONDITIONALLY PASSED

**Summary:** The complete mock composition and regression suite pass. Live
Baileys/GCP release readiness remains unverified.

**Required action:** Confirm whether the live SIM/systemd check is explicitly
postponed; then perform the controlled smoke test before final release sign-off.

**Remaining risks and limitations:**

- Real Community topology, permissions, credential persistence, and reconnect
  behavior require a controlled account.

---

# Retest History

No retest yet.
