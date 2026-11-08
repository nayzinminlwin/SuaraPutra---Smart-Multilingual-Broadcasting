---
name: backend-architecture
description: "Guides backend architecture for the SuaraPutra WhatsApp automation system, including modular boundaries, adapters, normalized DTOs, AI pipeline contracts, persistence, routing, APIs, and dependency direction. Use when designing or changing backend modules, services, interfaces, schemas, or integration boundaries."
---

# Backend Architecture

## Target shape

Use a modular monolith with explicit boundaries. The intended processing flow
is:

1. WhatsApp adapter receives an event.
2. Ingestion normalizes the provider payload.
3. Scope, loop, and duplicate checks decide eligibility.
4. Context assembly builds a bounded source context.
5. AI classification decides announcement status.
6. Fact extraction and language coverage produce canonical data.
7. Translation generates complete `ms`, `en`, `zh-CN`, and `ta` outputs.
8. Deterministic and, where useful, AI-assisted validation checks the result.
9. A persistent queue creates independent delivery work per destination.
10. A dispatcher sends through the adapter and records each outcome.

Keep the implementation order aligned with the authorized phase plan. Do not
build later-stage live integration or dashboard behavior merely because an
earlier module can call it.

## Boundary ownership

### WhatsApp adapter

Owns connection lifecycle, provider events, group metadata, message sending,
media transfer, and provider-specific errors. It may depend on the Baileys SDK.
It must not contain announcement classification, translation policy, or
destination selection logic.

### Ingestion and normalization

Converts provider events into validated internal data containing only the
metadata and content the application needs. Preserve source message IDs,
timestamps, sender information, source group identity, text, media references,
and source associations required for deduplication and auditing.

### AI pipeline

Accepts normalized announcement context and returns validated structured
results. It may classify, extract canonical facts, assess language coverage,
and generate translations. It must not choose destination JIDs, change
configuration, execute links or commands, or override system instructions.

### Persistence and queue

Owns durable processing state, source-message associations, generated outputs,
job leases, retry state, and per-language delivery outcomes. It must support
restart recovery and prevent successful destinations from being resent
unnecessarily.

### API and dashboard boundary

Expose only documented backend contracts. Dashboard input and displayed model
output are untrusted; server-side validation and authorization remain
mandatory. The dashboard must not send WhatsApp messages directly or bypass
delivery controls.

## Dependency direction

Prefer dependencies flowing inward:

```text
transport adapters -> application services -> domain contracts
                                      -> persistence interfaces
                                      -> AI provider interfaces
```

Concrete SDK, database, filesystem, HTTP, and model-provider implementations
belong at the edges. Domain and application services should depend on
interfaces and internal DTOs, not on Baileys, ORM records, or provider-specific
response shapes.

Avoid circular dependencies, global mutable state, and a shared utility module
that becomes an unowned second application layer.

## Contract rules

- Define contracts at the boundary that owns them.
- Validate inputs before invoking downstream services.
- Keep identifiers, URLs, dates, times, amounts, names, and other protected
  facts available for deterministic validation.
- Make uncertain, held, failed, and successful states explicit.
- Make idempotency keys and source-message relationships durable.
- Do not let model output determine authorization, routing, retries, or
  persistence commands.
- Keep the exact database and API schema in their authoritative documents or
  migration files; do not maintain a competing schema in this skill.

## Image and caption rule

When image support is authorized, media handling and AI text processing remain
separate. Download and persist original bytes through the media boundary,
associate them with the normalized source message, pass caption text—not
untrusted media instructions—to the text pipeline, and reuse the stored
original image when constructing an outgoing image message. Do not add OCR,
vision, or image editing without an explicit approved decision.

## Failure and recovery design

Represent failures according to ownership:

- Invalid or unsupported input: record and stop safely.
- Non-announcement: persist the classification decision without delivery.
- Uncertain or conflicting facts: hold or quarantine; do not publish.
- Transient connection/provider failure: retry according to queue policy.
- Permanent delivery failure: persist the outcome and expose it for
  operations.
- Unknown send outcome: do not blindly resend; reconcile using the delivery
  identity and adapter capabilities.

Every retryable operation needs an idempotency strategy. A process restart
must resume durable pending work without losing already completed language
destinations.

## Change workflow

1. Identify the owning boundary and its current contract.
2. Read the relevant authoritative specification and phase acceptance criteria.
3. Trace callers, persistence effects, and tests before editing.
4. Update interfaces and implementations together when a contract changes.
5. Add negative-path and recovery tests at the boundary.
6. Verify targeted checks, then inspect the complete diff.
7. Document contract or architecture changes; do not hide them in a skill.

## Architectural anti-patterns

- Passing `WAMessage` or raw SDK payloads through the whole backend.
- Letting the LLM select groups, permissions, queue state, or system prompts.
- Sending directly from classification or translation code.
- Treating four-language delivery as one all-or-nothing send operation.
- Storing temporary media URLs as if they were durable assets.
- Combining unrelated recent group messages without bounded context rules.
- Retrying a send without considering uncertain delivery and idempotency.
- Creating a second source of truth for schemas, routes, or approved decisions.

## References

- [Project context](../project-context/SKILL.md)
- [Project plan](../../../docs/project-plan.md)
- [Baileys integration specification](../../../docs/BAILEYS_INTEGRATION_SPEC.md)
- [Architecture](../../../docs/architecture.md)
- [Operations runbook](../../../docs/operations-runbook.md)
