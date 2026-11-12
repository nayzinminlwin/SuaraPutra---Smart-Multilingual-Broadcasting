# Phase 6 Code Quality and Architecture Audit

**Date:** 2026-11-11  
**Scope:** Phase 6 composition root, live Baileys adapter, health monitor,
E2E integration, and telemetry propagation  
**Audit status:** Conditionally acceptable; fixes required before commit or
production release

## 1. Executive Assessment

The Phase 6 implementation has the correct overall modular shape and the
synthetic happy path passes. However, it is not yet production-ready and
should not be treated as a fully completed Phase 6 implementation.

| Area | Assessment |
|---|---:|
| Architecture alignment | 7/10 |
| Implementation correctness | 5/10 |
| Synthetic test coverage | 6/10 |
| Production readiness | Not ready |

The current Git changes are Phase 6 work. No unrelated pre-existing changes
were identified in the audited worktree. The changes remain uncommitted because
the phase has unresolved correctness and live-validation gaps.

## 2. Confirmed Strengths

- Baileys-specific code is isolated under `src/whatsapp/`.
- The composition root uses dependency injection and the
  `IWhatsAppAdapter` boundary.
- AI output does not select destinations or alter routing configuration.
- Image bytes are persisted and reused through the dispatcher media cache.
- Queue persistence, retry, uncertain-send handling, and lease recovery remain
  database-backed.
- The synthetic E2E test exercises all 11 fixture scenarios.
- Typecheck, build, and the existing regression suite passed during the audit
  cycle: 7 test files and 60 tests.

## 3. Findings

### FINDING-01 — Application entry-point check may prevent startup — Resolved

**Severity:** Critical  
**Location:** `src/app.ts`

The `import.meta.url` comparison constructs a Windows `file://` URL with the
wrong number of slashes. When launched through `npm start`, `main()` may not
execute.

**Required correction:** Use a platform-safe module entry-point check or expose
an explicit start function invoked by the package entry point.

### FINDING-02 — CP01 and CP02 are not part of the final per-message trace — Resolved

**Severity:** High  
**Locations:** `src/whatsapp/event-normalizer.ts`,
`src/ingestion/message-ingestor.ts`, `src/observability/telemetry.ts`

The plan requires one `PipelineTraceContext` covering CP01 through CP09.
Currently:

- CP01 creates a separate tracer in the normalizer.
- CP02 only prints a console line and is not recorded in `PipelineTracer`.
- CP03 creates another tracer in the ingestor.
- `TOTAL_PIPELINE_US` therefore excludes CP01 and CP02.
- Final journey summaries do not contain the complete CP01–CP09 sequence.

**Required correction:** Create or propagate one trace context from
normalization through final dispatch, and record CP01 and CP02 on that same
trace.

### FINDING-03 — AI failure handling can mask the original error — Resolved

**Severity:** Critical  
**Locations:** `src/ai/ai-processor.ts`, `src/ingestion/message-ingestor.ts`

AI processing receives an `announcementId` before the announcement record is
created. On provider failure, the processor attempts to update that
announcement to `held_validation_failed`, which can raise `Announcement not
found` and mask the actual provider error.

**Required correction:** Persist a processing announcement before AI work, or
make failure persistence create/update the durable record atomically without
masking the original error.

### FINDING-04 — Held validation failures are not durably recorded — Resolved

**Severity:** High  
**Location:** `src/ingestion/message-ingestor.ts`

When AI processing returns `held_validation_failed`, ingestion returns without
creating a durable held announcement record or associated audit state.

**Required correction:** Persist the announcement with
`held_validation_failed`, preserve the raw AI response and validation errors,
and create no delivery jobs.

### FINDING-05 — Ignored announcements omit their primary source association — Resolved

**Severity:** High  
**Location:** `src/ingestion/message-ingestor.ts`

The ignored branch excludes the primary source from `announcement_sources`.
This conflicts with the source association model and can allow retention logic
to treat the source as unreferenced.

**Required correction:** Persist the primary source with role `primary` and
any additional sources with their appropriate roles.

### FINDING-06 — Ingestion is arrival-order FIFO, not timestamp-order FIFO — Resolved

**Severity:** High  
**Location:** `src/ingestion/message-ingestor.ts`

