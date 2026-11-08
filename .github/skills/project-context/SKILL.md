---
name: project-context
description: "Provides the shared context for the SuaraPutra Smart Multilingual Broadcasting project. Use when planning or implementing backend, WhatsApp, AI translation, persistence, dashboard, testing, or documentation work and the agent needs the approved scope, terminology, languages, architecture direction, or source-of-truth documents."
---

# Project Context

## Purpose

This project monitors one configured WhatsApp source group, identifies messages
that form announcements, creates complete versions in four configured languages,
and delivers each version to its corresponding group in the existing WhatsApp
Community.

The initial implementation is a local-first TypeScript/Node.js modular
monolith. The first WhatsApp integration candidate is Baileys. SQLite,
filesystem media storage, a replaceable LLM adapter, and a database-backed
queue are the initial technical direction unless an approved project decision
changes them.

## Scope and non-goals

The initial release focuses on text announcements and reliable processing.
Image support must preserve original bytes and captions when explicitly
authorized by the current phase. Do not expand the scope to multiple source
groups, arbitrary destinations, public-facing features, custom model training,
or platform-enforcement evasion without an approved plan change.

## Canonical languages

Use the configured language identifiers exactly:

- Malay: `ms`
- English: `en`
- Simplified Chinese: `zh-CN`
- Tamil: `ta`

Language mappings and destination group identifiers belong to application
configuration, not model output or dashboard input.

## System vocabulary

- **Source group**: the one configured WhatsApp group whose messages are
  considered for classification.
- **Destination group**: a configured language-specific WhatsApp group.
- **Normalized message**: provider-independent internal data derived from a
  WhatsApp event.
- **Announcement**: content classified as worth distributing, possibly after
  bounded context assembly from related messages.
- **Canonical facts**: structured dates, times, names, links, amounts,
  locations, identifiers, and instructions extracted from the source.
- **Delivery outcome**: the independently persisted state for one language
  destination, such as pending, sent, failed, or held.

## Architectural invariants

1. Keep Baileys-specific structures behind a WhatsApp adapter.
2. Keep AI processing independent from transport and destination routing.
3. Treat WhatsApp messages and model output as untrusted data.
4. Keep routing, authorization, prompts, secrets, and operational configuration
   under application control.
5. Preserve source facts and do not invent missing information.
6. Persist processing and per-language delivery state so restarts do not
   silently lose work or resend successful deliveries unnecessarily.
7. Keep credentials, WhatsApp session data, private media, and real operational
   data out of Git.

## Required working sequence

Before changing code:

1. Read the current authorized phase and acceptance criteria.
2. Inspect the relevant source, tests, configuration, and Git status.
3. Read the specialist skill for the task.
4. Locate the authoritative contract or decision document rather than
   duplicating it in code or another document.
5. Implement only the authorized scope.
6. Run the smallest relevant verification commands and report actual results.

## Source-of-truth documents

Use the structured project documentation for decisions, contracts, and
operational procedures:

- [Project plan](../../../docs/project-plan.md)
- [Baileys integration specification](../../../docs/BAILEYS_INTEGRATION_SPEC.md)
- [Architecture](../../../docs/architecture.md)
- [Operations runbook](../../../docs/operations-runbook.md)

The project plan defines what and when to implement. Agent files define role
and working behavior. Skills define reusable technical procedures. Do not let a
skill silently replace an approved project decision.

## Verification expectations

For any implementation, verify the behavior required by the current phase,
including negative paths where relevant. Report skipped checks, unavailable
dependencies, uncertain assumptions, and blockers explicitly.