The Promise chain serializes messages in callback arrival order. It does not
reorder separate event batches by `(timestamp_ms ASC, ingestion_seq ASC)`.
The normalizer sorts only within an individual upsert batch.

**Required correction:** Add a bounded timestamp-aware ingress buffer or
explicitly sort the pending queue before processing.

### FINDING-07 — Graceful shutdown does not await in-flight dispatch — Resolved

**Severity:** High  
**Location:** `src/app.ts`

Shutdown clears the polling timer and disconnects the adapter immediately. It
does not track the active dispatch Promise, stop claims through a lifecycle
state, or wait for in-flight sends up to a configured timeout.

**Required correction:** Track dispatch work, stop new claims, await active work
with a bounded timeout, then disconnect and checkpoint SQLite.

### FINDING-08 — Retention exists but is never scheduled — Resolved

**Severity:** Medium/High  
**Locations:** `src/observability/health.ts`, `src/app.ts`

`HealthMonitor.runRetention()` exists, but the application never schedules or
invokes it. Daily media cleanup and source-noise pruning therefore do not run
in production.

**Required correction:** Add a scheduled retention task with explicit logging
and shutdown cleanup.

### FINDING-09 — Live adapter ingestion errors are not surfaced — Resolved

**Severity:** High  
**Location:** `src/whatsapp/baileys-client.ts`

`handleUpsert()` is launched with `void`. Media-download or normalization
failures can become unhandled promise rejections without an operational event
or structured error log.

**Required correction:** Catch and classify errors at the adapter event
boundary, emit safe diagnostics, and preserve the connection lifecycle.

### FINDING-10 — Bot JID is captured before Baileys connects — Resolved

**Severity:** Medium  
**Locations:** `src/app.ts`, `src/ingestion/message-ingestor.ts`

The application reads `adapter.getBotJid()` before connecting. For Baileys,
the value is normally unavailable at that point, so the participant-based
self-echo check receives `null` permanently.

**Required correction:** Resolve the bot JID after connection or make the
ingestor use a dynamic bot-JID provider.

## 4. Test-Evidence Limitations

The A–E regression suite now covers the synthetic negative and lifecycle paths.
The following operational behaviors remain outside the local deterministic
verification scope:

- real Gemini behavior;
- Baileys reconnect and logout handling;
- live media-download failure handling;
- real Community topology and permission verification.

Real Gemini behavior and physical Baileys/SIM operation remain release-gate
checks for their respective authorized environments.

## 5. Checkpoint Compliance Assessment

| Checkpoint | Current assessment |
|---|---|
| CP01 | Measured, but on a separate tracer |
| CP02 | Printed, but not stored in `PipelineTracer` |
| CP03 | Partially measured; source insert occurs after the checkpoint ends |
| CP04 | Measured on the shared Phase 6 tracer after later wiring |
| CP05 | Measured on the shared tracer for successful AI calls |
| CP06 | Measured on the shared tracer for successful validation |
| CP07 | Measured for queued announcements and image passthrough |
| CP08 | Measured by the dispatcher |
| CP09 | Measured per language by the dispatcher |
| TOTAL_PIPELINE_US | Incomplete because CP01 and CP02 are excluded |
| TOTAL_E2E_WALL_MS | Calculated, but synthetic fixture timestamps are historical |

The current implementation should not claim a complete CP01–CP09 journey
benchmark until the trace context is unified.

## 6. Required Remediation Order

1. Fix application startup and composition-root lifecycle.
2. Unify CP01–CP09 tracing and correct total pipeline measurement.
3. Make AI processing failures and held validation states durable.
4. Correct timestamp-aware FIFO behavior.
5. Implement bounded graceful shutdown.
6. Schedule retention and surface adapter ingestion errors.
7. Add focused regression tests for each corrected failure path.
8. Re-run the full suite and review the final diff.
9. Obtain explicit decision on the live SIM/systemd smoke-test postponement.
10. Commit only after the above checks pass.

## 7. Conclusion

Phase 6.1 remediation is **complete for the deterministic local pipeline**:
all ten findings are marked resolved, the negative-path E2E suite passes, and
the file-backed simulation runs in mock mode. Real Gemini semantic validation,
Baileys reconnect/media-failure behavior, Community permissions, and physical
SIM/systemd operation remain explicitly deferred operational checks.
